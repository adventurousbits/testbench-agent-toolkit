/**
 * Deletes tests, personas, data templates, their versions and their categories, as the Testbench app
 * does, and only after the developer's yes to the exact list.
 *
 * **Deleting takes two calls.** The first writes nothing: it lists what would go, what goes with it,
 * what still uses it, and what Testbench refuses to delete, with a code computed from that list and
 * the org's Id. The second deletes only when given that code, and only while the list is the same: a
 * yes covers the list it was given to, never one that changed since.
 *
 * **Deleting a record deletes everything beneath it**: a category its items, an item its versions, a
 * version its results. The org does that; the request names only the records asked for. Testbench
 * refuses to delete a test while it runs, and so a category holding one, a persona while it is
 * validated, a Global template or its versions for a user without the permission they need, and
 * Global Templates while it holds templates or for a user without that permission. Testbench also
 * refuses Global Templates for the short while after its last templates went, until that change has
 * deployed. The list does not foresee that one, since knowing it means reading a field older
 * Testbench versions lack; the deletion reports it as Testbench's refusal, and a second try works.
 *
 * **The project's files follow the org**, with the same yes: a file whose items are all gone is
 * removed, with its folder once empty, and one that still holds something keeps it. An item the org
 * never held is never removed.
 */
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GLOBAL_TEMPLATES_GUID, mayName } from "./guid.mjs";
import { removeIfEmpty, writeDocument } from "./layout.mjs";
import { KINDS } from "./model.mjs";
import { chunks, namespaced, soqlList } from "./org.mjs";
import { holdsGlobalTemplatePermission } from "./orgchecks.mjs";
import { ACTIVE, GUID, parentRelationship, selectByGuid } from "./records.mjs";
import { isObject } from "./schema.mjs";

const RUNNING = namespaced("Is_Running__c");
const VALIDATION_STATUS = namespaced("Validation_Status__c");
const TYPE = namespaced("Type__c");
const GLOBAL_REFUSAL =
  "Testbench refuses to delete a Global template, or a version of one, for a user without the " +
  "Testbench - Manage Global Templates permission set: ask an administrator for it";
const GLOBAL_CATEGORY_REFUSAL =
  "Testbench refuses to delete Global Templates for a user without the Testbench - Manage Global " +
  "Templates permission set: ask an administrator for it";

function orderOf(schema, array) {
  return schema.pushOrder.find((order) => order.array === array);
}

function recordsIn(document, array) {
  const records = isObject(document?.data) ? document.data[array] : null;
  return Array.isArray(records) ? records : [];
}

/** What Testbench refuses to delete for now, and why, or null. */
function refusal(kind, record) {
  if (kind === "featureTest" && record[RUNNING] === true) {
    return "Testbench refuses to delete a test while it runs: delete it once its run has ended";
  }
  if (kind === "persona" && record[VALIDATION_STATUS] === "Validating") {
    return "Testbench refuses to delete a persona while it is validated: delete it once its validation has ended";
  }
  return null;
}

/** The fields to read for an item, so the list can say what Testbench would refuse. */
function itemFields(kind, order) {
  const fields = ["Name", `${parentRelationship(order.parentField)}.Name`];
  if (kind === "featureTest") {
    fields.push(RUNNING);
  }
  if (kind === "persona") {
    fields.push(VALIDATION_STATUS);
  }
  if (kind === "dataTemplate") {
    fields.push(TYPE);
  }
  return fields;
}

/** The org's Id, which the code is computed with, so a code shown for one org deletes nothing in another. */
async function orgId(org) {
  const [organization] = await org.query("SELECT Id FROM Organization");
  return organization?.Id ?? null;
}

