#!/usr/bin/env node
/**
 * The Testbench agent toolkit's script: checks Testbench files, and works with tests, personas and
 * data templates in an org, which is where they live. A file is a copy: pushing one loads it into an
 * org as the app's import does, and pulling one saves the org's active version.
 *
 * Usage:
 *   node testbench.mjs list [--category <name>] [--target-org <alias>]
 *   node testbench.mjs guid <prefix> [count]
 *   node testbench.mjs check [file or folder ...] [--target-org <alias>]
 *   node testbench.mjs push [file or folder ...] [--target-org <alias>]
 *   node testbench.mjs run [file, folder or GUID ... | --category <name> | --all] [--target-org <alias>]
 *   node testbench.mjs validate [file, folder or GUID ... | --category <name> | --all] [--target-org <alias>]
 *   node testbench.mjs results [file, folder or GUID ... | --category <name> | --all] [--target-org <alias>]
 *   node testbench.mjs pull [file, folder or GUID ... | --category <name> | --all] [--target-org <alias>]
 *   node testbench.mjs delete <GUID ...> [--confirm <code>] [--target-org <alias>]
 *   node testbench.mjs show [file, folder or GUID ...] [--target-org <alias>]
 *
 * **Every org call goes through the Salesforce CLI**, signed in as the developer, so the script
 * never handles a token. `--target-org` takes an alias or username the CLI knows; without it, the
 * CLI's default org is used, except by `check`, which then stays offline, and by `show`, which
 * then reads the org only for a GUID the project does not hold.
 *
 * **It writes to a production org only with `--allow-production`**, which the assistant passes once
 * the developer has said yes. The confirmation belongs in the conversation; the flag makes sure a
 * question that was skipped cannot slip through. **It deletes only with `--confirm`** and the code of
 * the list it showed, for the same reason.
 *
 * **`--json` prints one JSON document** for an assistant to read; otherwise the output is written
 * for a person, and progress while waiting goes to standard error. Exit codes: 0 when everything is
 * in order, 1 when something was found (an error in a file, a failed test, an item refused), 2 when
 * the work could not be done (wrong usage, `sf` missing, the org unreachable or refused).
 *
 * Needs Node 20 or later, and nothing else: it uses Node's built-in modules only.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkFiles, locateProject } from "./lib/check.mjs";
import { executeDelete, planDelete } from "./lib/delete.mjs";
import { GUID_PREFIXES, isGuid, newGuid, recordOf } from "./lib/guid.mjs";
import { junitReport } from "./lib/junit.mjs";
import { listOrg } from "./lib/list.mjs";
import { indexProject } from "./lib/layout.mjs";
import { Schema, TestbenchFile } from "./lib/model.mjs";
import { Org, OrgError } from "./lib/org.mjs";
import { requireTestbench } from "./lib/orgchecks.mjs";
import { preflight } from "./lib/preflight.mjs";
import {
  collectFiles,
  displayPath as display,
  loadEntries,
  UsageError
} from "./lib/project.mjs";
import {
  documentsFromOrg,
  executePull,
  findPullTargets,
  planPull,
  pullSucceeded
} from "./lib/pull.mjs";
import { pushFiles } from "./lib/push.mjs";
import { kindsInOrg } from "./lib/records.mjs";
import { definitionsOf, Names, showFile } from "./lib/show.mjs";
import {
  deletedLines,
  deletionData,
  deletionLines,
  listLines,
  orgLine,
  pullData,
  pullLines,
  pushData,
  pushLines,
  pushSucceeded,
  resultsLines,
  resultsSucceeded,
  runLines,
  runSucceeded,
  validationLines,
  validationSucceeded
} from "./lib/report.mjs";
import { ERROR, WARNING } from "./lib/rules.mjs";
import {
  findItems,
  latestResults,
  runTests,
  validateItems
} from "./lib/run.mjs";

const USAGE = `Usage: node testbench.mjs <command> [options]

Commands:
  list                         What the org holds: each category of tests, personas and templates,
                               with what is in it
  guid <prefix> [count]        New GUIDs: C, T, V, N, P or D, then 32 hex characters
  check [file or folder ...]   Check Testbench files, by default the project's testbench/ folder;
                               with --target-org, against that org too
  push [file or folder ...]    Check, then load what changed as the app's import does, making each
                               file's version active; wait for the deploy, and validate the
                               personas and templates whose definition changed
  run [file, folder or GUID ...]
                               Run feature tests and wait for their results: tests or categories
                               named by GUID as the org holds them, files after loading them
  validate [file, folder or GUID ...]
                               Validate personas and templates and wait for their verdicts, taken
                               the same way as run takes tests
  results [file, folder or GUID ...]
                               The latest results and verdicts, starting nothing
  pull [file, folder or GUID ...]
                               Save the org's tests, personas and templates into the project's
                               files, each as its active version, with what they use; by default
                               every item the project holds
  delete <GUID ...>            List what would be deleted, with a code; with --confirm <code>,
                               delete exactly that
  show [file, folder or GUID ...]
                               Tests, personas and templates in plain words: from the project's
                               files, and from the org for a GUID they do not hold

Options:
  --target-org <alias>         The org, by alias or username; by default the CLI's default org
  --category <name or GUID>    run, validate, results, pull: a category in the org, instead of files
  --all                        run, validate, results: everything in the org with an active
                               version; pull: everything in the org
  --allow-production           Write to a production org: only after the developer has said yes
  --dry-run                    push, run, validate, pull: say what would happen, and change nothing
  --output-dir <folder>        pull: save into this folder, such as a temporary one, instead of
                               the project's testbench/ folder
  --no-push                    run, validate: take the files' items as the org holds them, loading
                               nothing
  --no-validate                push: leave the personas and templates unvalidated
  --no-wait                    push: do not wait for the deploy
  --wait <minutes>             How long to wait for deploys, runs and validations (default 30)
  --junit <file>               run: also write the results as a JUnit report, for a pipeline
  --confirm <code>             delete: the code of the list the developer said yes to
  --json                       Print one JSON document instead of text
  -h, --help                   Show this help`;

function print(text) {
  process.stdout.write(text + "\n");
}

function printLines(lines) {
  lines.forEach((line) => print(line));
}

/** How long a command waits, from --wait. */
function waitOptions(options) {
  if (options.wait === undefined) {
    return {};
  }
  const minutes = Number(options.wait);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new UsageError("--wait takes a number of minutes greater than 0");
  }
  return { timeoutMs: minutes * 60 * 1000 };
}

