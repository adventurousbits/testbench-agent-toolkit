/**
 * The project's Testbench files: where they live, which ones to read, and the rules that span files.
 *
 * A project keeps one file per test, persona or template, in a folder per category, under
 * `testbench/` at its root (`project-files.md`). Each file is a complete Testbench file holding its
 * category, so a category is copied into every file of its folder, and the copies must agree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { KINDS, TestbenchFile } from "./model.mjs";
import { ERROR, WARNING } from "./rules.mjs";
import { same } from "./schema.mjs";

/** A problem with how the script was called, rather than with what it was given. */
export class UsageError extends Error {}

/** A path as the developer reads it: relative to where they ran the script, unless it lies outside. */
export function displayPath(path) {
  const shown = relative(process.cwd(), path);
  return shown && !shown.startsWith("..") ? shown : path;
}

/** The nearest folder at or above start that holds sfdx-project.json, or null outside a project. */
export function findProjectRoot(start = process.cwd()) {
  let folder = resolve(start);
  for (;;) {
    if (existsSync(join(folder, "sfdx-project.json"))) {
      return folder;
    }
    const parent = dirname(folder);
    if (parent === folder) {
      return null;
    }
    folder = parent;
  }
}

/** Where the project keeps its Testbench files: `testbench/`, or the folder sfdx-project.json names. */
export function testbenchFolder(root) {
  let configured;
  try {
    const project = JSON.parse(
      readFileSync(join(root, "sfdx-project.json"), "utf8")
    );
    configured = project?.plugins?.testbench?.path;
  } catch {
    configured = undefined;
  }
  return resolve(
    root,
    typeof configured === "string" && configured.trim()
      ? configured
      : "testbench"
  );
}

/** Every `.json` file the paths name: a file as it is, a folder with everything beneath it. */
export function collectFiles(paths) {
  const found = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) {
        if (!name.startsWith(".") && name !== "node_modules") {
          walk(path);
        }
      } else if (name.endsWith(".json")) {
        found.push(path);
      }
    }
  };
  for (const given of paths) {
    const path = resolve(given);
    if (!existsSync(path)) {
      throw new UsageError(`${given} does not exist`);
    }
    if (statSync(path).isDirectory()) {
      walk(path);
    } else {
      found.push(path);
    }
  }
  return [...new Set(found)];
}

/** Reads each file. One that is not JSON comes back without a model, holding that one finding. */
export function loadEntries(paths, schema) {
  return paths.map((path) => {
    let document;
    try {
      document = JSON.parse(readFileSync(path, "utf8"));
    } catch (problem) {
      return {
        path,
        document: null,
        file: null,
        findings: [
          {
            level: ERROR,
            path: "$",
            message: `is not valid JSON: ${problem.message}`
          }
        ]
      };
    }
    return {
      path,
      document,
      file: new TestbenchFile(document, schema),
      findings: []
    };
  });
}

/** The folder of a project file, relative to the Testbench folder, when it follows the layout. */
function categoryFolder(path, folder) {
  const parts = relative(folder, dirname(path)).split(/[\\/]/);
  return parts.length === 2 && !parts[0].startsWith("..") && parts[0] !== ""
    ? parts.join("/")
    : null;
}

/**
 * The rules that span the project's files. Findings are added to the entries they concern.
 *
 * - An item, a test, persona or template, lives in one file only.
 * - Every file in a category folder holds the same category record: whichever copy was pushed last
 *   would otherwise win. A folder holds one category, and a category has one folder.
 * - A file holds one item, as a pull writes it. Several are allowed, with a warning.
 */
export function checkProject(entries, folder) {
  const display = displayPath;
  const itemFiles = new Map();
  const folderCategory = new Map();
  const categoryFolders = new Map();

  for (const entry of entries.filter((each) => each.file)) {
    const inLayout = categoryFolder(entry.path, folder);
    for (const lists of Object.values(KINDS)) {
      entry.file.records(lists.items).forEach((record, index) => {
        const guid = record.GUID__c;
        if (!guid) {
          return;
        }
        const first = itemFiles.get(guid);
        if (first && first !== entry.path) {
          entry.findings.push({
            level: ERROR,
            path: `$.data.${lists.items}[${index}].GUID__c`,
            message: `${guid} is also in ${display(first)}; keep each test, persona or template in one file`
          });
        } else {
          itemFiles.set(guid, entry.path);
        }
      });
      if (inLayout === null) {
        continue;
      }
      const items = entry.file.records(lists.items).length;
      if (items > 1) {
        entry.findings.push({
          level: WARNING,
          path: `$.data.${lists.items}`,
          message: `this file holds ${items} items; the project keeps one test, persona or template per file`
        });
      }
      entry.file.records(lists.categories).forEach((category, index) => {
        const path = `$.data.${lists.categories}[${index}]`;
        const known = folderCategory.get(inLayout);
        if (known === undefined) {
          folderCategory.set(inLayout, {
            record: entry.document.data[lists.categories][index],
            file: entry.path
          });
        } else if (known.record.GUID__c !== category.GUID__c) {
          entry.findings.push({
            level: ERROR,
            path: `${path}.GUID__c`,
            message:
              `${category.GUID__c} is not the category of the other files in this folder, which hold ` +
              `${known.record.GUID__c} (${display(known.file)}); a folder holds one category`
          });
          return;
        } else if (
          !same(known.record, entry.document.data[lists.categories][index])
        ) {
          entry.findings.push({
            level: ERROR,
            path,
            message:
              `differs from the copy in ${display(known.file)}: every file in a category folder holds the ` +
              `same category record, so whichever is pushed last would win`
          });
        }
        const folders = categoryFolders.get(category.GUID__c) ?? new Set();
        folders.add(inLayout);
        categoryFolders.set(category.GUID__c, folders);
        if (folders.size > 1) {
          entry.findings.push({
            level: ERROR,
            path: `${path}.GUID__c`,
            message: `${category.GUID__c} is the category of more than one folder (${[...folders].join(", ")}); a category has one folder`
          });
        }
      });
    }
  }
}
