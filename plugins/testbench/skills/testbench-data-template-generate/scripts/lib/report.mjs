/**
 * What the commands report: text for a person, and the same as data for `--json`.
 *
 * Each command's report says, per test, persona or template, what happened and what to do next, in
 * the words the Testbench app uses. A problem is never summarised away: every failing step is listed
 * with the sentence the editor would show.
 */
import { render } from "./explain.mjs";
import { displayPath } from "./project.mjs";
import { pullSucceeded } from "./pull.mjs";

const NOUNS = {
  featureTest: "Feature test",
  persona: "Persona",
  dataTemplate: "Data template"
};

/** "Feature test “Name”". */
function title(kind, name) {
  return `${NOUNS[kind]} “${name}”`;
}

/** The org, as a line for the top of a report. */
export function orgLine(org, preflight) {
  const version = preflight.version
    ? `Testbench ${preflight.version}`
    : "Testbench deployed from source";
  return `${org.label}: a ${preflight.kind}, ${version}.`;
}

/** What a push did to one item, or would do in a dry run, in words. */
function pushAction(item, dryRun) {
  if (item.failed) {
    return "failed";
  }
  if (item.skipped) {
    return "not pushed: an earlier list failed";
  }
  const replacing = item.replaced
    ? `, in place of “${item.replaced.name}” (${item.replaced.guid}), which stays in the org, inactive`
    : "";
  const made = dryRun ? "would be made active" : "made active";
  switch (item.action) {
    case "create":
      return dryRun ? "would be created" : "created";
    case "new version":
      return `new version ${item.version} ${made}${replacing}`;
    case "activate":
      return `version ${item.version} ${made}${replacing}`;
    case "update":
      return dryRun ? "would be updated" : "updated";
    default:
      return item.action;
  }
}

function deploymentLine(deployment) {
  if (!deployment) {
    return null;
  }
  if (!deployment.ended) {
    return "still deploying";
  }
  return deployment.status === "Deployed"
    ? "deployed"
    : `${deployment.status}${deployment.details ? `: ${deployment.details}` : ""}`;
}

function verdictLines(outcome, prefix) {
  if (outcome.state !== "finished") {
    return [`${prefix}${outcome.state}: ${outcome.reason}`];
  }
  const verdict = outcome.verdict;
  return [
    `${prefix}${verdict.outcome === "Valid" ? "valid" : (verdict.outcome ?? "no verdict").toLowerCase()}`,
    ...render(verdict.explanation, prefix + "  ")
  ];
}

/** True when a push left nothing to fix: no item refused or failed, every deployment and validation good. */
export function pushSucceeded(result) {
  return (
    result.plan.items.every(
      (item) => item.action !== "refused" && !item.failed && !item.skipped
    ) &&
    result.failed.length === 0 &&
    !result.timedOut &&
    result.plan.items.every(
      (item) => !item.deployment || item.deployment.status === "Deployed"
    ) &&
    result.validations.every(
      (outcome) =>
        outcome.state === "finished" && outcome.verdict.outcome === "Valid"
    )
  );
}

/** A push's report, as lines. */
export function pushLines(result) {
  const lines = [];
  const validations = new Map(
    result.validations.map((outcome) => [outcome.guid, outcome])
  );
  for (const item of result.plan.items) {
    lines.push(title(item.kind, item.name));
    if (item.action === "refused") {
      lines.push(`  refused: ${item.reason}`);
      continue;
    }
    lines.push(`  ${pushAction(item, result.dryRun === true)}`);
    for (const failure of result.failed.filter(
      (each) => each.guid === item.guid || each.guid === item.version
    )) {
      lines.push(`  ${failure.errors.join("; ")}`);
    }
    const deployed = deploymentLine(item.deployment);
    if (deployed) {
      lines.push(`  ${deployed}`);
    }
    if (validations.has(item.guid)) {
      lines.push(...verdictLines(validations.get(item.guid), "  "));
    }
  }
  const categories = result.plan.categories.filter(
    (category) => category.action !== "unchanged"
  );
  for (const category of categories) {
    const failure = result.failed.find((each) => each.guid === category.guid);
    lines.push(
      `${NOUNS[category.kind]} category “${category.name}”: ${failure ? `failed: ${failure.errors.join("; ")}` : category.action === "create" ? "created" : "updated"}`
    );
  }
  const count = (action) =>
    result.plan.items.filter((item) => item.action === action).length;
  lines.push(
    "",
    `${result.dryRun ? "Would push" : "Pushed"} ${result.plan.items.length} item(s): ${count("create")} created, ` +
      `${count("new version")} new version(s), ${count("activate")} made active again, ${count("update")} updated, ` +
      `${count("unchanged")} unchanged, ${count("refused")} refused.`
  );
  const replacing = result.plan.items.filter((item) => item.replaced).length;
  if (replacing > 0) {
    lines.push(
      `${replacing} of them ${result.dryRun ? "would take" : "took"} over from another active version, kept in the ` +
        `org: it can be made active again in the Testbench app.`
    );
  }
  if (result.timedOut) {
    lines.push(
      "Some deployments had not ended in the time allowed; they go on in the org. Push again to wait for them."
    );
  }
  return lines;
}