/** A check's report: its lines for a person and its data, and how many errors it found. */
function checkReport(entries, org) {
  const of = (entry, level) =>
    entry.findings
      .filter((f) => f.level === level)
      .map(({ path, message }) => ({ path, message }));
  const files = entries.map((entry) => ({
    path: display(entry.path),
    errors: of(entry, ERROR),
    warnings: of(entry, WARNING)
  }));
  const errors = files.reduce((sum, file) => sum + file.errors.length, 0);
  const warnings = files.reduce((sum, file) => sum + file.warnings.length, 0);
  const lines = [];
  for (const entry of entries.filter((each) => each.findings.length > 0)) {
    lines.push(display(entry.path));
    for (const finding of entry.findings) {
      lines.push(
        `  ${finding.level.padEnd(8)}${finding.path}: ${finding.message}`
      );
    }
    lines.push("");
  }
  const against = org ? ` against ${org.label}` : "";
  lines.push(
    `Checked ${entries.length} file(s)${against}: ${errors} error(s), ${warnings} warning(s).`
  );
  return { lines, data: { files, errors, warnings }, errors };
}

function guid(positionals, options) {
  const [prefix, count = "1"] = positionals;
  if (!GUID_PREFIXES.includes(prefix)) {
    throw new UsageError(
      `guid needs one of these prefixes: ${GUID_PREFIXES.join(", ")}`
    );
  }
  if (!/^[1-9][0-9]{0,3}$/.test(count)) {
    throw new UsageError("guid's count is a number from 1 to 9999");
  }
  const guids = Array.from({ length: Number(count) }, () => newGuid(prefix));
  print(options.json ? JSON.stringify(guids, null, 2) : guids.join("\n"));
  return 0;
}

