/**
 * Checks Testbench files: their shape against the schema, the rules a schema cannot express, the
 * rules that span the project's files, and, given an org, what only the org can answer.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ENVELOPE, Schema } from "./model.mjs";
import { checkExternals, checkFields, requireTestbench } from "./orgchecks.mjs";
import {
  checkProject,
  collectFiles,
  findProjectRoot,
  loadEntries,
  testbenchFolder,
  UsageError
} from "./project.mjs";
import { Context, ERROR, Rules, WARNING } from "./rules.mjs";
import { Validator } from "./schema.mjs";

/** The project around cwd: its root folder, and the folder it keeps its Testbench files in. */
export function locateProject(cwd = process.cwd()) {
  const root = findProjectRoot(cwd) ?? resolve(cwd);
  return { root, folder: testbenchFolder(root) };
}

/** What the rules noted as missing from the project, as warnings when no org was given to ask. */
export function offlineFindings(external) {
  return [
    ...external.parents.map(({ object, guid, path }) => ({
      level: WARNING,
      path,
      message: `${guid} is not in the project, so the ${object} must already exist in the target org`
    })),
    ...external.personas.map(({ guid, path }) => ({
      level: WARNING,
      path,
      message: `persona ${guid} is not in the project, so it must already exist, active, in the target org`
    })),
    ...external.dataTemplates.map(({ guid, path }) => ({
      level: WARNING,
      path,
      message: `data template ${guid} is not in the project, so it must already exist, active, in the target org`
    }))
  ];
}

/**
 * Checks the files the paths name, or every file in the project's Testbench folder when none are
 * named. The rest of that folder is read too, so a file may rely on a persona or template another
 * file of the project holds.
 *
 * Resolves to { folder, entries }: each checked file's path, document, model and findings, errors
 * first.
 */
export async function checkFiles({
  paths = [],
  cwd = process.cwd(),
  org = null,
  schema = new Schema()
} = {}) {
  const { folder } = locateProject(cwd);
  const named = paths.map((path) => resolve(cwd, path));
  if (named.length === 0 && !existsSync(folder)) {
    throw new UsageError(
      `no file or folder was named, and the project has no ${folder}`
    );
  }
  const targets = collectFiles(named.length > 0 ? named : [folder]);
  if (targets.length === 0) {
    throw new UsageError(
      `no Testbench files were found in ${named.length > 0 ? paths.join(", ") : folder}`
    );
  }
  const projectFiles = existsSync(folder) ? collectFiles([folder]) : [];
  const entries = loadEntries(
    [...new Set([...targets, ...projectFiles])],
    schema
  );
  const context = new Context(
    entries.filter((entry) => entry.file).map((entry) => entry.file)
  );
  checkProject(entries, folder);

  const validator = new Validator(schema.store);
  const checked = entries.filter((entry) => targets.includes(entry.path));
  const externals = [];
  for (const entry of checked.filter((each) => each.file)) {
    for (const [path, message] of validator.validate(
      entry.document,
      ENVELOPE
    )) {
      entry.findings.push({ level: ERROR, path, message });
    }
    const rules = new Rules(entry.file, schema, context);
    entry.findings.push(...rules.run());
    externals.push({ entry, external: rules.external });
  }

  if (org) {
    await requireTestbench(org);
    for (const [entry, findings] of await checkExternals(org, externals)) {
      entry.findings.push(...findings);
    }
    for (const entry of checked.filter((each) => each.file)) {
      entry.findings.push(...(await checkFields(org, entry.file, schema)));
    }
  } else {
    for (const { entry, external } of externals) {
      entry.findings.push(...offlineFindings(external));
    }
  }
  for (const entry of checked) {
    entry.findings.sort((left, right) =>
      left.level === right.level ? 0 : left.level === ERROR ? -1 : 1
    );
  }
  return { folder, entries: checked };
}
