/**
 * What an org holds: its categories of feature tests, personas and data templates, each with its
 * items. The org is where the tests live, so this is where an assistant looks before writing,
 * running or saving: to choose a category, to use a persona or template that already exists, or to
 * ask which to run.
 */
import { isCategoryGuid } from "./guid.mjs";
import { KINDS } from "./model.mjs";
import { namespaced, soqlList } from "./org.mjs";
import { GUID, parentRelationship } from "./records.mjs";

function orderOf(schema, array) {
  return schema.pushOrder.find((order) => order.array === array);
}

/**
 * The categories of each kind, each with its items, as { kind: [{ guid, name, description, items:
 * [{ guid, name, active, type }] }] }, in order of name. With a category, by name or GUID, only that
 * category of each kind that has one.
 */
export async function listOrg(org, schema, { category = null } = {}) {
  const listed = {};
  for (const [kind, lists] of Object.entries(KINDS)) {
    const categoryOrder = orderOf(schema, lists.categories);
    const itemOrder = orderOf(schema, lists.items);
    const where =
      category === null
        ? ""
        : ` WHERE ${isCategoryGuid(category) ? GUID : "Name"} = ${soqlList([category])}`;
    const categories = await org.query(
      `SELECT ${GUID}, Name, ${namespaced("Description__c")} FROM ${namespaced(categoryOrder.object)}` +
        `${where} ORDER BY Name`
    );
    const relationship = parentRelationship(itemOrder.parentField);
    const fields = [
      GUID,
      "Name",
      `${relationship}.${GUID}`,
      namespaced("Active_Versions_Count__c")
    ];
    if (kind === "dataTemplate") {
      fields.push(namespaced("Type__c"));
    }
    const items = new Map(categories.map((record) => [record[GUID], []]));
    if (categories.length > 0) {
      const filter =
        category === null
          ? ""
          : ` WHERE ${relationship}.${GUID} IN (${soqlList(items.keys())})`;
      for (const record of await org.query(
        `SELECT ${fields.join(", ")} FROM ${namespaced(itemOrder.object)}${filter} ORDER BY Name`
      )) {
        items.get(record[relationship]?.[GUID])?.push({
          guid: record[GUID],
          name: record.Name,
          active: (record[namespaced("Active_Versions_Count__c")] ?? 0) > 0,
          type: record[namespaced("Type__c")] ?? null
        });
      }
    }
    listed[kind] = categories.map((record) => ({
      guid: record[GUID],
      name: record.Name,
      description: record[namespaced("Description__c")] ?? null,
      items: items.get(record[GUID])
    }));
  }
  return listed;
}