async function check(positionals, options) {
  const org = options["target-org"] ? new Org(options["target-org"]) : null;
  try {
    const { entries } = await checkFiles({ paths: positionals, org });
    const report = checkReport(entries, org);
    if (options.json) {
      print(
        JSON.stringify({ org: org?.alias ?? null, ...report.data }, null, 2)
      );
    } else {
      printLines(report.lines);
    }
    return report.errors > 0 ? 1 : 0;
  } finally {
    org?.close();
  }
}

/** Runs a command against an org, closing it afterwards. */
/** Refuses a category of another kind than the command takes, once the org has said its kind. */
async function requireKindsInOrg(org, guids, kinds, what) {
  const found = await kindsInOrg(
    org,
    new Schema(),
    guids.filter((guid) => recordOf(guid).kind === null)
  );
  const other = [...found].find(([, kind]) => !kinds.includes(kind));
  if (other) {
    throw new UsageError(
      `${other[0]} is not one of the ${what} this command takes`
    );
  }
}

async function withOrg(options, work) {
  const org = new Org(options["target-org"] ?? null);
  try {
    return await work(org);
  } finally {
    org.close();
  }
}

/**
 * What run, validate and results are about: files and folders, items or categories named by GUID,
 * or what --category or --all takes from the org. Files are read when named, or when nothing is named
 * at all, from the project's folder. Refuses what cannot work together, a GUID of another kind, and
 * nothing named where nothing is there.
 */
function requireTargets(positionals, options, kinds, what) {
  const { guids, paths } = splitTargets(positionals);
  const fromOrg = options.category !== undefined || options.all === true;
  if (options.category !== undefined && options.all) {
    throw new UsageError("use --category or --all, not both");
  }
  if (fromOrg && positionals.length > 0) {
    throw new UsageError(
      "name files, folders or GUIDs, or use --category or --all, not both"
    );
  }
  // A category's GUID does not say its kind; requireKindsInOrg asks the org once it is reached.
  const other = guids.find((guid) => {
    const { kind } = recordOf(guid);
    return kind !== null && !kinds.includes(kind);
  });
  if (other) {
    throw new UsageError(
      `${other} is not one of the ${what} this command takes`
    );
  }
  if (
    !fromOrg &&
    positionals.length === 0 &&
    !existsSync(locateProject().folder)
  ) {
    throw new UsageError(
      `nothing was named, and the project has no ${display(locateProject().folder)} folder: name ${what} ` +
        `or their category by GUID, a file or folder, or use --category <name> or --all for what is in the org`
    );
  }
  return {
    guids,
    paths,
    fromFiles: !fromOrg && (paths.length > 0 || guids.length === 0)
  };
}

/**
 * The files a push takes, checked against the org. When one holds an error, reports the check and
 * resolves to null: nothing is pushed while an error remains.
 */
async function checkBeforePush(positionals, org, options, output) {
  const { entries } = await checkFiles({ paths: positionals, org });
  const report = checkReport(entries, org);
  output.check = report.data;
  if (report.errors > 0) {
    if (!options.json) {
      printLines([
        ...report.lines,
        "Nothing was pushed: fix the errors above, then push again."
      ]);
    }
    return null;
  }
  if (!options.json && report.data.warnings > 0) {
    printLines([...report.lines, ""]);
  }
  return entries;
}

/** The start of every org command's report: which org, and what to know about it. */
async function prepare(org, options, write) {
  const state = await preflight(org, {
    write: write && !options["dry-run"],
    allowProduction: options["allow-production"]
  });
  if (!options.json) {
    printLines([orgLine(org, state), ...state.notes, ""]);
  }
  return {
    org: org.alias,
    kind: state.kind,
    testbenchVersion: state.version,
    notes: state.notes
  };
}

/** Pushes the files given, for push, run and validate. Resolves to the push, or null when the check stopped it. */
async function pushStep(positionals, org, options, output, { validate }) {
  const entries = await checkBeforePush(positionals, org, options, output);
  if (entries === null) {
    return null;
  }
  const result = await pushFiles(org, entries, new Schema(), {
    dryRun: options["dry-run"],
    waitForDeploy: !options["no-wait"],
    validate,
    wait: waitOptions(options)
  });
  output.push = pushData(result);
  if (!options.json) {
    printLines([...pushLines(result), ""]);
  }
  return { entries, result };
}