/** The records of each file of the project once these GUIDs are gone, or null where nothing changes. */
function filesWithout(entries, schema, gone) {
  const changes = [];
  for (const entry of entries.filter((each) => each.document)) {
    const document = entry.document;
    const data = { ...(isObject(document.data) ? document.data : {}) };
    let changed = false;
    let items = 0;
    for (const lists of Object.values(KINDS)) {
      const itemOrder = orderOf(schema, lists.items);
      const versionOrder = orderOf(schema, lists.versions);
      const keptItems = recordsIn(document, lists.items).filter(
        (record) => !gone.has(record?.GUID__c)
      );
      const keptVersions = recordsIn(document, lists.versions).filter(
        (record) =>
          !gone.has(record?.GUID__c) &&
          !gone.has(record?.[versionOrder.parentField])
      );
      // A category the org lost stays in a file while an item there still names it.
      const keptCategories = recordsIn(document, lists.categories).filter(
        (record) =>
          !gone.has(record?.GUID__c) ||
          keptItems.some(
            (item) => item?.[itemOrder.parentField] === record.GUID__c
          )
      );
      for (const [array, kept] of [
        [lists.categories, keptCategories],
        [lists.items, keptItems],
        [lists.versions, keptVersions]
      ]) {
        if (kept.length !== recordsIn(document, array).length) {
          data[array] = kept;
          changed = true;
        }
      }
      items += keptItems.length;
    }
    if (changed) {
      changes.push({
        path: entry.path,
        remove: items === 0,
        document: { ...document, data }
      });
    }
  }
  return changes;
}

/** These GUIDs with everything beneath them, as the org deletes a record with what it holds. */
function withBeneath(guids, beneath) {
  const gone = new Set(guids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const each of beneath) {
      if (!gone.has(each.guid) && gone.has(each.under)) {
        gone.add(each.guid);
        grew = true;
      }
    }
  }
  return gone;
}

/**
 * What deleting these GUIDs would do. Writes nothing.
 *
 * Resolves to { orgId, records, missing, beneath, results, usedBy, refused, files, code }: the
 * records named, each { kind, role, guid, id, name, parent, active }; the GUIDs named that the org
 * does not hold; what goes with the records, each { kind, role, guid, id, name, under }; how many
 * test results go with them; what still uses a persona or template that goes, each { kind, guid,
 * name, uses }; what Testbench refuses, each { kind, role, guid, name, reason }, with parent and
 * active for a version; and the project's files, { remove, update }.
 */
