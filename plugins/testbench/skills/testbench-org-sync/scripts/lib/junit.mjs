/**
 * A run as a JUnit report, the format GitHub, GitLab and Azure DevOps show as test results: a test
 * suite per category and a test case per feature test. A test that failed carries the editor's
 * explanation; one that could not run or finish is an error, never a pass.
 */
import { render } from "./explain.mjs";

const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
};

/** Text made safe for XML: escaped, and without the control characters XML 1.0 forbids. */
function xml(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

/** How a test case ends: passed, failed, skipped, or an error, which covers a test that never ran. */
function verdict(outcome) {
  if (outcome.state !== "finished") {
    return "error";
  }
  switch (outcome.result?.outcome) {
    case "Pass":
      return "passed";
    case "Fail":
      return "failure";
    case "Skip":
      return "skipped";
    default:
      return "error";
  }
}

function tally(outcomes) {
  const of = (wanted) =>
    outcomes.filter((outcome) => verdict(outcome) === wanted).length;
  return `tests="${outcomes.length}" failures="${of("failure")}" errors="${of("error")}" skipped="${of("skipped")}"`;
}

function testCase(outcome, suite) {
  const open = `    <testcase classname="${xml(suite)}" name="${xml(outcome.name)}"`;
  const ending = verdict(outcome);
  if (ending === "passed") {
    return [`${open}/>`];
  }
  if (ending === "skipped") {
    return [`${open}>`, "      <skipped/>", "    </testcase>"];
  }
  let message;
  let type;
  let details;
  if (outcome.state === "finished") {
    const first = outcome.result.explanation?.steps?.[0];
    type = outcome.result.outcome ?? "Unknown";
    message = first
      ? `Step “${first.label}”: ${first.problems[0]?.sentence ?? type}`
      : type;
    details = render(outcome.result.explanation ?? {}, "").join("\n");
  } else {
    type = outcome.state === "still running" ? "StillRunning" : "NotRun";
    message = `${outcome.state}: ${outcome.reason}`;
    details = [outcome.reason, outcome.deployment?.details]
      .filter(Boolean)
      .join("\n");
  }
  const element = ending === "failure" ? "failure" : "error";
  return [
    `${open}>`,
    `      <${element} message="${xml(message)}" type="${xml(type)}">${xml(details)}</${element}>`,
    "    </testcase>"
  ];
}

/** The JUnit report of a run's outcomes, as XML text. */
export function junitReport(outcomes) {
  const suites = new Map();
  for (const outcome of outcomes) {
    const suite = outcome.category ?? "Testbench";
    suites.set(suite, [...(suites.get(suite) ?? []), outcome]);
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="Testbench" ${tally(outcomes)}>`
  ];
  for (const [suite, cases] of suites) {
    lines.push(`  <testsuite name="${xml(suite)}" ${tally(cases)}>`);
    cases.forEach((outcome) => lines.push(...testCase(outcome, suite)));
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n") + "\n";
}