/** A push's report, as data. */
export function pushData(result) {
  const validations = new Map(
    result.validations.map((outcome) => [outcome.guid, outcome])
  );
  return {
    dryRun: result.dryRun === true,
    succeeded: !result.dryRun && pushSucceeded(result),
    items: result.plan.items.map((item) => ({
      kind: item.kind,
      guid: item.guid,
      name: item.name,
      file: displayPath(item.file),
      action: item.action,
      reason: item.reason ?? null,
      version: item.version,
      replaced: item.replaced ?? null,
      failed: item.failed === true,
      errors: result.failed
        .filter((each) => [item.guid, item.version].includes(each.guid))
        .flatMap((each) => each.errors),
      notPushed: item.skipped === true,
      deployment: item.deployment ?? null,
      validation: validations.get(item.guid) ?? null
    })),
    categories: result.plan.categories
      .filter((category) => category.action !== "unchanged")
      .map(({ kind, guid, name, action }) => ({ kind, guid, name, action })),
    timedOut: result.timedOut
  };
}

/** A run's report, as lines. */
export function runLines(outcomes) {
  const lines = [];
  for (const outcome of outcomes) {
    lines.push(title("featureTest", outcome.name));
    if (outcome.state === "finished") {
      lines.push(
        `  ${outcome.result.outcome}`,
        ...render(outcome.result.explanation, "    ")
      );
    } else if (outcome.state === "would run") {
      lines.push("  would run");
    } else {
      lines.push(`  ${outcome.state}: ${outcome.reason}`);
      if (outcome.deployment?.details) {
        lines.push(
          `    ${outcome.deployment.status}: ${outcome.deployment.details}`
        );
      }
    }
  }
  const passed = outcomes.filter(
    (outcome) => outcome.result?.outcome === "Pass"
  ).length;
  const planned = outcomes.filter(
    (outcome) => outcome.state === "would run"
  ).length;
  lines.push(
    "",
    planned > 0 || outcomes.length === 0
      ? `Would run ${planned} of ${outcomes.length} test(s). Every run counts against the org's daily allowance of Apex test runs.`
      : `${outcomes.length} test(s): ${passed} passed, ${outcomes.length - passed} did not.`
  );
  return lines;
}

/** True when every test ran and passed. */
export function runSucceeded(outcomes) {
  return outcomes.every(
    (outcome) =>
      outcome.state === "finished" && outcome.result?.outcome === "Pass"
  );
}

/** A validation's report, as lines. */
export function validationLines(outcomes) {
  const lines = [];
  for (const outcome of outcomes) {
    lines.push(title(outcome.kind, outcome.name));
    if (outcome.state === "would validate") {
      lines.push("  would validate");
    } else {
      lines.push(...verdictLines(outcome, "  "));
    }
  }
  const valid = outcomes.filter(
    (outcome) => outcome.verdict?.outcome === "Valid"
  ).length;
  const planned = outcomes.filter(
    (outcome) => outcome.state === "would validate"
  ).length;
  lines.push(
    "",
    planned > 0 || outcomes.length === 0
      ? `Would validate ${planned} of ${outcomes.length}. Every validation counts against the org's daily allowance of Apex test runs.`
      : `${outcomes.length} persona(s) and template(s): ${valid} valid, ${outcomes.length - valid} not.`
  );
  return lines;
}

/** True when every persona and template validated, and is valid. */
export function validationSucceeded(outcomes) {
  return outcomes.every(
    (outcome) =>
      outcome.state === "finished" && outcome.verdict?.outcome === "Valid"
  );
}

const HEADINGS = {
  featureTest: "Feature tests",
  persona: "Personas",
  dataTemplate: "Data templates"
};

/** What an org holds, by kind and category, as lines. */
export function listLines(listed) {
  const lines = [];
  for (const kind of ["featureTest", "persona", "dataTemplate"]) {
    lines.push(HEADINGS[kind]);
    if (listed[kind].length === 0) {
      lines.push("  none", "");
      continue;
    }
    for (const category of listed[kind]) {
      lines.push(
        `  Category “${category.name}” (${category.guid})` +
          (category.description ? `: ${category.description}` : "")
      );
      if (category.items.length === 0) {
        lines.push("    nothing in it yet");
      }
      for (const item of category.items) {
        lines.push(
          `    “${item.name}” (${item.guid})` +
            (item.type ? `, ${item.type}` : "") +
            (item.active ? "" : ", no active version")
        );
      }
    }
    lines.push("");
  }
  return lines;
}