function finish(options, output, code) {
  if (options.json) {
    print(JSON.stringify(output, null, 2));
  }
  return code;
}

async function push(positionals, options) {
  return withOrg(options, async (org) => {
    const output = await prepare(org, options, true);
    const pushed = await pushStep(positionals, org, options, output, {
      validate: !options["no-validate"]
    });
    if (pushed === null) {
      return finish(options, output, 1);
    }
    const refused = pushed.result.plan.items.some(
      (item) => item.action === "refused"
    );
    return finish(
      options,
      output,
      pushed.result.dryRun
        ? refused
          ? 1
          : 0
        : pushSucceeded(pushed.result)
          ? 0
          : 1
    );
  });
}

/** True when a push left the org without what the files hold, so running or validating would mislead. */
function pushIncomplete(result) {
  return (
    result.failed.length > 0 ||
    result.plan.items.some((item) => item.action === "refused" || item.skipped)
  );
}

/**
 * For run and validate: the files named, loaded into the org first unless --no-push. Resolves to
 * their entries, none when only GUIDs or the org were named, or null when the work must stop.
 */
async function loadFirst(targets, org, options, output, { validate, stopped }) {
  if (!targets.fromFiles) {
    return [];
  }
  if (options["no-push"]) {
    return (await checkFiles({ paths: targets.paths })).entries;
  }
  const pushed = await pushStep(targets.paths, org, options, output, {
    validate
  });
  if (pushed === null) {
    return null;
  }
  if (!pushed.result.dryRun && pushIncomplete(pushed.result)) {
    if (!options.json) {
      print(stopped);
    }
    return null;
  }
  return pushed.entries;
}

async function run(positionals, options) {
  const targets = requireTargets(
    positionals,
    options,
    ["featureTest"],
    "feature tests"
  );
  return withOrg(options, async (org) => {
    await requireKindsInOrg(
      org,
      targets.guids,
      ["featureTest"],
      "feature tests"
    );
    const output = await prepare(org, options, true);
    const entries = await loadFirst(targets, org, options, output, {
      validate: true,
      stopped:
        "Nothing was run: the org does not hold what the files say. Resolve the items above first."
    });
    if (entries === null) {
      return finish(options, output, 1);
    }
    const items = await findItems(org, ["featureTest"], {
      entries,
      guids: targets.guids,
      category: options.category ?? null,
      all: options.all
    });
    const outcomes = await runTests(org, items.featureTest, {
      dryRun: options["dry-run"],
      wait: waitOptions(options)
    });
    output.run = outcomes;
    if (!options.json) {
      printLines(runLines(outcomes));
    }
    if (options.junit !== undefined && !options["dry-run"]) {
      const report = resolve(options.junit);
      writeFileSync(report, junitReport(outcomes));
      output.junit = display(report);
      if (!options.json) {
        print(`Wrote the JUnit report to ${display(report)}.`);
      }
    }
    return finish(
      options,
      output,
      options["dry-run"] ? 0 : runSucceeded(outcomes) ? 0 : 1
    );
  });
}

async function validate(positionals, options) {
  const targets = requireTargets(
    positionals,
    options,
    ["persona", "dataTemplate"],
    "personas and data templates"
  );
  return withOrg(options, async (org) => {
    await requireKindsInOrg(
      org,
      targets.guids,
      ["persona", "dataTemplate"],
      "personas and data templates"
    );
    const output = await prepare(org, options, true);
    const entries = await loadFirst(targets, org, options, output, {
      validate: false,
      stopped:
        "Nothing was validated: the org does not hold what the files say. Resolve the items above first."
    });
    if (entries === null) {
      return finish(options, output, 1);
    }
    const items = await findItems(org, ["persona", "dataTemplate"], {
      entries,
      guids: targets.guids,
      category: options.category ?? null,
      all: options.all
    });
    const outcomes = await validateItems(org, items, {
      dryRun: options["dry-run"],
      wait: waitOptions(options)
    });
    output.validation = outcomes;
    if (!options.json) {
      printLines(validationLines(outcomes));
    }
    return finish(
      options,
      output,
      options["dry-run"] ? 0 : validationSucceeded(outcomes) ? 0 : 1
    );
  });
}