export async function planDelete(org, schema, guids, { entries = [] } = {}) {
  const records = [];
  const missing = [];
  const beneath = [];
  for (const [kind, lists] of Object.entries(KINDS)) {
    const categoryOrder = orderOf(schema, lists.categories);
    const itemOrder = orderOf(schema, lists.items);
    const versionOrder = orderOf(schema, lists.versions);
    const itemParent = parentRelationship(itemOrder.parentField);
    const versionParent = parentRelationship(versionOrder.parentField);
    const named = (role) => guids.filter((guid) => mayName(guid, kind, role));
    const found = [
      [
        "categories",
        await selectByGuid(
          org,
          categoryOrder.object,
          ["Name"],
          named("categories")
        )
      ],
      [
        "items",
        await selectByGuid(
          org,
          itemOrder.object,
          itemFields(kind, itemOrder),
          named("items")
        )
      ],
      [
        "versions",
        await selectByGuid(
          org,
          versionOrder.object,
          [
            "Name",
            ACTIVE,
            `${versionParent}.Name`,
            `${versionParent}.${GUID}`,
            ...(kind === "dataTemplate" ? [`${versionParent}.${TYPE}`] : [])
          ],
          named("versions")
        )
      ]
    ];
    for (const [role, byGuid] of found) {
      for (const guid of named(role)) {
        const record = byGuid.get(guid);
        if (!record) {
          continue;
        }
        records.push({
          kind,
          role,
          guid,
          id: record.Id,
          name: record.Name,
          parent:
            role === "items"
              ? (record[itemParent]?.Name ?? null)
              : role === "versions"
                ? (record[versionParent]?.Name ?? null)
                : null,
          item:
            role === "versions"
              ? (record[versionParent]?.[GUID] ?? null)
              : null,
          active: role === "versions" ? record[ACTIVE] === true : null,
          record
        });
      }
    }

    // Everything beneath the categories and items named goes with them.
    const categories = records
      .filter((each) => each.kind === kind && each.role === "categories")
      .map((each) => each.guid);
    for (const group of chunks(categories)) {
      for (const item of await org.query(
        `SELECT ${["Id", GUID, `${itemParent}.${GUID}`, ...itemFields(kind, itemOrder)].join(", ")} ` +
          `FROM ${namespaced(itemOrder.object)} WHERE ${itemParent}.${GUID} IN (${soqlList(group)}) ORDER BY Name`
      )) {
        beneath.push({
          kind,
          role: "items",
          guid: item[GUID],
          id: item.Id,
          name: item.Name,
          under: item[itemParent]?.[GUID] ?? null,
          record: item
        });
      }
    }
    const items = [
      ...records.filter((each) => each.kind === kind && each.role === "items"),
      ...beneath.filter((each) => each.kind === kind && each.role === "items")
    ].map((each) => each.guid);
    for (const group of chunks(items)) {
      for (const version of await org.query(
        `SELECT Id, ${GUID}, Name, ${versionParent}.${GUID} FROM ${namespaced(versionOrder.object)} ` +
          `WHERE ${versionParent}.${GUID} IN (${soqlList(group)}) ORDER BY Name`
      )) {
        beneath.push({
          kind,
          role: "versions",
          guid: version[GUID],
          id: version.Id,
          name: version.Name,
          under: version[versionParent]?.[GUID] ?? null
        });
      }
    }
  }

  // A category's or version's GUID is looked for in every kind, so it is missing only when none holds it.
  const held = new Set(records.map((each) => each.guid));
  missing.push(...guids.filter((guid) => !held.has(guid)));

  // A version's results go with it, and a test's versions with the test.
  const testVersions = [...records, ...beneath]
    .filter((each) => each.kind === "featureTest" && each.role === "versions")
    .map((each) => each.guid);
  let results = 0;
  for (const group of chunks(new Set(testVersions))) {
    const [count] = await org.query(
      `SELECT COUNT(Id) n FROM ${namespaced("Feature_Test_Run_Result__c")} ` +
        `WHERE ${namespaced("Feature_Test_Version__r")}.${GUID} IN (${soqlList(group)})`
    );
    results += count?.n ?? 0;
  }

  const refused = [...records, ...beneath]
    .filter((each) => each.role === "items" && refusal(each.kind, each.record))
    .map(({ kind, role, guid, name, record }) => ({
      kind,
      role,
      guid,
      name,
      reason: refusal(kind, record)
    }));
  const globalCategory = records.find(
    (each) => each.role === "categories" && each.guid === GLOBAL_TEMPLATES_GUID
  );
  // As Testbench decides: one holding templates is refused to everyone, an empty one to a user
  // without the permission.
  if (globalCategory) {
    const holdsTemplates = beneath.some(
      (each) => each.under === GLOBAL_TEMPLATES_GUID
    );
    if (holdsTemplates || !(await holdsGlobalTemplatePermission(org))) {
      refused.push({
        kind: globalCategory.kind,
        role: globalCategory.role,
        guid: globalCategory.guid,
        name: globalCategory.name,
        reason: holdsTemplates
          ? "Testbench refuses to delete Global Templates while it holds templates: delete them first"
          : GLOBAL_CATEGORY_REFUSAL
      });
    }
  }
  // Global templates named, as items or versions. One reached through Global Templates is covered by
  // its refusal above.
  const globals = records.filter(
    (each) =>
      each.kind === "dataTemplate" &&
      (each.role === "items"
        ? each.record[TYPE]
        : each.role === "versions"
          ? each.record[parentRelationship("Data_Template__c")]?.[TYPE]
          : null) === "Global"
  );
  if (globals.length > 0 && !(await holdsGlobalTemplatePermission(org))) {
    refused.push(
      ...globals.map(({ kind, role, guid, name, parent, active }) => ({
        kind,
        role,
        guid,
        name,
        parent,
        active,
        reason: GLOBAL_REFUSAL
      }))
    );
  }
  // A record above one Testbench refuses is refused with it: deleting it takes what it holds in one
  // go, and fails with the refused record.
  const parentOf = new Map(beneath.map((each) => [each.guid, each.under]));
  for (const child of [...refused]) {
    for (let guid = parentOf.get(child.guid); guid; guid = parentOf.get(guid)) {
      const holder = records.find((each) => each.guid === guid);
      if (holder && !refused.some((each) => each.guid === guid)) {
        refused.push({
          kind: holder.kind,
          role: holder.role,
          guid,
          name: holder.name,
          reason: `Testbench refuses to delete it while it holds “${child.name}”, refused above`
        });
      }
    }
  }

  // A test, persona or template whose active version names a persona or template that goes, or one
  // that loses its active version, fails until it is changed.
  const going = new Set(
    [...records, ...beneath]
      .filter((each) => each.role !== "versions")
      .map((each) => each.guid)
  );
  const goingVersions = new Set(
    records.filter((each) => each.role === "versions").map((each) => each.guid)
  );
  const affected = new Map();
  for (const each of [...records, ...beneath]) {
    if (each.kind === "featureTest") {
      continue;
    }
    if (each.role === "items") {
      affected.set(each.guid, { kind: each.kind, name: each.name });
    }
    if (each.role === "versions" && each.active && each.item) {
      affected.set(each.item, { kind: each.kind, name: each.parent });
    }
  }
  const usedBy = [];
  if (affected.size > 0) {
    for (const [kind, lists] of Object.entries(KINDS)) {
      const versionOrder = orderOf(schema, lists.versions);
      const versionParent = parentRelationship(versionOrder.parentField);
      const definitions = schema.jsonFields(lists.versions).map(namespaced);
      for (const version of await org.query(
        `SELECT Id, ${GUID}, ${versionParent}.${GUID}, ${versionParent}.Name, ${definitions.join(", ")} ` +
          `FROM ${namespaced(versionOrder.object)} WHERE ${ACTIVE} = true`
      )) {
        const item = version[versionParent]?.[GUID];
        if (going.has(item) || goingVersions.has(version[GUID])) {
          continue;
        }
        const text = definitions
          .map((field) => version[field] ?? "")
          .join("\n");
        const uses = [...affected]
          .filter(([guid]) => guid !== item && text.includes(guid))
          .map(([guid, used]) => ({ guid, ...used }));
        if (uses.length > 0) {
          usedBy.push({
            kind,
            guid: item,
            name: version[versionParent]?.Name ?? item,
            uses
          });
        }
      }
    }
  }

  const id = await orgId(org);
  const ids = [...records, ...beneath].map((each) => each.id).sort();
  const code = createHash("sha256")
    .update(JSON.stringify({ org: id, ids }))
    .digest("hex")
    .slice(0, 8);
  // The files follow what the org would delete, as executeDelete's do once it has: a record Testbench
  // refuses stays with everything beneath it.
  const kept = new Set(refused.map((each) => each.guid));
  const gone = withBeneath(
    records.filter((each) => !kept.has(each.guid)).map((each) => each.guid),
    beneath
  );
  const files = filesWithout(entries, schema, gone);
  return {
    orgId: id,
    records: records.map(({ record: _record, ...each }) => each),
    missing,
    beneath: beneath.map(({ record: _record, ...each }) => each),
    results,
    usedBy,
    refused,
    files: {
      remove: files.filter((each) => each.remove).map((each) => each.path),
      update: files.filter((each) => !each.remove).map((each) => each.path)
    },
    code
  };
}