/** A pull's report, as lines. */
export function pullLines(plan, dryRun = false) {
  const lines = [];
  const would = (done, planned) => (dryRun ? planned : done);
  for (const item of plan.items) {
    lines.push(title(item.kind, item.name));
    const file = item.file ? displayPath(item.file) : null;
    switch (item.action) {
      case "create":
        lines.push(`  ${would("created", "would create")} ${file}`);
        break;
      case "update":
        lines.push(`  ${would("updated", "would update")} ${file}`);
        break;
      case "move":
        lines.push(
          `  ${would("moved", "would move")} ${displayPath(item.from)} to ${file}: its category changed in the app`
        );
        break;
      case "unchanged":
        lines.push(`  unchanged, ${file}`);
        break;
      case "conflict":
        lines.push(`  stopped: ${item.reason}`);
        break;
      case "inactive":
        if (file) {
          lines.push(`  kept the file's version: ${item.reason}`);
          if (plan.writes.has(item.file)) {
            lines.push(`  ${would("updated", "would update")} ${file}`);
          }
          break;
        }
        lines.push(`  not pulled: ${item.reason}`);
        break;
      default:
        lines.push(`  not pulled: ${item.reason}`);
    }
    if (item.usedBy) {
      lines.push(
        `  pulled because ${title(item.usedBy.kind, item.usedBy.name)} uses it`
      );
    }
  }
  for (const category of plan.categories) {
    lines.push(
      `${NOUNS[category.kind]} category “${category.name}”: ${would("updated", "would be updated")} in ` +
        `${category.files.length} more file(s) of its folder`
    );
  }
  const count = (...actions) =>
    plan.items.filter((item) => actions.includes(item.action)).length;
  lines.push(
    "",
    `${would("Pulled", "Would pull")} ${plan.items.length} item(s): ${count("create")} created, ${count("update")} updated, ` +
      `${count("move")} moved, ${count("unchanged")} unchanged, ${count("conflict")} stopped, ` +
      `${count("gone", "missing")} not in the org, ${count("inactive")} without an active version.`
  );
  if (!dryRun && plan.writes.size > 0) {
    lines.push("See exactly what changed with git diff.");
  }
  return lines;
}

/** A pull's report, as data. */
export function pullData(plan, dryRun = false) {
  const shown = (path) => (path ? displayPath(path) : null);
  return {
    dryRun,
    succeeded: !dryRun && pullSucceeded(plan),
    items: plan.items.map((item) => ({
      kind: item.kind,
      guid: item.guid,
      name: item.name,
      action: item.action,
      file: shown(item.file),
      from: shown(item.from),
      reason: item.reason,
      usedBy: item.usedBy,
      written: item.file !== null && plan.writes.has(item.file)
    })),
    categories: plan.categories.map((category) => ({
      ...category,
      files: category.files.map(shown)
    })),
    written: [...plan.writes.keys()].map(shown),
    removed: plan.removals.map(shown)
  };
}

const PLURALS = {
  featureTest: "feature test(s)",
  persona: "persona(s)",
  dataTemplate: "data template(s)"
};

/** A record named for deletion, as the list shows it. */
function deletionTitle(record) {
  if (record.role === "categories") {
    return `${NOUNS[record.kind]} category “${record.name}”`;
  }
  if (record.role === "versions") {
    return (
      `${NOUNS[record.kind]} version “${record.name}” of “${record.parent}”` +
      (record.active ? ", its active version" : "")
    );
  }
  return title(record.kind, record.name);
}

