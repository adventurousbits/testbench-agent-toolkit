/**
 * Reads a Testbench file and what the schema declares about it.
 *
 * Everything this module knows about step types, sections and push order comes from the schema's
 * `x-testbench` annotations, so a new step type or a new field needs no change here.
 */
import { SchemaStore, isObject } from "./schema.mjs";

export const ENVELOPE = "testbench-file.schema.json";
export const FEATURE_TESTS = "feature-test.schema.json";
export const DATA_TEMPLATES = "data-template.schema.json";
export const COMMON = "common.schema.json";

/** The record lists of each kind of item, and the push order's entries for them. */
export const KINDS = {
  persona: {
    categories: "testPersonaCategories",
    items: "testPersonas",
    versions: "testPersonaVersions"
  },
  dataTemplate: {
    categories: "dataTemplateCategories",
    items: "dataTemplates",
    versions: "dataTemplateVersions"
  },
  featureTest: {
    categories: "featureTestCategories",
    items: "featureTests",
    versions: "featureTestVersions"
  }
};

/** The declarations the rules and the org commands work from. */
export class Schema {
  constructor(store = new SchemaStore()) {
    this.store = store;
    this.pushOrder = store.document(ENVELOPE)["x-testbench"].pushOrder;
    this.common = store.document(COMMON)["x-testbench"];
    this.sections = store.document(FEATURE_TESTS)["x-testbench"].sections;
    this.sectionTypes = {};
    for (const section of this.sections) {
      this.sectionTypes[section.name] = this.stepTypes(
        FEATURE_TESTS,
        `#/$defs/${section.name.toLowerCase()}Nodes`
      );
    }
    this.templateTypes = this.stepTypes(
      DATA_TEMPLATES,
      "#/$defs/templateNodes"
    );
    this.steps = new Map();
    for (const types of [
      ...Object.values(this.sectionTypes),
      this.templateTypes
    ]) {
      for (const [type, entry] of types) {
        this.steps.set(type, entry);
      }
    }
    this.jsonFieldsByArray = new Map();
  }

  /** {step type: [schema file, step schema]} for the steps a list of steps allows. */
  stepTypes(filePath, pointer) {
    const [, steps] = this.store.resolve(filePath, pointer);
    const found = new Map();
    for (const branch of steps.items.anyOf) {
      const [stepFile, step] = this.store.follow(filePath, branch);
      found.set(step.properties.type.const, [stepFile, step]);
    }
    return found;
  }

  /** What the schema declares about this step, with its sub-kind's declarations merged in. */
  stepAnnotation(node) {
    const entry = this.steps.get(node?.type);
    if (entry === undefined) {
      return {};
    }
    const [stepFile, step] = entry;
    const annotation = { ...step["x-testbench"] };
    const subtypeKey = annotation.subtypeKey;
    if (subtypeKey) {
      const chosen = (isObject(node.details) ? node.details : {})[subtypeKey];
      for (const branch of step.properties.details.anyOf ?? []) {
        const [, sub] = this.store.follow(stepFile, branch);
        const subAnnotation = sub["x-testbench"] ?? {};
        if (subAnnotation[subtypeKey] === chosen) {
          Object.assign(annotation, subAnnotation);
        }
      }
    }
    return annotation;
  }

  /** The record keys of an array that hold JSON, written either as JSON or as JSON text. */
  jsonFields(arrayName) {
    if (!this.jsonFieldsByArray.has(arrayName)) {
      const [itemFile, item] = this.store.follow(
        ENVELOPE,
        this.arrayItem(arrayName)
      );
      const fields = [];
      for (const [name, property] of Object.entries(item.properties ?? {})) {
        const [, resolved] = this.store.follow(itemFile, property);
        const holdsJson = (resolved.anyOf ?? []).some(
          (branch) =>
            this.store.follow(itemFile, branch)[1].contentMediaType ===
            "application/json"
        );
        if (holdsJson) {
          fields.push(name);
        }
      }
      this.jsonFieldsByArray.set(arrayName, fields);
    }
    return this.jsonFieldsByArray.get(arrayName);
  }

  /** Every key a record of the array may hold, which is every field a push or pull carries. */
  recordKeys(arrayName) {
    const [, item] = this.store.follow(ENVELOPE, this.arrayItem(arrayName));
    return Object.keys(item.properties ?? {});
  }

  /** The keys a record of the array must hold. */
  requiredKeys(arrayName) {
    const [, item] = this.store.follow(ENVELOPE, this.arrayItem(arrayName));
    return item.required ?? [];
  }

  arrayItem(arrayName) {
    return this.store.document(ENVELOPE).properties.data.properties[arrayName]
      .items;
  }
}

/** A field written as JSON text, parsed; a field written as JSON, unchanged; null if unreadable. */
export function parseJsonText(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

/** A Testbench file with its JSON fields parsed, indexed by GUID. */
export class TestbenchFile {
  constructor(document, schema) {
    this.document = document;
    this.schema = schema;
    this.data =
      isObject(document) && isObject(document.data) ? document.data : {};
    this.parsed = {};
    for (const entry of schema.pushOrder) {
      const records = this.data[entry.array];
      const fields = schema.jsonFields(entry.array);
      this.parsed[entry.array] = (Array.isArray(records) ? records : []).map(
        (record) =>
          isObject(record)
            ? Object.fromEntries(
                Object.entries(record).map(([key, value]) => [
                  key,
                  fields.includes(key) ? parseJsonText(value) : value
                ])
              )
            : {}
      );
    }
  }

  records(arrayName) {
    return this.parsed[arrayName] ?? [];
  }

  guids(arrayName) {
    return new Set(
      this.records(arrayName)
        .map((record) => record.GUID__c)
        .filter(Boolean)
    );
  }

  byGuid(arrayName) {
    return new Map(
      this.records(arrayName)
        .filter((record) => record.GUID__c)
        .map((record) => [record.GUID__c, record])
    );
  }

  /** The kinds of item the file holds: feature tests, personas, data templates. */
  kinds() {
    return Object.keys(KINDS).filter(
      (kind) => this.records(KINDS[kind].items).length > 0
    );
  }
}
