/**
 * Saves tests, personas and data templates from an org into the project: one file per item, holding
 * its category, the item and its active version, in a folder per category (`project-files.md`).
 *
 * **The org holds the tests, and a file is a copy.** Saving simply takes each item's active version,
 * replacing what its file held; a change made in the file is no reason to stop. An item without an
 * active version has nothing to save, and an item gone from the org leaves its file in place: both are
 * reported. The app moving an item to another category moves its file to that category's folder.
 *
 * **A file is rewritten only when its content changed**, with its keys in the order it had them, so
 * `git diff` shows exactly what changed in the org. The category is written into every file of its
 * folder, so the copies stay the same.
 *
 * **What a pulled item uses comes with it:** a persona or template its steps, user fields or records
 * name and no file holds, found by the same rules `check` uses, until nothing is missing.
 */
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isCategoryGuid, mayName, recordOf } from "./guid.mjs";
import {
  freeName,
  indexProject,
  inOrderOf,
  KIND_FOLDERS,
  removeIfEmpty,
  slug,
  writeDocument
} from "./layout.mjs";
import { KINDS, TestbenchFile } from "./model.mjs";
import { namespaced, soqlList } from "./org.mjs";
import {
  activeVersions,
  fieldsToRead,
  GUID,
  parentRelationship,
  selectByGuid,
  toFileRecord
} from "./records.mjs";
import { Context, Rules } from "./rules.mjs";
import { isObject, same } from "./schema.mjs";

function orderOf(schema, array) {
  return schema.pushOrder.find((order) => order.array === array);
}

/** The records of one list in a document, as its file holds them. */
function recordsIn(document, array) {
  const records = isObject(document?.data) ? document.data[array] : null;
  return Array.isArray(records) ? records : [];
}

/**
 * The items a pull is about, as [{ kind, guid }]: those the files hold, those named by GUID, and
 * those of a category in the org, named by GUID or name, or of every category there. An item without
 * an active version is included, so the pull can say why it brings nothing.
 */
export async function findPullTargets(
  org,
  schema,
  { entries = [], guids = [], category = null, all = false } = {}
) {
  const targets = new Map();
  const add = (kind, guid) => {
    if (!targets.has(guid)) {
      targets.set(guid, { kind, guid });
    }
  };
  for (const entry of entries) {
    for (const [kind, lists] of Object.entries(KINDS)) {
      for (const record of entry.file?.records(lists.items) ?? []) {
        if (record.GUID__c) {
          add(kind, record.GUID__c);
        }
      }
    }
  }
  for (const guid of guids) {
    const named = recordOf(guid);
    if (named?.role === "items") {
      add(named.kind, guid);
    }
  }
  for (const [kind, lists] of Object.entries(KINDS)) {
    const order = orderOf(schema, lists.items);
    const relationship = parentRelationship(order.parentField);
    const categories = guids.filter((guid) =>
      mayName(guid, kind, "categories")
    );
    const filters = [];
    if (categories.length > 0) {
      filters.push(
        `WHERE ${relationship}.${GUID} IN (${soqlList(categories)})`
      );
    }
    if (category !== null) {
      const key = isCategoryGuid(category) ? GUID : "Name";
      filters.push(`WHERE ${relationship}.${key} = ${soqlList([category])}`);
    }
    if (all) {
      filters.push("");
    }
    for (const filter of filters) {
      const soql =
        `SELECT ${GUID}, Name FROM ${namespaced(order.object)} ${filter}`.trim() +
        " ORDER BY Name";
      for (const record of await org.query(soql)) {
        add(kind, record[GUID]);
      }
    }
  }
  return [...targets.values()];
}

/**
 * A document holding one item as the org has it: its category, the item, and its active version in
 * the place of the versions the document held for it.
 */
function withItem(document, lists, parentField, { category, item, version }) {
  const next = {
    ...(isObject(document) ? document : { version: 1 }),
    data: { ...(isObject(document?.data) ? document.data : {}) }
  };
  const categories = recordsIn(document, lists.categories);
  next.data[lists.categories] = [
    inOrderOf(
      categories.find((each) => each?.GUID__c === category.GUID__c) ??
        categories[0],
      category
    )
  ];
  const items = recordsIn(document, lists.items);
  const at = items.findIndex((each) => each?.GUID__c === item.GUID__c);
  next.data[lists.items] =
    at < 0
      ? [...items, item]
      : items.map((each, index) =>
          index === at ? inOrderOf(each, item) : each
        );
  const versions = recordsIn(document, lists.versions);
  const own = (each) => each?.[parentField] === item.GUID__c;
  const previous =
    versions.find((each) => own(each) && each.GUID__c === version.GUID__c) ??
    versions.filter(own).at(-1);
  const kept = versions.filter((each) => !own(each));
  // The version takes the place of the first one the document held for the item, so a diff stays small.
  const first = versions.findIndex(own);
  const position =
    first < 0
      ? kept.length
      : versions.slice(0, first).filter((each) => !own(each)).length;
  kept.splice(position, 0, inOrderOf(previous, version));
  next.data[lists.versions] = kept;
  return next;
}

