/**
 * Loads Testbench files into an org the way the app's import does: by GUID, parents first, and only
 * what changed.
 *
 * **A version is its GUID.** Testbench locks a version's steps once it has been active, so a version
 * the org holds already has its steps, and is never sent again: the org compares them as text, and
 * the same steps written with other spacing would be refused as a change. For each test, persona or
 * template, the file's version, the last one the file holds for it, is set against the org:
 *
 * - **The org does not hold the file's version:** it is created, and made active.
 * - **The org holds it:** a name or description that differs is updated in place, as the import does,
 *   and the version is made active when it is not.
 * - **The org holds it locked, with other steps:** the file's steps were changed without a new
 *   version, which the org would refuse. That item is refused: changed steps are a new version, with
 *   a GUID of its own.
 * - **The item is not in the org:** it is created, with its version active.
 *
 * **A category is loaded like an item**, created or updated, except Global Templates: it is created
 * when the org lacks it and otherwise left as the org has it.
 *
 * **Making the file's version active replaces the org's active version**, as the import's activate
 * toggle does. Nothing is deleted: the version replaced stays in the org, inactive, and the report
 * names it, so it can be made active again.
 */
import { GLOBAL_TEMPLATES_GUID, prefixOf } from "./guid.mjs";
import { KINDS } from "./model.mjs";
import { namespaced } from "./org.mjs";
import { requireGlobalTemplatePermission } from "./orgchecks.mjs";
import {
  ACTIVE,
  activeVersions,
  fieldsToRead,
  fileValue,
  GUID,
  IMMUTABLE,
  normalized,
  parentRelationship,
  selectByGuid,
  upsertByGuid
} from "./records.mjs";
import { same } from "./schema.mjs";
import { validateItems } from "./run.mjs";
import { waitForDeployments } from "./wait.mjs";

/** The kind of item and the role ("categories", "items" or "versions") of each record list. */
export function rolesByArray() {
  const roles = new Map();
  for (const [kind, lists] of Object.entries(KINDS)) {
    for (const [role, array] of Object.entries(lists)) {
      roles.set(array, { kind, role });
    }
  }
  return roles;
}

/** The keys of a file record whose values the org does not hold. */
export function changedKeys(fileRecord, orgRecord, order, jsonFields) {
  return Object.keys(fileRecord).filter(
    (key) =>
      key !== "GUID__c" &&
      !same(
        normalized(fileRecord[key]),
        normalized(fileValue(orgRecord, key, order, jsonFields))
      )
  );
}

/** A file record as the org takes it: namespaced fields, the parent by GUID, JSON fields as text. */
function toOrgRecord(fileRecord, keys, order, jsonFields) {
  const record = { [GUID]: fileRecord.GUID__c };
  for (const key of keys) {
    if (key === "GUID__c") {
      continue;
    }
    const value = fileRecord[key];
    if (key === order.parentField) {
      record[parentRelationship(key)] = { [GUID]: value };
    } else if (jsonFields.includes(key)) {
      record[namespaced(key)] =
        value === null || value === undefined ? null : JSON.stringify(value);
    } else {
      record[namespaced(key)] = value ?? null;
    }
  }
  return record;
}

/** Every record the files hold, by list and GUID, each with the file it came from. */
function gather(entries, schema) {
  const lists = new Map(
    schema.pushOrder.map((order) => [order.array, new Map()])
  );
  for (const entry of entries) {
    for (const order of schema.pushOrder) {
      for (const record of entry.file.records(order.array)) {
        // A category is copied into every file of its folder; the check made sure the copies agree.
        if (record.GUID__c && !lists.get(order.array).has(record.GUID__c)) {
          lists.get(order.array).set(record.GUID__c, { record, entry });
        }
      }
    }
  }
  return lists;
}

/**
 * What loading the files would do, decided by comparing them with the org. Writes nothing.
 *
 * Resolves to { categories, items }: each category { kind, guid, name, action, send }, and each item
 * { kind, guid, name, file, action, reason, send: { item, versions }, version, replaced, global },
 * replaced naming the org's active version that the file's version takes over from, and global true
 * for a data template that is Global in the file or in the org.
 */