async function results(positionals, options) {
  const targets = requireTargets(
    positionals,
    options,
    ["featureTest", "persona", "dataTemplate"],
    "tests, personas or data templates"
  );
  return withOrg(options, async (org) => {
    const output = await prepare(org, options, false);
    const entries = targets.fromFiles
      ? (await checkFiles({ paths: targets.paths })).entries
      : [];
    const items = await findItems(
      org,
      ["featureTest", "persona", "dataTemplate"],
      {
        entries,
        guids: targets.guids,
        category: options.category ?? null,
        all: options.all
      }
    );
    const latest = await latestResults(org, items);
    output.results = latest;
    if (!options.json) {
      printLines(resultsLines(latest));
    }
    return finish(options, output, resultsSucceeded(latest) ? 0 : 1);
  });
}

/**
 * What pull and delete were given: GUIDs, and paths for everything else. A step's GUID names no record
 * to pull or delete, and a version's is refused where the command takes whole items.
 */
function splitTargets(positionals, { versions = false } = {}) {
  const guids = [];
  const paths = [];
  for (const given of positionals) {
    if (!isGuid(given)) {
      paths.push(given);
      continue;
    }
    const named = recordOf(given);
    if (named === null || (named.role === "versions" && !versions)) {
      throw new UsageError(
        `${given} is ${named === null ? "a step's" : "a version's"} GUID: name a test, persona or ` +
          `template${versions ? ", a version" : ""}, or a category`
      );
    }
    guids.push(given);
  }
  return { guids, paths };
}

async function pull(positionals, options) {
  const { guids, paths } = splitTargets(positionals);
  const fromOrg = options.category !== undefined || options.all === true;
  if (options.category !== undefined && options.all) {
    throw new UsageError("use --category or --all, not both");
  }
  if (fromOrg && positionals.length > 0) {
    throw new UsageError(
      "name files, folders or GUIDs, or use --category or --all, not both"
    );
  }
  // A named file is saved again where it is, so with a folder given it would not be copied there.
  if (options["output-dir"] !== undefined && paths.length > 0) {
    throw new UsageError(
      "--output-dir saves what GUIDs, --category or --all name: a file named is saved again where " +
        "it is, so name the GUID it holds instead"
    );
  }
  // A copy to change belongs in a folder of its own, so a project that keeps no copies gets none.
  const folder =
    options["output-dir"] !== undefined
      ? resolve(options["output-dir"])
      : locateProject().folder;
  if (!fromOrg && positionals.length === 0 && !existsSync(folder)) {
    throw new UsageError(
      `nothing was named, and there is no ${display(folder)} folder: name a test, persona, ` +
        `template or category by its GUID, or use --category <name> or --all for what is in the org`
    );
  }
  const schema = new Schema();
  const named = paths.length > 0 ? collectFiles(paths) : [];
  const entries = loadEntries(
    [
      ...new Set([
        ...(existsSync(folder) ? collectFiles([folder]) : []),
        ...named
      ])
    ],
    schema
  );
  // An item in a file that cannot be read would be pulled into a second file.
  const unreadable = entries.find((entry) => entry.file === null);
  if (unreadable) {
    throw new UsageError(
      `${display(unreadable.path)} is not valid JSON, so the pull cannot tell which item it holds: fix it, ` +
        `then pull again`
    );
  }
  const refreshed =
    paths.length > 0
      ? entries.filter((entry) => named.includes(entry.path))
      : fromOrg || guids.length > 0
        ? []
        : entries;
  return withOrg(options, async (org) => {
    const output = await prepare(org, options, false);
    const targets = await findPullTargets(org, schema, {
      entries: refreshed,
      guids,
      category: options.category ?? null,
      all: options.all
    });
    if (targets.length === 0) {
      if (!options.json) {
        print("Nothing to pull: no test, persona or template matched.");
      }
      output.pull = null;
      return finish(options, output, 1);
    }
    const plan = await planPull(org, schema, { entries, folder, targets });
    if (!options["dry-run"]) {
      executePull(plan);
    }
    output.pull = pullData(plan, options["dry-run"] === true);
    if (!options.json) {
      printLines(pullLines(plan, options["dry-run"] === true));
    }
    return finish(options, output, pullSucceeded(plan) ? 0 : 1);
  });
}

