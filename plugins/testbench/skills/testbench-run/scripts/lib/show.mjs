/**
 * Shows tests, personas and data templates as their author reads them: each step under the editor's
 * name for it, with its label and what it does, naming the personas, templates, template records and
 * earlier steps it refers to rather than their GUIDs.
 *
 * Names come from the project first, so a file shows without an org, and from the org for what the
 * project does not hold. A name found in neither is shown as its GUID, saying so.
 */
import { Catalogue } from "./explain.mjs";
import { KINDS, parseJsonText } from "./model.mjs";
import { namespaced } from "./org.mjs";
import { activeVersions, namesByGuid } from "./records.mjs";
import { isObject } from "./schema.mjs";

const PERSONA = /^P[0-9a-f]{32}$/;
const TEMPLATE = /^D[0-9a-f]{32}$/;
const TEMPLATE_RECORD = /^(D[0-9a-f]{32}):N[0-9a-f]{32}$/;

const NOUNS = {
  featureTest: "Feature test",
  persona: "Persona",
  dataTemplate: "Data template"
};

// A persona's lists, by the names the persona editor gives them.
const PERSONA_LISTS = {
  Permission_Sets__c: "Permission sets",
  Permission_Set_Groups__c: "Permission set groups",
  Permission_Set_Licenses__c: "Permission set licenses",
  Group_Memberships__c: "Public groups and queues",
  Territory_Assignments__c: "Territories"
};

/** The names a file can be shown with: items and categories by GUID, templates' records by reference. */
export class Names {
  constructor() {
    this.items = new Map();
    this.records = new Map();
  }

  /** Learns the names a Testbench file holds. */
  add(file) {
    for (const lists of Object.values(KINDS)) {
      for (const array of [lists.categories, lists.items]) {
        for (const record of file.records(array)) {
          if (record.GUID__c) {
            this.items.set(record.GUID__c, record.Name);
          }
        }
      }
    }
    for (const version of file.records("dataTemplateVersions")) {
      const nodes = Array.isArray(version.Definition_Data__c)
        ? version.Definition_Data__c
        : [];
      for (const node of nodes.filter(isObject)) {
        this.records.set(
          `${version.Data_Template__c}:${node.guid}`,
          node.label
        );
      }
    }
  }

