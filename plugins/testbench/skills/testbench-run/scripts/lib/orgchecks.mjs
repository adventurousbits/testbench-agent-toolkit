/**
 * What only the org can answer about a file: whether the objects and fields its steps name exist,
 * with the types the file stores and the access its steps need, and whether the personas, templates
 * and parents it names but the project does not hold are there.
 */
import { namespaced, OrgError } from "./org.mjs";
import { selectByGuid } from "./records.mjs";
import { ERROR } from "./rules.mjs";
import { isObject } from "./schema.mjs";

// The describe flag each access the schema names is read from. A readable field has no flag: a field
// the user cannot read is not in the describe at all.
const ACCESS_FLAGS = {
  createable: "createable",
  updateable: "updateable",
  deletable: "deletable",
  queryable: "queryable",
  filterable: "filterable",
  readable: null
};

const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Stops when the signed-in user cannot reach Testbench: not installed, or no permission set. */
export async function requireTestbench(org) {
  if ((await org.describe(namespaced("Feature_Test__c"))) === null) {
    throw new OrgError(
      `Testbench cannot be reached in ${org.label}: it is not installed there, or the signed-in user ` +
        `does not hold the Testbench permission set. The toolkit cannot fix either.`
    );
  }
}

/**
 * True when the signed-in user may create, change and delete Global data templates: Testbench allows
 * that only to users holding its Manage Global Data Templates permission, administrators included.
 *
 * Asks for the permission, not for the permission set Testbench ships with it, because an org may
 * grant it through a permission set of its own.
 */
export async function holdsGlobalTemplatePermission(org) {
  const userId = await org.userId();
  const [held] = await org.query(
    "SELECT COUNT(Id) n FROM SetupEntityAccess WHERE SetupEntityId IN (SELECT Id FROM CustomPermission " +
      "WHERE DeveloperName = 'Manage_Global_Data_Templates' AND NamespacePrefix = 'testbench') " +
      `AND ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${userId}')`
  );
  return (held?.n ?? 0) > 0;
}

/** Stops when the signed-in user may not change these Global templates, named for the message. */
export async function requireGlobalTemplatePermission(org, names) {
  if (await holdsGlobalTemplatePermission(org)) {
    return;
  }
  const listed = names.map((name) => `“${name}”`).join(", ");
  throw new OrgError(
    `${listed} ${names.length === 1 ? "is a Global template" : "are Global templates"}, and the ` +
      `signed-in user of ${org.label} may not create, change or delete Global templates, so nothing ` +
      `was changed. Ask an administrator for the Testbench - Manage Global Templates permission set, ` +
      `then run again.`,
    "GLOBAL_TEMPLATES_PERMISSION"
  );
}

/**
 * Looks up what the project's files name but do not hold, and returns findings by file.
 *
 * externals is a list of { entry, external }, external being what the rules collected for that file.
 */
export async function checkExternals(org, externals) {
  const findings = new Map(externals.map(({ entry }) => [entry, []]));
  const lookups = [
    ["personas", "Persona__c", "persona"],
    ["dataTemplates", "Data_Template__c", "data template"]
  ];
  for (const [kind, objectName, noun] of lookups) {
    const named = externals.flatMap(({ external }) =>
      external[kind].map((item) => item.guid)
    );
    if (named.length === 0) {
      continue;
    }
    const found = await selectByGuid(
      org,
      objectName,
      ["Name", namespaced("Active_Versions_Count__c")],
      named
    );
    for (const { entry, external } of externals) {
      for (const { guid, path } of external[kind]) {
        const record = found.get(guid);
        if (record === undefined) {
          findings.get(entry).push({
            level: ERROR,
            path,
            message: `${noun} ${guid} is neither in the project nor in the org`
          });
        } else if (!record[namespaced("Active_Versions_Count__c")]) {
          findings.get(entry).push({
            level: ERROR,
            path,
            message: `${noun} "${record.Name}" (${guid}) has no active version in the org, so it cannot be used`
          });
        }
        // One only in the org, with an active version, is in order: the org is where tests live.
      }
    }
  }
  const parents = new Map();
  for (const { entry, external } of externals) {
    for (const parent of external.parents) {
      parents.set(parent.object, [
        ...(parents.get(parent.object) ?? []),
        { entry, ...parent }
      ]);
    }
  }
  for (const [objectName, items] of parents) {
    const found = await selectByGuid(
      org,
      objectName,
      [],
      items.map((item) => item.guid)
    );
    for (const { entry, guid, path } of items) {
      if (!found.has(guid)) {
        findings.get(entry).push({
          level: ERROR,
          path,
          message: `${guid} is neither in the project nor in the org`
        });
      }
    }
  }
  return findings;
}