export async function planPush(org, entries, schema) {
  const lists = gather(entries, schema);
  const roles = rolesByArray();
  const orders = new Map(schema.pushOrder.map((order) => [order.array, order]));
  const state = new Map();
  const active = new Map();
  for (const order of schema.pushOrder) {
    const records = lists.get(order.array);
    if (records.size === 0) {
      continue;
    }
    const fields = fieldsToRead(schema, order);
    state.set(
      order.array,
      await selectByGuid(org, order.object, fields, records.keys())
    );
    if (order.isVersion) {
      const itemsArray = KINDS[roles.get(order.array).kind].items;
      active.set(
        order.array,
        await activeVersions(org, order, fields, [
          ...lists.get(itemsArray).keys()
        ])
      );
    }
  }

  const categories = [];
  const items = [];
  for (const [kind, names] of Object.entries(KINDS)) {
    const categoryOrder = orders.get(names.categories);
    const itemOrder = orders.get(names.items);
    const versionOrder = orders.get(names.versions);
    const versionFields = schema.jsonFields(names.versions);

    for (const [guid, { record }] of lists.get(names.categories)) {
      const existing = state.get(names.categories)?.get(guid);
      // Global Templates is created when the org lacks it, as the app's import does, and otherwise
      // never written from a file: Testbench keeps its name, and a file's copy cannot change it.
      const changed = !existing
        ? Object.keys(record)
        : guid === GLOBAL_TEMPLATES_GUID
          ? []
          : changedKeys(record, existing, categoryOrder, []);
      categories.push({
        kind,
        guid,
        name: record.Name,
        action: !existing
          ? "create"
          : changed.length > 0
            ? "update"
            : "unchanged",
        send:
          changed.length > 0
            ? toOrgRecord(record, changed, categoryOrder, [])
            : null
      });
    }

    for (const [guid, { record, entry }] of lists.get(names.items)) {
      const versions = [...lists.get(names.versions).values()]
        .map((each) => each.record)
        .filter((version) => version[versionOrder.parentField] === guid);
      const fileVersion = versions.at(-1) ?? null;
      const existing = state.get(names.items)?.get(guid);
      const item = {
        kind,
        guid,
        name: record.Name,
        file: entry.path,
        reason: null,
        version: fileVersion?.GUID__c ?? null,
        replaced: null,
        // Global in the file or in the org: loading a file can move a template out of Global
        // Templates, and that needs the permission too.
        global:
          kind === "dataTemplate" &&
          (record.Type__c === "Global" ||
            existing?.[namespaced("Type__c")] === "Global")
      };
      const orgVersions = state.get(names.versions) ?? new Map();
      // Older versions a file holds are history: created when the org lacks them, otherwise left alone.
      const history = versions
        .slice(0, -1)
        .filter((version) => !orgVersions.has(version.GUID__c))
        .map((version) =>
          toOrgRecord(
            version,
            Object.keys(version),
            versionOrder,
            versionFields
          )
        );
      const whole = (version) => ({
        ...toOrgRecord(
          version,
          Object.keys(version),
          versionOrder,
          versionFields
        ),
        [ACTIVE]: true
      });

      if (!existing) {
        items.push({
          ...item,
          action: "create",
          send: {
            item: toOrgRecord(record, Object.keys(record), itemOrder, []),
            versions: fileVersion ? [...history, whole(fileVersion)] : history
          }
        });
        continue;
      }
      const itemChanged = changedKeys(record, existing, itemOrder, []);
      const sendItem =
        itemChanged.length > 0
          ? toOrgRecord(record, itemChanged, itemOrder, [])
          : null;
      if (!fileVersion) {
        items.push({
          ...item,
          action: sendItem ? "update" : "unchanged",
          send: { item: sendItem, versions: history }
        });
        continue;
      }

      const orgVersion = orgVersions.get(fileVersion.GUID__c);
      const orgActive = active.get(names.versions)?.get(guid) ?? null;
      const replaced =
        orgActive && orgActive[GUID] !== fileVersion.GUID__c
          ? { guid: orgActive[GUID], name: orgActive.Name }
          : null;
      if (!orgVersion) {
        items.push({
          ...item,
          action: "new version",
          replaced,
          send: { item: sendItem, versions: [...history, whole(fileVersion)] }
        });
        continue;
      }
      const changed = changedKeys(
        fileVersion,
        orgVersion,
        versionOrder,
        versionFields
      );
      if (
        orgVersion[IMMUTABLE] === true &&
        changed.some((key) => versionFields.includes(key))
      ) {
        items.push({
          ...item,
          action: "refused",
          reason:
            `the org holds version ${fileVersion.GUID__c} with other steps, and a version's steps cannot ` +
            `change once it has been active. Changed steps are a new version: give it a new GUID, made ` +
            `with "guid ${prefixOf(fileVersion.GUID__c)}"`,
          send: { item: null, versions: [] }
        });
        continue;
      }
      const isActive = orgVersion[ACTIVE] === true;
      // A version the org holds is sent only for what changed: a name, a description, or steps the org
      // has not locked yet.
      const versionSend =
        changed.length > 0 || !isActive
          ? toOrgRecord(fileVersion, changed, versionOrder, versionFields)
          : null;
      if (versionSend && !isActive) {
        versionSend[ACTIVE] = true;
      }
      const sends = versionSend ? [...history, versionSend] : history;
      items.push({
        ...item,
        action: !isActive
          ? "activate"
          : sendItem || sends.length > 0
            ? "update"
            : "unchanged",
        replaced: isActive ? null : replaced,
        send: { item: sendItem, versions: sends }
      });
    }
  }
  return { categories, items };
}