  /** The personas and templates a value names whose names are not known yet. */
  unknown(value, found = { personas: new Set(), templates: new Set() }) {
    if (typeof value === "string") {
      const record = TEMPLATE_RECORD.exec(value);
      if (PERSONA.test(value) && !this.items.has(value)) {
        found.personas.add(value);
      } else if (TEMPLATE.test(value) && !this.items.has(value)) {
        found.templates.add(value);
      } else if (record && !this.records.has(value)) {
        found.templates.add(record[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach((each) => this.unknown(each, found));
    } else if (isObject(value)) {
      Object.values(value).forEach((each) => this.unknown(each, found));
    }
    return found;
  }

  /** Asks the org for the names of personas and templates, and for the records of the templates. */
  async addFromOrg(org, schema, { personas = [], templates = [] }) {
    const names = await namesByGuid(org, {
      personas,
      dataTemplates: templates
    });
    names.forEach((name, guid) => this.items.set(guid, name));
    const order = schema.pushOrder.find(
      (each) => each.array === "dataTemplateVersions"
    );
    const definitions = namespaced("Definition_Data__c");
    for (const [template, version] of await activeVersions(
      org,
      order,
      [definitions],
      templates
    )) {
      const nodes = parseJsonText(version[definitions] ?? null);
      for (const node of (Array.isArray(nodes) ? nodes : []).filter(isObject)) {
        this.records.set(`${template}:${node.guid}`, node.label);
      }
    }
  }
}

/** The editor's name for a step, or for the kind of check a Verify Outcome step makes. */
function stepTitle(schema, node) {
  const entry = schema.steps.get(node?.type);
  if (entry === undefined) {
    return String(node?.type ?? "Unknown step");
  }
  const [stepFile, step] = entry;
  const subtypeKey = step["x-testbench"]?.subtypeKey;
  if (subtypeKey) {
    const chosen = isObject(node.details) ? node.details[subtypeKey] : null;
    for (const branch of step.properties.details.anyOf ?? []) {
      const [, sub] = schema.store.follow(stepFile, branch);
      if (sub["x-testbench"]?.[subtypeKey] === chosen && sub.title) {
        return sub.title;
      }
    }
  }
  return step.title ?? node.type;
}

/** Renders the items of one Testbench file. */
class Renderer {
  constructor(schema, names, catalogue) {
    this.schema = schema;
    this.names = names;
    this.operators = catalogue.operators;
    this.formats = schema.common.valueFormats;
  }

  named(guid, noun) {
    const name = this.names.items.get(guid);
    return name === undefined
      ? `${noun} ${guid}, whose name is not in the project`
      : `${noun} “${name}”`;
  }

  /** A value as a reader takes it: what a reference points at, a text in quotes, a number as it is. */
  value(value, dataType, steps) {
    if (Array.isArray(value)) {
      return value.map((each) => this.value(each, dataType, steps)).join(", ");
    }
    if (value === null || value === undefined) {
      return "nothing";
    }
    if (typeof value !== "string") {
      return String(value);
    }
    if (steps.has(value)) {
      const step = steps.get(value);
      return step.noun === "step"
        ? `the record of step ${step.number} (“${step.label}”)`
        : `record ${step.number} (“${step.label}”)`;
    }
    const record = TEMPLATE_RECORD.exec(value);
    if (record) {
      const label = this.names.records.get(value);
      return label === undefined
        ? `record ${value.split(":")[1]} of ${this.named(record[1], "template")}`
        : `record “${label}” of ${this.named(record[1], "template")}`;
    }
    if (PERSONA.test(value)) {
      return this.named(value, "persona");
    }
    if (value === "StandardPricebookId") {
      return "the standard price book";
    }
    // A value with a format of its own, such as a date or a number, reads best without quotes.
    return dataType && this.formats[dataType] ? value : JSON.stringify(value);
  }

  /** One step: its number and label, what it does, and the description that says why. */
  step(node, number, steps, indent) {
    const details = isObject(node.details) ? node.details : {};
    const annotation = this.schema.stepAnnotation(node);
    const handled = new Set([annotation.subtypeKey, "objectApiName"]);
    const what = [];
    for (const key of [
      ...(annotation.recordReferenceKeys ?? []),
      ...(annotation.failableReferenceKeys ?? [])
    ]) {
      handled.add(key);
      if (details[key]) {
        what.push(this.value(details[key], "REFERENCE", steps));
      }
    }
    if (annotation.personaKey) {
      handled.add(annotation.personaKey);
      what.push(
        details[annotation.personaKey]
          ? this.named(details[annotation.personaKey], "persona")
          : "the test's own user"
      );
    }
    if (annotation.loadsTemplateKey) {
      handled.add(annotation.loadsTemplateKey);
      what.push(
        details[annotation.loadsTemplateKey]
          ? this.named(details[annotation.loadsTemplateKey], "template")
          : "no template chosen"
      );
    }
    if (details.objectApiName) {
      what.push(details.objectApiName);
    }
    const lines = [
      `${indent}${number}. ${node.label ?? "(no label)"}`,
      `${indent}   ${stepTitle(this.schema, node)}${what.length > 0 ? `: ${what.join(", ")}` : ""}`
    ];
    for (const [key, spec] of Object.entries(annotation.entryLists ?? {})) {
      handled.add(key);
      for (const entry of (Array.isArray(details[key])
        ? details[key]
        : []
      ).filter(isObject)) {
        const value = this.value(entry.value, entry.dataType, steps);
        lines.push(
          spec.kind === "comparison"
            ? `${indent}     ${entry.apiName} ${this.operators[entry.operator] ?? entry.operator} ${value}`
            : `${indent}     ${entry.apiName} = ${value}`
        );
      }
    }
    if (details.expectedRecordCount !== undefined) {
      handled.add("expectedRecordCount");
      handled.add("expectedRecordCountOperator");
      const operator = details.expectedRecordCountOperator ?? "eq";
      lines.push(
        `${indent}     the number of records ${this.operators[operator] ?? operator} ${details.expectedRecordCount}`
      );
    }
    if (details.exceptionTypeToVerify !== undefined) {
      handled.add("exceptionTypeToVerify");
      handled.add("statusCodeToVerify");
      lines.push(
        `${indent}     an error of type ${details.exceptionTypeToVerify}` +
          (details.statusCodeToVerify
            ? `, status code ${details.statusCodeToVerify}`
            : ", with any status code")
      );
    }
    for (const [key, value] of Object.entries(details)) {
      if (!handled.has(key)) {
        lines.push(`${indent}     ${key}: ${this.value(value, null, steps)}`);
      }
    }
    if (String(node.description ?? "").trim()) {
      lines.push(`${indent}   ${String(node.description).trim()}`);
    }
    return lines;
  }

  /** The steps of a list or of sections, numbered through, each able to name the ones before it. */
  steps(sections, noun, indent) {
    const lines = [];
    const steps = new Map();
    let number = 0;
    for (const [heading, nodes] of sections) {
      if (heading) {
        lines.push(`${indent}${heading}`);
      }
      const list = (Array.isArray(nodes) ? nodes : []).filter(isObject);
      if (list.length === 0) {
        lines.push(`${indent}  no steps`);
      }
      for (const node of list) {
        number += 1;
        lines.push(
          ...this.step(node, number, steps, heading ? `${indent}  ` : indent)
        );
        steps.set(node.guid, { number, label: node.label, noun });
      }
    }
    return lines;
  }

  /** One item: what it is, its category and version, and what it does. */
  item(file, kind, record) {
    const lists = KINDS[kind];
    const orders = new Map(
      this.schema.pushOrder.map((order) => [order.array, order])
    );
    const category = file
      .records(lists.categories)
      .find(
        (each) => each.GUID__c === record[orders.get(lists.items).parentField]
      );
    const version = file
      .records(lists.versions)
      .filter(
        (each) =>
          each[orders.get(lists.versions).parentField] === record.GUID__c
      )
      .at(-1);
    const lines = [
      `${NOUNS[kind]} “${record.Name}” (${record.GUID__c})` +
        (kind === "dataTemplate" && record.Type__c
          ? `, ${record.Type__c}`
          : ""),
      `  Category “${category?.Name ?? record[orders.get(lists.items).parentField]}”`
    ];
    if (!version) {
      return [...lines, "  no version in the file"];
    }
    lines.push(`  Version “${version.Name}” (${version.GUID__c})`);
    if (String(version.Description__c ?? "").trim()) {
      lines.push(`  ${String(version.Description__c).trim()}`);
    }
    lines.push("");
    if (kind === "featureTest") {
      lines.push(
        ...this.steps(
          this.schema.sections.map((section) => [
            section.name,
            version[section.field]
          ]),
          "step",
          "  "
        )
      );
    } else if (kind === "dataTemplate") {
      lines.push(
        "  Records",
        ...this.steps([[null, version.Definition_Data__c]], "record", "    ")
      );
    } else {
      const fields = isObject(version.User_Fields__c)
        ? version.User_Fields__c
        : {};
      lines.push("  User fields");
      for (const [name, value] of Object.entries(fields)) {
        lines.push(`    ${name} = ${this.value(value, null, new Map())}`);
      }
      for (const [field, heading] of Object.entries(PERSONA_LISTS)) {
        const values = Array.isArray(version[field]) ? version[field] : [];
        if (values.length > 0) {
          lines.push(`  ${heading}: ${values.join(", ")}`);
        }
      }
    }
    return lines;
  }
}

/**
 * The lines that show every test, persona and template a file holds, or only those whose GUIDs are
 * given. names holds what the project and the org could name.
 */
export function showFile(
  file,
  schema,
  names,
  { only = null, catalogue = new Catalogue() } = {}
) {
  const renderer = new Renderer(schema, names, catalogue);
  const shown = [];
  for (const kind of ["featureTest", "persona", "dataTemplate"]) {
    for (const record of file.records(KINDS[kind].items)) {
      if (only === null || only.has(record.GUID__c)) {
        shown.push({
          kind,
          guid: record.GUID__c,
          name: record.Name,
          lines: renderer.item(file, kind, record)
        });
      }
    }
  }
  return shown;
}

/** Everything in a file that may name a persona, template or template record. */
export function definitionsOf(file) {
  return [
    ...file.records("featureTestVersions"),
    ...file.records("testPersonaVersions"),
    ...file.records("dataTemplateVersions")
  ];
}
