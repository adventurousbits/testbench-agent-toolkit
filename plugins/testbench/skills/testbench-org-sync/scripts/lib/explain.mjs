/**
 * Turns a stored run result, or a persona's or template's verdict, into the sentences the Testbench
 * editor shows.
 *
 * The sentences come from `data/status-codes.json`, generated from the package's own labels, and are
 * filled in the way the editor fills them (`exceptionMessages.js` in the package), so an explanation
 * here reads like the editor's sidebar. The editor's rendering is followed, not improved on: a
 * problem the editor words badly is fixed in the package, and reaches this file through the
 * catalogue.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject } from "./schema.mjs";

/** The catalogue, in the data folder beside the scripts folder. */
export const CATALOGUE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "status-codes.json"
);

const CONTEXT_KINDS = { persona: "Persona", data_template: "Data template" };

/**
 * Strips the platform's English boilerplate from a save error before it is shown, as the editor
 * does: the link to the exception code list, the hint to give an admin the details, the records a
 * flow tried to change, the code prefixes and suffixes, the "Insert failed. First exception on row
 * 0" wrapper, and the trailing list of the fields the error already names.
 */
export function cleanMessage(message) {
  return String(message ?? "")
    .replace(/You can look up ExceptionCode values[\s\S]*?<\/a>\.?/gi, "")
    .replace(/Give your Salesforce admin these details\.?/gi, "")
    .replace(/The flow tried to \w+ these records:[^.]*\.?/gi, "")
    .replace(/This error occurred:\s*[A-Z_]+:\s*/g, "")
    .replace(/\(status code [A-Za-z0-9_]+\)\.?/g, "")
    .replace(
      /^\s*(?:Insert|Update|Upsert|Delete|Undelete) failed\. First exception on row \d+(?: with id \w+)?; first error: [A-Z_]+,\s*/i,
      ""
    )
    .replace(/:\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The status codes' sentences, as the editor shows them. */
export class Catalogue {
  constructor(path = CATALOGUE_PATH) {
    const data = JSON.parse(readFileSync(path, "utf8"));
    this.labels = data.labels;
    this.mapped = data.messageMappedLabels;
    this.operators = data.operatorWords;
    this.fallback = data.fallback;
  }

  /** The sentence the editor shows for one reported problem. */
  sentence(entry) {
    const code = entry.status_code;
    const message = cleanMessage(entry.message);
    const fields = (entry.fields ?? []).join(", ");
    let key = code;
    for (const rule of this.mapped) {
      if (
        code === rule.statusCode &&
        new RegExp(rule.messagePattern, "i").test(String(entry.message ?? ""))
      ) {
        key = rule.label;
      }
    }
    const fallback = message
      ? this.fallback.withMessage
      : this.fallback.withoutMessage;
    let label = this.labels[key] ?? fallback;
    // A label built around a value says nothing without it, so the editor falls back to the
    // generic sentence rather than show a hole where the answer should be.
    if (
      (!fields && label.includes("{fields}")) ||
      (!message && label.includes("{message}"))
    ) {
      label = fallback;
    }
    const values = {
      "{message}": message,
      "{fields}": fields,
      "{actual}": entry.actual,
      "{expected}": entry.expected,
      "{operator}": this.operators[entry.operator] ?? entry.operator,
      "{exception_type}": entry.exception_type,
      "{status_code}": code,
      "{api_name}": entry.api_name
    };
    for (const [placeholder, value] of Object.entries(values)) {
      label = label.replaceAll(placeholder, () => String(value ?? ""));
    }
    return label;
  }
}

/**
 * Where each scope of a result is, by its id: every persona or template from the outermost in, by
 * name where one is known, and the field that reaches it, such as
 * `Persona “Sales manager” via ManagerId › Data template “Customer account”`.
 */
export function describeContexts(contexts, names = new Map()) {
  const byId = new Map(
    (contexts ?? []).map((context) => [context.id, context])
  );
  const lines = new Map();
  const describe = (id, seen) => {
    if (lines.has(id)) {
      return lines.get(id);
    }
    const context = byId.get(id);
    // A parent missing from the table, or a table that loops, ends the path.
    if (!context || seen.has(id)) {
      return "";
    }
    seen.add(id);
    const kind = CONTEXT_KINDS[context.kind] ?? context.kind ?? "";
    const name = names.get(context.guid) ?? context.guid ?? "";
    const segment =
      `${kind} “${name}”` + (context.field ? ` via ${context.field}` : "");
    const parent =
      context.parent === undefined || context.parent === null
        ? ""
        : describe(context.parent, seen);
    const line = parent ? `${parent} › ${segment}` : segment;
    lines.set(id, line);
    return line;
  };
  byId.forEach((_context, id) => describe(id, new Set()));
  return lines;
}

/** The stored result as an object, or null when it holds plain text or nothing. */
export function parseDetails(details) {
  if (!details) {
    return null;
  }
  try {
    const parsed = JSON.parse(details);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The personas and templates a result's contexts name, by kind, for looking their names up. */
export function contextGuids(details) {
  const contexts = parseDetails(details)?.contexts ?? [];
  const of = (kind) => [
    ...new Set(
      contexts
        .filter((context) => context.kind === kind && context.guid)
        .map((context) => context.guid)
    )
  ];
  return { personas: of("persona"), dataTemplates: of("data_template") };
}

/**
 * An explanation of `Outcome_Details__c` or `Validation_Message__c`:
 *
 * - `steps`: each step with problems, by `guid` and `label`, each problem with its `statusCode`, its
 *   `sentence` and, for one found inside a persona or template, its `context`. A step's own
 *   problems come before those captured inside what it used, as the editor shows them.
 * - `general`: what stopped the run outside every step, or null.
 * - `omitted`: how many steps and problems were left out of a result too long to store.
 * - `text`: a result that is plain text, such as a run that could not start at all.
 */
export function explain(
  details,
  { names = new Map(), catalogue = new Catalogue() } = {}
) {
  const explanation = { steps: [], general: null, omitted: null, text: null };
  if (!details) {
    return explanation;
  }
  const payload = parseDetails(details);
  if (payload === null) {
    explanation.text = String(details);
    return explanation;
  }
  if (payload.generalStatusCode) {
    explanation.general = catalogue.sentence({
      status_code: payload.generalStatusCode
    });
  }
  if (payload.general) {
    explanation.general = String(payload.general);
  }
  if (payload.omitted_nodes || payload.omitted_entries) {
    explanation.omitted = {
      steps: payload.omitted_nodes ?? 0,
      problems: payload.omitted_entries ?? 0
    };
  }
  const lines = describeContexts(payload.contexts, names);
  for (const node of payload.nodes ?? []) {
    const entries = (node.exceptions ?? []).filter(isObject);
    const own = entries.filter(
      (entry) => entry.context === undefined || entry.context === null
    );
    const captured = entries.filter(
      (entry) => entry.context !== undefined && entry.context !== null
    );
    const problems = [...own, ...captured].map((entry) => {
      const scope = entry.about ?? entry.context;
      return {
        statusCode: entry.status_code ?? null,
        sentence: catalogue.sentence(entry),
        context:
          scope === undefined || scope === null
            ? null
            : (lines.get(scope) ?? null)
      };
    });
    if (problems.length > 0) {
      explanation.steps.push({ guid: node.guid, label: node.label, problems });
    }
  }
  return explanation;
}

/** An explanation as lines of text for a person, indented by the prefix given. */
export function render(explanation, prefix = "") {
  const lines = [];
  if (explanation.text) {
    lines.push(`${prefix}${explanation.text}`);
  }
  if (explanation.general) {
    lines.push(
      `${prefix}Stopped outside every step: ${explanation.general.split("\n")[0]}`
    );
  }
  for (const step of explanation.steps) {
    lines.push(`${prefix}Step “${step.label}”:`);
    for (const problem of step.problems) {
      const where = problem.context ? `${problem.context}: ` : "";
      const code = problem.statusCode ? ` (${problem.statusCode})` : "";
      lines.push(`${prefix}  - ${where}${problem.sentence}${code}`);
    }
  }
  if (explanation.omitted) {
    lines.push(
      `${prefix}The result was too long to store in full: ${explanation.omitted.steps} step(s) and ` +
        `${explanation.omitted.problems} problem(s) were left out. Fix the problems shown first.`
    );
  }
  return lines;
}