/**
 * Carries out a plan, parents first. Stops after the first list in which a record failed, since
 * everything beneath it would fail too.
 *
 * Resolves to { failed: [{ kind, guid, name, errors }], stoppedAt }, and marks each item in the plan
 * with what happened to it.
 */
export async function executePush(org, plan, schema) {
  const roles = rolesByArray();
  const failed = [];
  let stoppedAt = null;
  const pushable = plan.items.filter((item) => item.action !== "refused");
  for (const order of schema.pushOrder) {
    const { kind, role } = roles.get(order.array);
    let sends;
    if (role === "categories") {
      sends = plan.categories
        .filter((category) => category.kind === kind && category.send)
        .map((category) => [category, category.send]);
    } else if (role === "items") {
      sends = pushable
        .filter((item) => item.kind === kind && item.send.item)
        .map((item) => [item, item.send.item]);
    } else {
      sends = pushable
        .filter((item) => item.kind === kind)
        .flatMap((item) => item.send.versions.map((record) => [item, record]));
    }
    if (sends.length === 0) {
      continue;
    }
    const outcomes = await upsertByGuid(
      org,
      order.object,
      sends.map(([, record]) => record)
    );
    outcomes.forEach((outcome, index) => {
      const [target] = sends[index];
      if (!outcome.success) {
        target.failed = true;
        failed.push({
          kind,
          guid: outcome.key,
          name: target.name,
          errors: outcome.errors
        });
      }
    });
    if (failed.length > 0) {
      stoppedAt = order.array;
      break;
    }
  }
  if (stoppedAt !== null) {
    // Items in the lists not reached were not pushed at all.
    const reached = schema.pushOrder.findIndex(
      (order) => order.array === stoppedAt
    );
    for (const item of pushable.filter((each) => !each.failed)) {
      const own = schema.pushOrder.findIndex(
        (order) => order.array === KINDS[item.kind].versions
      );
      item.skipped = own > reached;
    }
  }
  return { failed, stoppedAt };
}

/** The actions that put a new definition in place, which is what deploys and is worth validating. */
const DEFINITION_CHANGES = ["create", "new version", "activate"];

/**
 * A whole load: plans it, carries it out, waits until every loaded item's deployment has ended, and
 * validates the personas and templates whose definition changed. The files must have been checked.
 *
 * Every item in the files is waited for, changed or not, so loading again after an interruption picks
 * up the deployments still under way, and a deployment that failed earlier is reported rather than
 * passed over.
 *
 * Resolves to { plan, failed, stoppedAt, timedOut, validations }.
 */
export async function pushFiles(org, entries, schema, options = {}) {
  const {
    dryRun = false,
    waitForDeploy = true,
    validate = true,
    wait = {}
  } = options;
  const plan = await planPush(org, entries, schema);
  // Checked before anything is written, so a refusal never leaves the org with half the files loaded,
  // and on a dry run too, which would otherwise promise a push that cannot happen.
  const globals = plan.items.filter(
    (item) => item.global && (item.send.item || item.send.versions.length > 0)
  );
  if (globals.length > 0) {
    await requireGlobalTemplatePermission(
      org,
      globals.map((item) => item.name)
    );
  }
  if (dryRun) {
    return {
      plan,
      failed: [],
      stoppedAt: null,
      timedOut: false,
      validations: [],
      dryRun: true
    };
  }
  const { failed, stoppedAt } = await executePush(org, plan, schema);
  const pushed = plan.items.filter(
    (item) => item.action !== "refused" && !item.failed && !item.skipped
  );
  let timedOut = false;
  let validations = [];
  if (waitForDeploy && pushed.length > 0) {
    const answer = await waitForDeployments(org, pushed, wait);
    timedOut = answer.timedOut;
    for (const item of pushed) {
      item.deployment = answer.states.get(item.guid) ?? null;
    }
    const changed = pushed.filter(
      (item) =>
        item.kind !== "featureTest" &&
        DEFINITION_CHANGES.includes(item.action) &&
        item.deployment?.status === "Deployed"
    );
    if (validate && changed.length > 0) {
      const byKind = { persona: [], dataTemplate: [] };
      changed.forEach((item) =>
        byKind[item.kind].push({ guid: item.guid, name: item.name })
      );
      validations = await validateItems(org, byKind, { wait });
    }
  }
  return { plan, failed, stoppedAt, timedOut, validations };
}