/**
 * delete: without --confirm, the list of what would go and its code; with the code, the deletion, but
 * only while the list is still the one the code was computed for.
 */
async function remove(positionals, options) {
  const { guids, paths } = splitTargets(positionals, { versions: true });
  if (paths.length > 0) {
    throw new UsageError(
      `delete takes GUIDs only, of tests, personas, templates, their versions or categories, so that ` +
        `nothing is deleted by naming a folder: ${paths[0]} is not one`
    );
  }
  if (guids.length === 0) {
    throw new UsageError(
      "name what to delete by its GUID: a test, persona or template, a version, or a category"
    );
  }
  const confirming = options.confirm !== undefined;
  return withOrg(options, async (org) => {
    const output = await prepare(org, options, confirming);
    const schema = new Schema();
    const { folder } = locateProject();
    const entries = loadEntries(
      existsSync(folder) ? collectFiles([folder]) : [],
      schema
    ).filter((entry) => entry.file);
    const plan = await planDelete(org, schema, guids, { entries });
    if (!confirming || options.confirm !== plan.code) {
      const listChanged = confirming;
      output.delete = deletionData(plan, null, { listChanged });
      if (!options.json) {
        if (listChanged) {
          print(
            "Nothing was deleted: the code is not the one for this list, which may have changed since it " +
              "was shown. This is the list now.\n"
          );
        }
        printLines(deletionLines(plan, org));
      }
      return finish(
        options,
        output,
        listChanged || plan.missing.length > 0 || plan.records.length === 0
          ? 1
          : 0
      );
    }
    const outcome = await executeDelete(org, plan, schema, { entries });
    output.delete = deletionData(plan, outcome);
    if (!options.json) {
      printLines(deletedLines(outcome));
    }
    return finish(
      options,
      output,
      outcome.failed.length > 0 || plan.missing.length > 0 ? 1 : 0
    );
  });
}

/**
 * show: files and folders, by default the project's Testbench folder, and tests, personas or
 * templates by GUID, from the project or, when it does not hold them, from the org.
 */
async function show(positionals, options) {
  const { guids, paths } = splitTargets(positionals);
  const category = guids.find((guid) => recordOf(guid).role === "categories");
  if (category) {
    throw new UsageError(
      `${category} is a category: show its folder, or its tests, personas or templates by their GUIDs`
    );
  }
  const schema = new Schema();
  const { folder } = locateProject();
  const project = existsSync(folder) ? collectFiles([folder]) : [];
  const named =
    paths.length > 0 ? collectFiles(paths) : guids.length > 0 ? [] : project;
  if (named.length === 0 && guids.length === 0) {
    throw new UsageError(
      `nothing was named, and the project has no ${display(folder)} folder: name a file, a folder, or a ` +
        `test, persona or template by its GUID`
    );
  }
  const entries = loadEntries([...new Set([...project, ...named])], schema);
  const unreadable = entries.find(
    (entry) => entry.file === null && named.includes(entry.path)
  );
  if (unreadable) {
    throw new UsageError(`${display(unreadable.path)} is not valid JSON`);
  }
  const names = new Names();
  entries
    .filter((entry) => entry.file)
    .forEach((entry) => names.add(entry.file));
  const shows = entries
    .filter((entry) => entry.file && named.includes(entry.path))
    .map((entry) => ({ file: entry.file, only: null, path: entry.path }));
  const index = indexProject(entries, folder);
  const fromOrg = [];
  for (const guid of guids) {
    const known = index.items.get(guid);
    if (known) {
      shows.push({
        file: known.entry.file,
        only: new Set([guid]),
        path: known.entry.path
      });
    } else {
      fromOrg.push({ kind: recordOf(guid).kind, guid });
    }
  }
  // A GUID the project does not hold is read from the org: the one named, or the CLI's default.
  const org =
    options["target-org"] || fromOrg.length > 0
      ? new Org(options["target-org"] ?? null)
      : null;
  try {
    const missing = [];
    if (org) {
      await requireTestbench(org);
      const documents = await documentsFromOrg(org, schema, fromOrg);
      for (const target of fromOrg) {
        const document = documents.get(target.guid);
        if (!document) {
          missing.push(target.guid);
          continue;
        }
        const file = new TestbenchFile(document, schema);
        names.add(file);
        shows.push({ file, only: new Set([target.guid]), path: null });
      }
      const unknown = { personas: new Set(), templates: new Set() };
      for (const { file } of shows) {
        definitionsOf(file).forEach((version) =>
          names.unknown(version, unknown)
        );
      }
      if (unknown.personas.size > 0 || unknown.templates.size > 0) {
        await names.addFromOrg(org, schema, {
          personas: [...unknown.personas],
          templates: [...unknown.templates]
        });
      }
    }
    const items = shows.flatMap(({ file, only, path }) =>
      showFile(file, schema, names, { only }).map((item) => ({
        ...item,
        file: path ? display(path) : null
      }))
    );
    if (options.json) {
      print(
        JSON.stringify({ org: org?.alias ?? null, items, missing }, null, 2)
      );
    } else {
      items.forEach((item, position) =>
        printLines(position > 0 ? ["", ...item.lines] : item.lines)
      );
      if (missing.length > 0) {
        print(
          `\nNot in the org, or without an active version there: ${missing.join(", ")}`
        );
      }
    }
    return missing.length > 0 ? 1 : 0;
  } finally {
    org?.close();
  }
}