/** What a delete would remove, and what to know first, as lines. */
export function deletionLines(plan, org) {
  const lines = [];
  if (plan.records.length === 0) {
    lines.push("Nothing to delete: none of these is in the org.");
  } else {
    lines.push(`Would delete from ${org.label}:`);
    for (const record of plan.records) {
      lines.push(`  ${deletionTitle(record)} (${record.guid})`);
      const items = plan.beneath.filter(
        (each) => each.role === "items" && each.under === record.guid
      );
      if (items.length > 0) {
        lines.push(
          `    with its ${items.length} ${PLURALS[record.kind]}: ${items.map((each) => `“${each.name}”`).join(", ")}`
        );
      }
      const owners = new Set([record.guid, ...items.map((each) => each.guid)]);
      const versions = plan.beneath.filter(
        (each) => each.role === "versions" && owners.has(each.under)
      ).length;
      if (versions > 0) {
        lines.push(
          `    ${items.length > 0 ? "and their" : "with its"} ${versions} version(s)`
        );
      }
    }
    if (plan.results > 0) {
      lines.push(`  and ${plan.results} test result(s) with them`);
    }
  }
  if (plan.usedBy.length > 0) {
    lines.push("", "Still in use, and failing until changed:");
    for (const user of plan.usedBy) {
      lines.push(
        `  ${title(user.kind, user.name)} uses ${user.uses.map((used) => `${NOUNS[used.kind].toLowerCase()} “${used.name}”`).join(", ")}`
      );
    }
  }
  if (plan.refused.length > 0) {
    lines.push("", "Refused by Testbench for now:");
    for (const each of plan.refused) {
      lines.push(`  ${deletionTitle(each)}: ${each.reason}`);
    }
  }
  if (plan.missing.length > 0) {
    lines.push(
      "",
      `Not in the org, so not deleted: ${plan.missing.join(", ")}`
    );
  }
  const files = [
    ...plan.files.remove.map((path) => `  remove ${displayPath(path)}`),
    ...plan.files.update.map((path) => `  update ${displayPath(path)}`)
  ];
  if (files.length > 0) {
    lines.push("", "The project's files, with the same yes:", ...files);
  }
  if (plan.records.length > 0) {
    lines.push(
      "",
      `Deleting cannot be undone. Once the developer has said yes to exactly this, run the same command ` +
        `with --confirm ${plan.code}.`
    );
  }
  return lines;
}

/** What a confirmed delete did, as lines. */
export function deletedLines(outcome) {
  const lines = [];
  if (outcome.deleted.length > 0) {
    lines.push("Deleted:");
    for (const record of outcome.deleted) {
      lines.push(
        `  ${deletionTitle(record)}${record.role === "versions" ? "" : ", with everything in it"}`
      );
    }
  }
  if (outcome.failed.length > 0) {
    lines.push("Not deleted:");
    for (const record of outcome.failed) {
      lines.push(
        `  ${deletionTitle(record)}: ${record.errors.join("; ") || "the org gave no reason"}`
      );
    }
  }
  if (outcome.removed.length > 0) {
    lines.push(
      `Removed from the project: ${outcome.removed.map(displayPath).join(", ")}`
    );
  }
  if (outcome.updated.length > 0) {
    lines.push(
      `Updated in the project: ${outcome.updated.map(displayPath).join(", ")}`
    );
  }
  return lines;
}

/** A delete's report, as data: the list, and what was done when it was confirmed. */
export function deletionData(
  plan,
  outcome = null,
  { listChanged = false } = {}
) {
  const deleted = new Set((outcome?.deleted ?? []).map((each) => each.guid));
  const errors = new Map(
    (outcome?.failed ?? []).map((each) => [each.guid, each.errors])
  );
  return {
    code: plan.code,
    confirmed: outcome !== null,
    listChanged,
    records: plan.records.map(({ kind, role, guid, name, parent, active }) => ({
      kind,
      role,
      guid,
      name,
      parent,
      active,
      deleted: outcome ? deleted.has(guid) : null,
      errors: errors.get(guid) ?? []
    })),
    beneath: plan.beneath.map(({ kind, role, guid, name, under }) => ({
      kind,
      role,
      guid,
      name,
      under
    })),
    results: plan.results,
    usedBy: plan.usedBy,
    refused: plan.refused,
    missing: plan.missing,
    files: outcome
      ? {
          removed: outcome.removed.map(displayPath),
          updated: outcome.updated.map(displayPath)
        }
      : {
          remove: plan.files.remove.map(displayPath),
          update: plan.files.update.map(displayPath)
        }
  };
}

/** The latest results' report, as lines. */
export function resultsLines(latest) {
  const lines = [];
  for (const test of latest.tests) {
    lines.push(title("featureTest", test.name));
    if (!test.inOrg) {
      lines.push("  not in the org");
    } else if (!test.result) {
      lines.push("  no result yet");
    } else {
      lines.push(
        `  ${test.result.outcome}, ${test.result.at}`,
        ...render(test.result.explanation, "    ")
      );
    }
  }
  for (const item of latest.verdicts) {
    lines.push(title(item.kind, item.name));
    if (!item.inOrg) {
      lines.push("  not in the org");
    } else if (!item.verdict?.outcome) {
      lines.push(
        `  not validated yet${item.status ? ` (${item.status})` : ""}`
      );
    } else {
      lines.push(
        `  ${item.verdict.outcome}, ${item.verdict.at}`,
        ...render(item.verdict.explanation, "    ")
      );
    }
  }
  return lines;
}

/** True when every latest result passed and every verdict is valid. */
export function resultsSucceeded(latest) {
  return (
    latest.tests.every((test) => test.result?.outcome === "Pass") &&
    latest.verdicts.every((item) => item.verdict?.outcome === "Valid")
  );
}
