/**
 * The rules a schema cannot express: order, reference and consistency across a file.
 *
 * Each rule states what is allowed. The rules read what a step does from its schema annotation, so they
 * hold for step types added after they were written.
 *
 * A file is checked within a context: everything the project's files hold. A test names its personas
 * and templates by GUID and they live in files of their own, so whether one exists is a question
 * about the project, not about the test's file.
 */
import { COMMON } from "./model.mjs";
import { isObject, show } from "./schema.mjs";

export const ERROR = "error";
export const WARNING = "warning";

/** "a" or "an", for a message naming an object. */
function article(word) {
  return /^[aeiou]/i.test(String(word)) ? "an" : "a";
}

/** True when text is a calendar date that exists, such as 2028-02-29 but not 2027-02-29. */
export function isRealDate(text) {
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** What a set of Testbench files holds, for the rules to consult. */
export class Context {
  constructor(files) {
    this.templateTypes = new Map();
    this.templateRecords = new Map();
    this.templateObjects = new Map();
    this.templateNodes = new Map();
    this.personas = new Set();
    this.personasWithVersion = new Set();
    this.recordsByObject = new Map();
    for (const file of files) {
      this.add(file);
    }
  }

  add(file) {
    for (const entry of file.schema.pushOrder) {
      const known = this.recordsByObject.get(entry.object) ?? new Set();
      file.guids(entry.array).forEach((guid) => known.add(guid));
      this.recordsByObject.set(entry.object, known);
    }
    for (const template of file.records("dataTemplates")) {
      if (template.GUID__c) {
        this.templateTypes.set(template.GUID__c, template.Type__c);
      }
    }
    for (const version of file.records("dataTemplateVersions")) {
      const template = version.Data_Template__c;
      const nodes = Array.isArray(version.Definition_Data__c)
        ? version.Definition_Data__c.filter(isObject)
        : [];
      const records = this.templateRecords.get(template) ?? new Set();
      nodes.forEach((node) => records.add(node.guid));
      this.templateRecords.set(template, records);
      this.templateNodes.set(template, [
        ...(this.templateNodes.get(template) ?? []),
        ...nodes
      ]);
      for (const node of nodes) {
        const details = isObject(node.details) ? node.details : {};
        this.templateObjects.set(
          `${template}:${node.guid}`,
          details.objectApiName
        );
      }
    }
    file.guids("testPersonas").forEach((guid) => this.personas.add(guid));
    for (const version of file.records("testPersonaVersions")) {
      this.personasWithVersion.add(version.Persona__c);
    }
  }

  /** The Global templates: created at the start of every run, so their records are always there. */
  globalTemplates() {
    return new Set(
      [...this.templateTypes]
        .filter(([, type]) => type === "Global")
        .map(([guid]) => guid)
    );
  }
}

export class Rules {
  constructor(file, schema, context = new Context([file])) {
    this.file = file;
    this.schema = schema;
    this.context = context;
    this.findings = [];
    const definitions = schema.store.document(COMMON).$defs;
    this.nodeGuid = new RegExp(definitions.nodeGuid.pattern);
    this.personaGuid = new RegExp(definitions.personaGuid.pattern);
    this.templateRecord = new RegExp(
      definitions.templateRecordReference.pattern
    );
    const common = schema.common;
    this.valueFormats = new Map(
      Object.entries(common.valueFormats)
        .filter(([key]) => key !== "description")
        .map(([key, pattern]) => [key, new RegExp(pattern)])
    );
    this.listTypes = new Set(common.listValueDataTypes);
    this.referenceTypes = new Set(common.referenceDataTypes);
    this.specialReferences = common.specialReferenceValues;
    this.principalFields = new Set(
      Object.keys(common.principalFields).filter((key) => key !== "description")
    );
    this.operators = common.operatorsByDataType;
    // What the file names but the context does not hold. Not an error offline: it may exist in the
    // org. Whoever runs the rules decides what to make of it.
    this.external = { personas: [], dataTemplates: [], parents: [] };
    this.externalSeen = new Set();
  }

  error(path, message) {
    this.findings.push({ level: ERROR, path, message });
  }

  warn(path, message) {
    this.findings.push({ level: WARNING, path, message });
  }

  noteExternal(kind, entry) {
    const key = [kind, entry.object, entry.guid, entry.path].join("\u0000");
    if (!this.externalSeen.has(key)) {
      this.externalSeen.add(key);
      this.external[kind].push(entry);
    }
  }

  run() {
    this.checkUniqueGuids();
    this.checkParents();
    this.checkVersionsPerParent();
    this.file
      .records("featureTestVersions")
      .forEach((version, index) =>
        this.checkFeatureTestVersion(index, version)
      );
    this.file
      .records("dataTemplateVersions")
      .forEach((version, index) => this.checkTemplateVersion(index, version));
    this.file
      .records("testPersonaVersions")
      .forEach((version, index) => this.checkPersonaVersion(index, version));
    return this.findings;
  }

  // -- the file as a whole ----------------------------------------------------------------------

  checkUniqueGuids() {
    for (const entry of this.schema.pushOrder) {
      const seen = new Map();
      this.file.records(entry.array).forEach((record, index) => {
        const guid = record.GUID__c;
        if (seen.has(guid)) {
          this.error(
            `$.data.${entry.array}[${index}].GUID__c`,
            `${guid} is also used by ${entry.array}[${seen.get(guid)}]; every record needs its own GUID`
          );
        } else if (guid) {
          seen.set(guid, index);
        }
      });
    }
  }

  checkParents() {
    for (const entry of this.schema.pushOrder) {
      if (!entry.parentField) {
        continue;
      }
      const parents =
        this.context.recordsByObject.get(entry.parentObject) ?? new Set();
      this.file.records(entry.array).forEach((record, index) => {
        const parent = record[entry.parentField];
        if (parent && !parents.has(parent)) {
          const path = `$.data.${entry.array}[${index}].${entry.parentField}`;
          this.noteExternal("parents", {
            object: entry.parentObject,
            guid: parent,
            path
          });
        }
      });
    }
  }

  checkVersionsPerParent() {
    for (const entry of this.schema.pushOrder) {
      if (!entry.isVersion) {
        continue;
      }
      const counts = new Map();
      for (const record of this.file.records(entry.array)) {
        const parent = record[entry.parentField];
        counts.set(parent, (counts.get(parent) ?? 0) + 1);
      }
      for (const [parent, count] of counts) {
        if (count > 1) {
          this.warn(
            `$.data.${entry.array}`,
            `${count} versions of ${parent} are in this file. Only one version can be active: activating ` +
              `them on push leaves the last one in the file active`
          );
        }
      }
    }
  }

  // -- steps ------------------------------------------------------------------------------------

  checkFeatureTestVersion(index, version) {
    const base = `$.data.featureTestVersions[${index}]`;
    const steps = [];
    for (const section of this.schema.sections) {
      const nodes = version[section.field];
      if (Array.isArray(nodes)) {
        nodes.forEach((node, i) =>
          steps.push([`${base}.${section.field}[${i}]`, node])
        );
      }
    }
    // A Global template is created before any step runs, so its records are there from the start.
    const loaded = this.withDependencies(this.context.globalTemplates());
    this.checkSteps(steps, loaded, null);
  }

  /** The templates given, and every template their records point at, which loads with them. */
  withDependencies(templates) {
    const found = new Set(templates);
    const pending = [...templates];
    while (pending.length > 0) {
      const template = pending.pop();
      for (const node of this.context.templateNodes.get(template) ?? []) {
        const entries =
          isObject(node.details) && Array.isArray(node.details.fieldsToCreate)
            ? node.details.fieldsToCreate
            : [];
        for (const entry of entries) {
          const value = isObject(entry) ? entry.value : null;
          if (typeof value === "string" && this.templateRecord.test(value)) {
            const referenced = value.split(":")[0];
            if (!found.has(referenced)) {
              found.add(referenced);
              pending.push(referenced);
            }
          }
        }
      }
    }
    return found;
  }

  checkTemplateVersion(index, version) {
    const nodes = version.Definition_Data__c;
    if (!Array.isArray(nodes)) {
      return;
    }
    const base = `$.data.dataTemplateVersions[${index}].Definition_Data__c`;
    const steps = nodes.map((node, i) => [`${base}[${i}]`, node]);
    this.checkSteps(steps, new Set(), version.Data_Template__c ?? null);
  }

  /** Walks the steps in the order they run, knowing at each step what exists so far. */
  checkSteps(steps, loaded, ownerTemplate) {
    const seen = new Set();
    const records = new Map();
    const failable = new Set();
    for (const [path, node] of steps) {
      if (!isObject(node)) {
        continue;
      }
      const guid = node.guid;
      if (seen.has(guid)) {
        this.error(
          `${path}.guid`,
          `${guid} is used by an earlier step; every step needs its own guid`
        );
      }
      seen.add(guid);
      const annotation = this.schema.stepAnnotation(node);
      const details = isObject(node.details) ? node.details : {};

      const personaKey = annotation.personaKey;
      if (personaKey && details[personaKey]) {
        this.notePersona(details[personaKey], `${path}.details.${personaKey}`);
      }

      const templateKey = annotation.loadsTemplateKey;
      if (templateKey && details[templateKey]) {
        const template = details[templateKey];
        if (this.context.templateTypes.get(template) === "Global") {
          this.error(
            `${path}.details.${templateKey}`,
            `${template} is a Global template: it is created at the start of every run and cannot be ` +
              `loaded by a step. Load a Regular template, or rely on the Global one being there`
          );
        } else if (!this.context.templateTypes.has(template)) {
          this.noteExternal("dataTemplates", {
            guid: template,
            path: `${path}.details.${templateKey}`
          });
        }
        this.withDependencies([template]).forEach((each) => loaded.add(each));
      }

      const expectedObject = annotation.sameObjectAsReference
        ? details.objectApiName
        : null;
      for (const key of annotation.recordReferenceKeys ?? []) {
        if (details[key]) {
          this.checkReference(
            details[key],
            `${path}.details.${key}`,
            records,
            loaded,
            ownerTemplate,
            {
              dataType: "REFERENCE",
              expectedObject,
              recordOnly: true
            }
          );
        }
      }

      for (const key of annotation.failableReferenceKeys ?? []) {
        if (details[key] && !failable.has(details[key])) {
          this.error(
            `${path}.details.${key}`,
            `${details[key]} must be the guid of an earlier step that creates, finds, updates or deletes a record`
          );
        }
      }

      for (const [key, spec] of Object.entries(annotation.entryLists ?? {})) {
        const entries = Array.isArray(details[key]) ? details[key] : [];
        entries.forEach((entry, i) => {
          if (isObject(entry)) {
            this.checkEntry(
              entry,
              spec.kind,
              `${path}.details.${key}[${i}]`,
              records,
              loaded,
              ownerTemplate
            );
          }
        });
      }

      if (
        annotation.recommendsDescription &&
        !String(node.description ?? "").trim()
      ) {
        this.warn(
          `${path}.description`,
          "say in one sentence what this check proves"
        );
      }

      if (annotation.producesRecord) {
        records.set(guid, details.objectApiName);
      }
      if (annotation.failable) {
        failable.add(guid);
      }
    }
  }

  checkEntry(entry, kind, path, records, loaded, ownerTemplate) {
    const dataType = entry.dataType;
    const value = entry.value;
    const apiName = entry.apiName;
    if (this.principalFields.has(apiName) && dataType !== "PICKLIST") {
      this.error(
        `${path}.dataType`,
        `${apiName} holds a name, not an Id, and its dataType is always PICKLIST`
      );
    }
    if (kind === "comparison") {
      const allowed = this.operators[dataType] ?? this.operators.default;
      if (!allowed.includes(entry.operator)) {
        this.error(
          `${path}.operator`,
          `${show(entry.operator)} cannot compare a ${dataType}; allowed: ${allowed.join(", ")}`
        );
      }
    }
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      if (!this.listTypes.has(dataType)) {
        this.error(
          `${path}.value`,
          `a list of values is only allowed for ${[...this.listTypes].sort().join(", ")}`
        );
      }
      return;
    }
    if (typeof value !== "string") {
      return;
    }
    if (
      this.referenceTypes.has(dataType) &&
      !this.principalFields.has(apiName)
    ) {
      this.checkReference(
        value,
        `${path}.value`,
        records,
        loaded,
        ownerTemplate,
        { dataType }
      );
      return;
    }
    const pattern = this.valueFormats.get(dataType);
    if (pattern && !pattern.test(value)) {
      this.error(
        `${path}.value`,
        `${show(value)} is not a valid ${dataType} value; it must match ${pattern.source}`
      );
    } else if (dataType === "DATE" && !isRealDate(value)) {
      this.error(`${path}.value`, `${show(value)} is not a real date`);
    }
  }

  /** A value that points at something: what it may point at, and that it exists at this point. */
  checkReference(
    value,
    path,
    records,
    loaded,
    ownerTemplate,
    { dataType, expectedObject = null, recordOnly = false }
  ) {
    if (!recordOnly && Object.hasOwn(this.specialReferences, value)) {
      const allowed = this.specialReferences[value];
      if (!allowed.includes(dataType)) {
        this.error(
          path,
          `${value} is only allowed with dataType ${allowed.join(", ")}`
        );
      }
      return;
    }
    if (this.nodeGuid.test(value)) {
      if (!records.has(value)) {
        this.error(
          path,
          `${value} names no record an earlier step created or found`
        );
      } else if (
        expectedObject &&
        records.get(value) &&
        records.get(value) !== expectedObject
      ) {
        const object = records.get(value);
        this.error(
          path,
          `${value} is ${article(object)} ${object} record, but this step names ${expectedObject}`
        );
      }
      return;
    }
    if (this.templateRecord.test(value)) {
      const [template, node] = value.split(":");
      const known = this.context.templateTypes.has(template);
      if (ownerTemplate !== null && template === ownerTemplate) {
        this.error(
          path,
          `${value} is a record of this same template: name it by its guid, ${node}`
        );
        return;
      }
      if (ownerTemplate === null && !loaded.has(template)) {
        if (known) {
          this.error(
            path,
            `template ${template} is not loaded at this point: no Use Data Template step above loads it or ` +
              `a template that points at it, and it is not a Global template`
          );
        } else {
          this.warn(
            path,
            `template ${template} is not loaded by a step above this one, so it must be a Global template ` +
              `in the target org`
          );
        }
      }
      const created = this.context.templateRecords.get(template);
      if (created && !created.has(node)) {
        this.error(path, `template ${template} creates no record ${node}`);
      } else if (!known) {
        this.noteExternal("dataTemplates", { guid: template, path });
      }
      const targetObject = this.context.templateObjects.get(value);
      if (expectedObject && targetObject && targetObject !== expectedObject) {
        this.error(
          path,
          `${value} is ${article(targetObject)} ${targetObject} record, but this step names ${expectedObject}`
        );
      }
      return;
    }
    if (!recordOnly && this.personaGuid.test(value)) {
      this.notePersona(value, path);
      return;
    }
    this.error(
      path,
      `${show(value)} is not a reference Testbench can resolve. A lookup holds the guid of an earlier step, ` +
        `a template record (<templateGuid>:<nodeGuid>), a persona GUID or StandardPricebookId: never a ` +
        `record Id, which would not exist in another org`
    );
  }

  // -- personas ---------------------------------------------------------------------------------

  checkPersonaVersion(index, version) {
    const fields = version.User_Fields__c;
    if (!isObject(fields)) {
      return;
    }
    const base = `$.data.testPersonaVersions[${index}].User_Fields__c`;
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value !== "string") {
        continue;
      }
      const path = `${base}.${name}`;
      if (this.personaGuid.test(value)) {
        if (value === version.Persona__c) {
          this.error(path, "a persona cannot point at itself");
        } else {
          this.notePersona(value, path);
        }
      } else if (this.templateRecord.test(value)) {
        const [template, node] = value.split(":");
        const created = this.context.templateRecords.get(template);
        if (created && !created.has(node)) {
          this.error(path, `template ${template} creates no record ${node}`);
        } else if (!this.context.templateTypes.has(template)) {
          this.noteExternal("dataTemplates", { guid: template, path });
        }
      }
    }
  }

  notePersona(guid, path) {
    if (!this.context.personas.has(guid)) {
      this.noteExternal("personas", { guid, path });
      return;
    }
    if (!this.context.personasWithVersion.has(guid)) {
      this.warn(
        path,
        `persona ${guid} has no version in the project, so it must have an active version in the target org`
      );
    }
  }
}
