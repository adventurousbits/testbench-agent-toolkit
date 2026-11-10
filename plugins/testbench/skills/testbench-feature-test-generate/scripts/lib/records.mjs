/**
 * Reading and writing Testbench records in an org, by GUID, as the toolkit always names them.
 *
 * Testbench needs no interface of its own: it reacts to records changing, exactly as when someone
 * uses the app. Activating a version deploys it, a run flag runs a test, and a validation flag
 * validates a persona or template.
 */
import { mayName } from "./guid.mjs";
import { KINDS, parseJsonText } from "./model.mjs";
import { chunks, namespaced, soqlList } from "./org.mjs";

export const GUID = namespaced("GUID__c");
export const ACTIVE = namespaced("Active__c");
export const IMMUTABLE = namespaced("Immutable__c");

/** The statuses a deployment ends in. Anything else is still on its way. */
export const DEPLOYED = "Deployed";
export const FAILED_DEPLOYMENTS = [
  "TranspilationFailed",
  "DeploymentFailed",
  "DeploymentCancelled"
];

/** The relationship that names a record's parent by GUID: `Feature_Test__c` is `testbench__Feature_Test__r`. */
export function parentRelationship(parentField) {
  return namespaced(parentField).replace(/__c$/, "__r");
}

/** The fields to read for a record list: every key the schema allows, the parent by its GUID. */
export function fieldsToRead(schema, order) {
  const fields = schema
    .recordKeys(order.array)
    .filter((key) => key !== "GUID__c" && key !== order.parentField)
    .map(namespaced);
  if (order.parentField) {
    fields.push(`${parentRelationship(order.parentField)}.${GUID}`);
  }
  if (order.isVersion) {
    fields.push(ACTIVE, IMMUTABLE);
  }
  return fields;
}

/** Empty text and a missing value mean the same to the org: nothing. */
export function normalized(value) {
  return value === undefined || value === "" ? null : value;
}

/** A field's value in an org record as a file holds it: a parent by its GUID, a JSON field parsed. */
export function fileValue(orgRecord, key, order, jsonFields) {
  if (key === order.parentField) {
    return orgRecord[parentRelationship(key)]?.[GUID] ?? null;
  }
  const value = orgRecord[namespaced(key)];
  return jsonFields.includes(key) ? parseJsonText(value ?? null) : value;
}

/**
 * An org record as a file holds it: the schema's keys in its order, the parent by its GUID and JSON
 * fields parsed. A field the org holds nothing in is left out, unless the schema requires it.
 */
export function toFileRecord(orgRecord, order, schema) {
  const jsonFields = schema.jsonFields(order.array);
  const required = schema.requiredKeys(order.array);
  const record = {};
  for (const key of schema.recordKeys(order.array)) {
    const value = normalized(fileValue(orgRecord, key, order, jsonFields));
    if (value !== null || required.includes(key)) {
      record[key] = value;
    }
  }
  return record;
}

/** The org's active version of each item, by the item's GUID, with the fields given. */
export async function activeVersions(org, order, fields, itemGuids) {
  const found = new Map();
  const parent = `${parentRelationship(order.parentField)}.${GUID}`;
  // The item's GUID is what the answer is keyed by, so it is read whatever the caller asked for.
  const select = [
    "Id",
    GUID,
    ...fields.filter((field) => field !== parent),
    parent
  ];
  for (const group of chunks(itemGuids)) {
    const soql =
      `SELECT ${select.join(", ")} FROM ${namespaced(order.object)} ` +
      `WHERE ${ACTIVE} = true AND ${parent} IN (${soqlList(group)})`;
    for (const record of await org.query(soql)) {
      found.set(record[parentRelationship(order.parentField)]?.[GUID], record);
    }
  }
  return found;
}