/** The objects, fields, field types and access a file's steps need, against the org's describes. */
export async function checkFields(org, file, schema) {
  const findings = [];
  const describeTypes = schema.common.describeTypes;
  const principal = new Set(
    Object.keys(schema.common.principalFields).filter(
      (key) => key !== "description"
    )
  );

  const checkSteps = async (nodes, base) => {
    for (const [index, node] of (Array.isArray(nodes) ? nodes : []).entries()) {
      if (!isObject(node)) {
        continue;
      }
      const annotation = schema.stepAnnotation(node);
      const details = isObject(node.details) ? node.details : {};
      const objectName = details[annotation.objectKey ?? ""];
      // A name the schema rejects is reported there; it is never put into a request.
      if (typeof objectName !== "string" || !API_NAME.test(objectName)) {
        continue;
      }
      const path = `${base}[${index}].details`;
      const described = await org.describe(objectName);
      if (described === null) {
        findings.push({
          level: ERROR,
          path: `${path}.objectApiName`,
          message: `${objectName} does not exist in the org, or this user cannot see it`
        });
        continue;
      }
      const objectFlag = ACCESS_FLAGS[annotation.objectAccess];
      if (objectFlag && !described[objectFlag]) {
        findings.push({
          level: ERROR,
          path: `${path}.objectApiName`,
          message: `${objectName} is not ${objectFlag} for this user`
        });
      }
      const fields = new Map(
        (described.fields ?? []).map((field) => [
          field.name.toLowerCase(),
          field
        ])
      );
      for (const [key, spec] of Object.entries(annotation.entryLists ?? {})) {
        for (const [i, entry] of (Array.isArray(details[key])
          ? details[key]
          : []
        ).entries()) {
          if (!isObject(entry)) {
            continue;
          }
          const where = `${path}.${key}[${i}]`;
          const field = fields.get(String(entry.apiName ?? "").toLowerCase());
          if (field === undefined) {
            findings.push({
              level: ERROR,
              path: `${where}.apiName`,
              message: `${objectName}.${entry.apiName} does not exist, or this user cannot see it`
            });
            continue;
          }
          const expected = principal.has(field.name)
            ? "PICKLIST"
            : (describeTypes[field.type] ?? field.type.toUpperCase());
          if (entry.dataType !== expected) {
            findings.push({
              level: ERROR,
              path: `${where}.dataType`,
              message: `${objectName}.${field.name} is a ${expected} in this org, not ${entry.dataType}`
            });
          }
          const fieldFlag = ACCESS_FLAGS[spec.access];
          if (fieldFlag && !field[fieldFlag]) {
            findings.push({
              level: ERROR,
              path: `${where}.apiName`,
              message: `${objectName}.${field.name} is not ${fieldFlag} for this user`
            });
          }
        }
      }
    }
  };

  for (const [index, version] of file
    .records("featureTestVersions")
    .entries()) {
    for (const section of schema.sections) {
      await checkSteps(
        version[section.field],
        `$.data.featureTestVersions[${index}].${section.field}`
      );
    }
  }
  for (const [index, version] of file
    .records("dataTemplateVersions")
    .entries()) {
    await checkSteps(
      version.Definition_Data__c,
      `$.data.dataTemplateVersions[${index}].Definition_Data__c`
    );
  }

  const personaVersions = file.records("testPersonaVersions");
  if (personaVersions.length > 0) {
    const user = await org.describe("User");
    const creatable = new Set(
      (user?.fields ?? [])
        .filter((field) => field.createable)
        .map((field) => field.name.toLowerCase())
    );
    for (const [index, version] of personaVersions.entries()) {
      for (const name of Object.keys(
        isObject(version.User_Fields__c) ? version.User_Fields__c : {}
      )) {
        if (!creatable.has(name.toLowerCase())) {
          findings.push({
            level: ERROR,
            path: `$.data.testPersonaVersions[${index}].User_Fields__c.${name}`,
            message: `User.${name} does not exist, or cannot be set when a user is created`
          });
        }
      }
    }
  }
  return findings;
}