/**
 * What a pull would do, decided by comparing the org with the project's files. Writes nothing.
 *
 * entries are every file of the project, and targets what to pull, as [{ kind, guid }]. Resolves to
 * { items, categories, writes, removals }: each item { kind, guid, name, action, file, from, reason,
 * usedBy }, each category whose copies in other files change { kind, guid, name, files }, the
 * documents to write by path, and the files a move leaves behind.
 */
export async function planPull(org, schema, { entries, folder, targets }) {
  const index = indexProject(entries, folder);
  const onDisk = new Map(entries.map((entry) => [entry.path, entry.document]));
  const documents = new Map();
  const current = (path) => documents.get(path) ?? onDisk.get(path) ?? null;
  const folders = new Map(index.categories);
  const taken = new Set();
  const removals = new Set();
  const categoryRecords = new Map();

  const isTaken = (path) => existsSync(path) || taken.has(path);
  const folderFor = (kind, category) => {
    if (!folders.has(category.GUID__c)) {
      const kindFolder = join(folder, KIND_FOLDERS[kind]);
      const name = freeName(
        slug(category.Name) || category.GUID__c.toLowerCase(),
        (each) => isTaken(join(kindFolder, each))
      );
      taken.add(join(kindFolder, name));
      folders.set(category.GUID__c, join(kindFolder, name));
    }
    return folders.get(category.GUID__c);
  };
  const fileIn = (directory, name) => {
    const free = freeName(name, (each) =>
      isTaken(join(directory, `${each}.json`))
    );
    const path = join(directory, `${free}.json`);
    taken.add(path);
    return path;
  };

  const decide = async (kind, batch) => {
    const lists = KINDS[kind];
    const categoryOrder = orderOf(schema, lists.categories);
    const itemOrder = orderOf(schema, lists.items);
    const versionOrder = orderOf(schema, lists.versions);
    const versionFields = fieldsToRead(schema, versionOrder);
    const fileOf = (guid) => {
      const known = index.items.get(guid);
      return known?.kind === kind ? known.entry.path : null;
    };
    const orgItems = await selectByGuid(
      org,
      itemOrder.object,
      fieldsToRead(schema, itemOrder),
      batch.map((target) => target.guid)
    );
    const categoryOf = (record) =>
      record[parentRelationship(itemOrder.parentField)]?.[GUID] ?? null;
    const orgCategories = await selectByGuid(
      org,
      categoryOrder.object,
      fieldsToRead(schema, categoryOrder),
      [...orgItems.values()].map(categoryOf).filter(Boolean)
    );
    const orgActive = await activeVersions(org, versionOrder, versionFields, [
      ...orgItems.keys()
    ]);

    const decided = [];
    for (const target of batch) {
      const path = fileOf(target.guid);
      const orgItem = orgItems.get(target.guid);
      const fileItem = path
        ? recordsIn(current(path), lists.items).find(
            (each) => each?.GUID__c === target.guid
          )
        : null;
      const item = {
        kind,
        guid: target.guid,
        name: orgItem?.Name ?? fileItem?.Name ?? target.guid,
        action: null,
        file: path,
        from: null,
        reason: null,
        usedBy: target.usedBy ?? null,
        document: null
      };
      decided.push(item);
      const orgCategory = orgItem
        ? orgCategories.get(categoryOf(orgItem))
        : undefined;
      if (!orgItem || !orgCategory) {
        item.action = path ? "gone" : "missing";
        item.reason = path
          ? "it is not in the org. Its file is left in place: removing it is the developer's decision"
          : "it is not in the org";
        continue;
      }
      const active = orgActive.get(target.guid) ?? null;
      if (!active) {
        // Nothing to save: the file, when there is one, is left as it is.
        item.action = "inactive";
        item.reason = "it has no active version in the org";
        item.document = path ? current(path) : null;
        continue;
      }

      const category = toFileRecord(orgCategory, categoryOrder, schema);
      categoryRecords.set(category.GUID__c, { kind, record: category });
      const base = path ? current(path) : null;
      let destination = path;
      if (!path) {
        destination = fileIn(
          folderFor(kind, category),
          slug(orgItem.Name) || target.guid.toLowerCase()
        );
        item.action = "create";
      } else {
        const fileCategory = recordsIn(base, lists.categories)[0]?.GUID__c;
        if (
          fileCategory &&
          fileCategory !== category.GUID__c &&
          index.categories.get(fileCategory) === dirname(path)
        ) {
          // The item was moved to another category in the app, so its file moves to that category's folder.
          if (recordsIn(base, lists.items).length > 1) {
            item.action = "conflict";
            item.reason =
              `it was moved to the category “${category.Name}” in the app, and its file holds other items ` +
              `too: give it a file of its own in that category's folder, then pull again`;
            item.document = base;
            continue;
          }
          destination = fileIn(
            folderFor(kind, category),
            basename(path, ".json")
          );
          removals.add(path);
          item.action = "move";
          item.from = path;
        }
      }
      const document = withItem(base, lists, versionOrder.parentField, {
        category,
        item: toFileRecord(orgItem, itemOrder, schema),
        version: toFileRecord(active, versionOrder, schema)
      });
      item.file = destination;
      item.document = document;
      item.action ??= same(base, document) ? "unchanged" : "update";
      if (destination !== path || !same(base, document)) {
        documents.set(destination, document);
      }
    }
    return decided;
  };

  const items = [];
  let pending = targets.map((target) => ({ ...target }));
  const seen = new Set(pending.map((target) => target.guid));
  while (pending.length > 0) {
    const decided = [];
    for (const kind of Object.keys(KINDS)) {
      const batch = pending.filter((target) => target.kind === kind);
      if (batch.length > 0) {
        decided.push(...(await decide(kind, batch)));
      }
    }
    items.push(...decided);
    // What the items just decided use, and no file holds, is pulled next.
    const paths = [...new Set([...onDisk.keys(), ...documents.keys()])].filter(
      (path) => !removals.has(path)
    );
    const context = new Context(
      paths.map((path) => new TestbenchFile(current(path), schema))
    );
    pending = [];
    for (const item of decided.filter((each) => each.document)) {
      const rules = new Rules(
        new TestbenchFile(item.document, schema),
        schema,
        context
      );
      rules.run();
      for (const [kind, used] of [
        ["persona", rules.external.personas],
        ["dataTemplate", rules.external.dataTemplates]
      ]) {
        for (const { guid } of used) {
          if (!seen.has(guid)) {
            seen.add(guid);
            pending.push({
              kind,
              guid,
              usedBy: { kind: item.kind, name: item.name }
            });
          }
        }
      }
    }
  }

  // A category is copied into every file of its folder, and the copies must agree.
  const categories = [];
  for (const [guid, { kind, record }] of categoryRecords) {
    const array = KINDS[kind].categories;
    const files = [];
    for (const path of new Set([...onDisk.keys(), ...documents.keys()])) {
      const document = current(path);
      const copies = recordsIn(document, array);
      const at = copies.findIndex((each) => each?.GUID__c === guid);
      if (removals.has(path) || at < 0) {
        continue;
      }
      const next = inOrderOf(copies[at], record);
      if (same(copies[at], next)) {
        continue;
      }
      documents.set(path, {
        ...document,
        data: {
          ...document.data,
          [array]: copies.map((each, index) => (index === at ? next : each))
        }
      });
      files.push(path);
    }
    if (files.length > 0) {
      categories.push({ kind, guid, name: record.Name, files });
    }
  }

  // Only a document that changed was ever put in documents, so each one is written.
  return {
    items: items.map(({ document: _document, ...item }) => item),
    categories,
    writes: documents,
    removals: [...removals]
  };
}