/**
 * Deletes the records a plan names, up to 200 a request, each on its own: one Testbench refuses does
 * not keep the others. Then brings the project's files in line with what was deleted.
 *
 * Resolves to { deleted, failed, removed, updated }: the records deleted and those not, each failure
 * with its errors, and the files removed and rewritten.
 */
export async function executeDelete(org, plan, schema, { entries = [] } = {}) {
  const path = await org.dataPath("composite/sobjects");
  const outcomes = new Map();
  for (const group of chunks(plan.records.map((each) => each.id))) {
    const answer = await org.rest(
      "DELETE",
      `${path}?ids=${group.join(",")}&allOrNone=false`
    );
    group.forEach((id, index) => outcomes.set(id, answer?.[index] ?? null));
  }
  const deleted = [];
  const failed = [];
  for (const record of plan.records) {
    const outcome = outcomes.get(record.id);
    if (outcome?.success === true) {
      deleted.push(record);
    } else {
      failed.push({
        ...record,
        errors: (outcome?.errors ?? []).map(
          (error) => `${error.statusCode}: ${error.message}`
        )
      });
    }
  }
  // What went with each record deleted, so its file goes too.
  const gone = withBeneath(
    deleted.map((each) => each.guid),
    plan.beneath
  );
  const removed = [];
  const updated = [];
  for (const change of filesWithout(entries, schema, gone)) {
    if (change.remove) {
      rmSync(change.path, { force: true });
      removeIfEmpty(dirname(change.path));
      removed.push(change.path);
    } else {
      writeDocument(change.path, change.document);
      updated.push(change.path);
    }
  }
  return { deleted, failed, removed, updated };
}