/** {GUID: record} for the records of a Testbench object with these GUIDs. */
export async function selectByGuid(org, objectName, fields, guids) {
  const found = new Map();
  for (const group of chunks(new Set(guids))) {
    const soql =
      `SELECT ${["Id", GUID, ...fields].join(", ")} FROM ${namespaced(objectName)} ` +
      `WHERE ${GUID} IN (${soqlList(group)})`;
    for (const record of await org.query(soql)) {
      found.set(record[GUID], record);
    }
  }
  return found;
}

/**
 * The kind of each category or version GUID given, as the org holds it: { GUID: kind }. Their GUIDs
 * do not say it, since every category's starts with C and every version's with V. A GUID no kind
 * holds is left out.
 */
export async function kindsInOrg(org, schema, guids) {
  const kinds = new Map();
  for (const [kind, lists] of Object.entries(KINDS)) {
    for (const role of ["categories", "versions"]) {
      const asked = guids.filter((guid) => mayName(guid, kind, role));
      if (asked.length === 0) {
        continue;
      }
      const object = schema.pushOrder.find(
        (order) => order.array === lists[role]
      ).object;
      for (const guid of (await selectByGuid(org, object, [], asked)).keys()) {
        kinds.set(guid, kind);
      }
    }
  }
  return kinds;
}

/** {Id: record} for the records of a Testbench object with these Ids. */
export async function selectById(org, objectName, fields, ids) {
  const found = new Map();
  for (const group of chunks(new Set(ids))) {
    const soql =
      `SELECT ${["Id", ...fields].join(", ")} FROM ${namespaced(objectName)} ` +
      `WHERE Id IN (${soqlList(group)})`;
    for (const record of await org.query(soql)) {
      found.set(record.Id, record);
    }
  }
  return found;
}

function outcome(result, key) {
  return {
    key,
    id: result?.id ?? null,
    success: result?.success === true,
    created: result?.created === true,
    errors: (result?.errors ?? []).map(
      (error) => `${error.statusCode}: ${error.message}`
    )
  };
}

/**
 * Creates or updates records by GUID, up to 200 per request, each record naming its fields as the
 * org does. Resolves to one outcome per record, in order: { key (the GUID), id, success, created,
 * errors }. A record that fails does not stop the others in its request.
 */
export async function upsertByGuid(org, objectName, records) {
  const type = namespaced(objectName);
  const path = await org.dataPath(`composite/sobjects/${type}/${GUID}`);
  const outcomes = [];
  for (const group of chunks(records)) {
    const body = {
      allOrNone: false,
      records: group.map((record) => ({ attributes: { type }, ...record }))
    };
    const results = await org.rest("PATCH", path, body);
    group.forEach((record, index) =>
      outcomes.push(outcome(results?.[index], record[GUID]))
    );
  }
  return outcomes;
}

/**
 * Updates records by Id, up to 200 per request. Unlike an upsert it never creates a record, so a flag
 * set on a record deleted meanwhile fails instead of making a new one.
 */
export async function updateById(org, objectName, records) {
  const type = namespaced(objectName);
  const path = await org.dataPath("composite/sobjects");
  const outcomes = [];
  for (const group of chunks(records)) {
    const body = {
      allOrNone: false,
      records: group.map((record) => ({ attributes: { type }, ...record }))
    };
    const results = await org.rest("PATCH", path, body);
    group.forEach((record, index) =>
      outcomes.push(outcome(results?.[index], record.Id))
    );
  }
  return outcomes;
}

/** The names of the personas and data templates with these GUIDs, for an explanation to name them. */
export async function namesByGuid(org, { personas = [], dataTemplates = [] }) {
  const names = new Map();
  for (const [objectName, guids] of [
    ["Persona__c", personas],
    ["Data_Template__c", dataTemplates]
  ]) {
    if (guids.length > 0) {
      for (const [guid, record] of await selectByGuid(
        org,
        objectName,
        ["Name"],
        guids
      )) {
        names.set(guid, record.Name);
      }
    }
  }
  return names;
}