/**
 * The items given, as [{ kind, guid }], each as a document the way a pull would write it: its
 * category, the item and its active version. An item the org does not hold, or holds without an
 * active version, is left out. Writes nothing.
 */
export async function documentsFromOrg(org, schema, targets) {
  const documents = new Map();
  for (const [kind, lists] of Object.entries(KINDS)) {
    const guids = targets
      .filter((target) => target.kind === kind)
      .map((target) => target.guid);
    if (guids.length === 0) {
      continue;
    }
    const categoryOrder = orderOf(schema, lists.categories);
    const itemOrder = orderOf(schema, lists.items);
    const versionOrder = orderOf(schema, lists.versions);
    const items = await selectByGuid(
      org,
      itemOrder.object,
      fieldsToRead(schema, itemOrder),
      guids
    );
    const categoryOf = (record) =>
      record[parentRelationship(itemOrder.parentField)]?.[GUID] ?? null;
    const categories = await selectByGuid(
      org,
      categoryOrder.object,
      fieldsToRead(schema, categoryOrder),
      [...items.values()].map(categoryOf).filter(Boolean)
    );
    const active = await activeVersions(
      org,
      versionOrder,
      fieldsToRead(schema, versionOrder),
      [...items.keys()]
    );
    for (const [guid, item] of items) {
      const category = categories.get(categoryOf(item));
      const version = active.get(guid);
      if (category && version) {
        documents.set(
          guid,
          withItem(null, lists, versionOrder.parentField, {
            category: toFileRecord(category, categoryOrder, schema),
            item: toFileRecord(item, itemOrder, schema),
            version: toFileRecord(version, versionOrder, schema)
          })
        );
      }
    }
  }
  return documents;
}

/** Writes what a plan decided, and removes what a move left behind, with its folder once empty. */
export function executePull(plan) {
  for (const [path, document] of plan.writes) {
    writeDocument(path, document);
  }
  for (const path of plan.removals) {
    rmSync(path, { force: true });
    removeIfEmpty(dirname(path));
  }
}

/** True when every item was pulled, or needed nothing. */
export function pullSucceeded(plan) {
  return plan.items.every((item) =>
    ["create", "update", "unchanged", "move"].includes(item.action)
  );
}