/** list: what the org holds, by kind and category, to choose from. */
async function list(positionals, options) {
  if (positionals.length > 0) {
    throw new UsageError(
      "list takes no files or GUIDs: use --category <name or GUID> for one category"
    );
  }
  return withOrg(options, async (org) => {
    const output = await prepare(org, options, false);
    const listed = await listOrg(org, new Schema(), {
      category: options.category ?? null
    });
    output.list = listed;
    if (!options.json) {
      printLines(listLines(listed));
    }
    return finish(options, output, 0);
  });
}

const ORG = { "target-org": { type: "string", short: "o" } };
const WRITE = {
  ...ORG,
  "allow-production": { type: "boolean" },
  "dry-run": { type: "boolean" },
  wait: { type: "string" }
};
const FROM_ORG = { category: { type: "string" }, all: { type: "boolean" } };

const COMMANDS = {
  guid: { run: guid, options: {} },
  check: { run: check, options: ORG },
  push: {
    run: push,
    options: {
      ...WRITE,
      "no-validate": { type: "boolean" },
      "no-wait": { type: "boolean" }
    }
  },
  run: {
    run,
    options: {
      ...WRITE,
      ...FROM_ORG,
      "no-push": { type: "boolean" },
      junit: { type: "string" }
    }
  },
  validate: {
    run: validate,
    options: { ...WRITE, ...FROM_ORG, "no-push": { type: "boolean" } }
  },
  results: { run: results, options: { ...ORG, ...FROM_ORG } },
  pull: {
    run: pull,
    options: {
      ...ORG,
      ...FROM_ORG,
      "dry-run": { type: "boolean" },
      "output-dir": { type: "string" }
    }
  },
  delete: {
    run: remove,
    options: {
      ...ORG,
      confirm: { type: "string" },
      "allow-production": { type: "boolean" }
    }
  },
  show: { run: show, options: ORG },
  list: { run: list, options: { ...ORG, category: { type: "string" } } }
};

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || ["-h", "--help", "help"].includes(command)) {
    print(USAGE);
    return command ? 0 : 2;
  }
  const spec = COMMANDS[command];
  if (!spec) {
    throw new UsageError(
      `unknown command ${JSON.stringify(command)}\n\n${USAGE}`
    );
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        ...spec.options
      }
    });
  } catch (problem) {
    throw new UsageError(problem.message);
  }
  if (parsed.values.help) {
    print(USAGE);
    return 0;
  }
  return spec.run(parsed.positionals, parsed.values);
}

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  process.stderr.write(
    `The Testbench script needs Node 20 or later; this is Node ${process.versions.node}.\n`
  );
  process.exit(2);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (problem) {
  if (problem instanceof UsageError || problem instanceof OrgError) {
    process.stderr.write(`${problem.message}\n`);
    process.exitCode = 2;
  } else {
    throw problem;
  }
}
