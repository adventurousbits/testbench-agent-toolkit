/**
 * Where the project keeps each test, persona and template, as a pull and a delete need to know it: a
 * folder per kind, a folder per category, and a file per item (`project-files.md`).
 *
 * **An item's file is found by the GUID inside it, never by its name**, so an item renamed in the app
 * keeps its file, and a category's folder by the category GUID its files hold. A name is made once,
 * when the folder or file is created.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  writeFileSync
} from "node:fs";
import { dirname, relative } from "node:path";
import { KINDS } from "./model.mjs";
import { isObject } from "./schema.mjs";

/** The folder each kind of item is kept in, inside the project's Testbench folder. */
export const KIND_FOLDERS = {
  featureTest: "feature-tests",
  persona: "personas",
  dataTemplate: "data-templates"
};

/**
 * A name made safe for every file system: only the letters a to z and digits, in lower case, an
 * accented letter without its accent, and every other run of characters one hyphen.
 */
export function slug(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The name itself, or the first of name-2, name-3 and so on that is not taken. */
export function freeName(name, taken) {
  if (!taken(name)) {
    return name;
  }
  for (let number = 2; ; number++) {
    if (!taken(`${name}-${number}`)) {
      return `${name}-${number}`;
    }
  }
}

/** True when a file lies where the layout keeps an item of this kind: `<kind>/<category>/<item>.json`. */
function inKindFolder(path, folder, kind) {
  const parts = relative(folder, dirname(path)).split(/[\\/]/);
  return (
    parts.length === 2 && parts[0] === KIND_FOLDERS[kind] && parts[1] !== ""
  );
}

/**
 * Where the project's files keep each item and category: items by GUID, to their kind and the entry
 * of the file holding them, and categories by GUID, to the folder whose files hold them.
 */
export function indexProject(entries, folder) {
  const items = new Map();
  const categories = new Map();
  for (const entry of entries.filter((each) => each.file)) {
    for (const [kind, lists] of Object.entries(KINDS)) {
      for (const record of entry.file.records(lists.items)) {
        if (record.GUID__c && !items.has(record.GUID__c)) {
          items.set(record.GUID__c, { kind, entry });
        }
      }
      if (!inKindFolder(entry.path, folder, kind)) {
        continue;
      }
      for (const record of entry.file.records(lists.categories)) {
        if (record.GUID__c && !categories.has(record.GUID__c)) {
          categories.set(record.GUID__c, dirname(entry.path));
        }
      }
    }
  }
  return { items, categories };
}

/** next, with its keys in the order previous has them and any others after: a diff shows only values. */
export function inOrderOf(previous, next) {
  if (!isObject(previous)) {
    return next;
  }
  const ordered = {};
  for (const key of Object.keys(previous)) {
    if (Object.hasOwn(next, key)) {
      ordered[key] = next[key];
    }
  }
  for (const key of Object.keys(next)) {
    if (!Object.hasOwn(ordered, key)) {
      ordered[key] = next[key];
    }
  }
  return ordered;
}

/** Writes a Testbench file as JSON indented by two spaces, making its folder when it is new. */
export function writeDocument(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(document, null, 2) + "\n");
}

/** Removes a folder that nothing is left in. True when it was removed. */
export function removeIfEmpty(folder) {
  if (existsSync(folder) && readdirSync(folder).length === 0) {
    rmdirSync(folder);
    return true;
  }
  return false;
}
