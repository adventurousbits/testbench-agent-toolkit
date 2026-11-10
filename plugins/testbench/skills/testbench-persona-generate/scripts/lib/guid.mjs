/**
 * GUIDs: a prefix naming the kind of record or step, then 32 lowercase hexadecimal characters.
 */
import { randomBytes } from "node:crypto";

/**
 * The prefix each kind of GUID starts with (`guids.md`): one letter, so no prefix starts another.
 * Every category's starts with C and every version's with V, whatever its kind.
 */
export const GUID_PREFIXES = ["C", "T", "V", "N", "P", "D"];

/**
 * The GUID of Global Templates, the category every Global data template is in. The same in every
 * org, so it is never made with `guid`.
 */
export const GLOBAL_TEMPLATES_GUID = "CGlobalTemplates";

/** A new GUID, from the system's random source: a GUID written by hand repeats patterns. */
export function newGuid(prefix) {
  return prefix + randomBytes(16).toString("hex");
}

/** The prefix of a GUID, such as "V" for a version's. */
export function prefixOf(guid) {
  return /^[A-Z]+/.exec(guid)?.[0] ?? "";
}

// The record each prefix names: its kind of item, and its list's role in a file. A category's or a
// version's kind is null: its GUID does not say it, and the org does.
const RECORDS = {
  C: { kind: null, role: "categories" },
  T: { kind: "featureTest", role: "items" },
  V: { kind: null, role: "versions" },
  P: { kind: "persona", role: "items" },
  D: { kind: "dataTemplate", role: "items" }
};

/** True for a value written as a GUID, of a record or a step, rather than a file or folder. */
export function isGuid(value) {
  return value === GLOBAL_TEMPLATES_GUID || /^[A-Z][0-9a-f]{32}$/.test(value);
}

/**
 * The record a GUID names, as { kind, role }: a category, item or version. The kind is null for a
 * category or version, except Global Templates. Null for a step's GUID or anything that is not a GUID.
 */
export function recordOf(guid) {
  if (guid === GLOBAL_TEMPLATES_GUID) {
    return { kind: "dataTemplate", role: "categories" };
  }
  return isGuid(String(guid)) ? (RECORDS[prefixOf(guid)] ?? null) : null;
}

/** True when a GUID may name a record of this kind and role: a category's or version's may be any kind's. */
export function mayName(guid, kind, role) {
  const named = recordOf(guid);
  return named?.role === role && (named.kind === null || named.kind === kind);
}

/** True when a value is a category's GUID rather than its name. */
export function isCategoryGuid(value) {
  return recordOf(value)?.role === "categories";
}
