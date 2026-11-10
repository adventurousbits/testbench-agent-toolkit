/**
 * Loads the schema files and checks a value against them.
 *
 * Interprets the part of JSON Schema 2020-12 the Testbench schema uses, with no dependencies, so the
 * schema files stay the single source of what is allowed. Keywords it does not know are ignored, as
 * JSON Schema prescribes, which is how the `x-testbench` annotations sit beside the shapes.
 */
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/** The schema folder, a sibling of the scripts folder in `shared/` and in every skill. */
export const SCHEMA_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schema"
);
export const SCHEMA_VERSION = "v1";

// Keys whose `const` chooses among the branches of an `anyOf`: a step's `type`, a Verify Outcome's
// `assertType`. Reporting "type X is not allowed here" says far more than every branch's complaint.
const DISCRIMINATORS = ["type", "assertType"];

/** True for a plain JSON object, not an array or null. */
export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every schema file of one version, loaded on first use and addressed by its relative path. */
export class SchemaStore {
  constructor(root = SCHEMA_ROOT, version = SCHEMA_VERSION) {
    this.root = join(root, version);
    this.documents = new Map();
  }

  /** The schema file at a path relative to the version's folder. */
  document(relativePath) {
    if (!this.documents.has(relativePath)) {
      const text = readFileSync(join(this.root, relativePath), "utf8");
      this.documents.set(relativePath, JSON.parse(text));
    }
    return this.documents.get(relativePath);
  }

  /** Follows a `$ref` written in the file at basePath. Returns [file, schema]. */
  resolve(basePath, ref) {
    const hash = ref.indexOf("#");
    const target = hash === -1 ? ref : ref.slice(0, hash);
    const fragment = hash === -1 ? "" : ref.slice(hash + 1);
    const path = target
      ? posix.join(posix.dirname(basePath), target)
      : basePath;
    let node = this.document(path);
    for (const part of fragment.split("/").filter(Boolean)) {
      node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return [path, node];
  }

  /** Follows `$ref` until a schema without one, for reading annotations and discriminators. */
  follow(basePath, schema) {
    while (isObject(schema) && "$ref" in schema) {
      [basePath, schema] = this.resolve(basePath, schema.$ref);
    }
    return [basePath, schema];
  }
}

/** The JSON type of a value, telling an integer from other numbers as JSON Schema does. */
export function jsonType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

/** JSON equality, by value. */
export function same(left, right) {
  const leftType = jsonType(left);
  const rightType = jsonType(right);
  const numbers = new Set(["integer", "number"]);
  if (
    leftType !== rightType &&
    !(numbers.has(leftType) && numbers.has(rightType))
  ) {
    return false;
  }
  if (leftType === "array") {
    return (
      left.length === right.length &&
      left.every((item, index) => same(item, right[index]))
    );
  }
  if (leftType === "object") {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) => Object.hasOwn(right, key) && same(left[key], right[key])
      )
    );
  }
  return left === right;
}

/** A value as JSON text, for a message. A missing value reads as null. */
export function show(value) {
  return JSON.stringify(value ?? null);
}

export class Validator {
  constructor(store = new SchemaStore()) {
    this.store = store;
  }

  /** Returns [path, message] for every way instance breaks the schema at filePath#pointer. */
  validate(instance, filePath, pointer = "", path = "$") {
    const schema = pointer
      ? this.store.resolve(filePath, "#" + pointer)[1]
      : this.store.document(filePath);
    const errors = [];
    this.check(instance, schema, filePath, path, errors);
    return errors;
  }

  /** True when value matches the schema. */
  isValid(value, schema, base) {
    const errors = [];
    this.check(value, schema, base, "$", errors);
    return errors.length === 0;
  }

  check(value, schema, base, path, errors) {
    if (schema === true) {
      return;
    }
    if (schema === false) {
      errors.push([path, "nothing is allowed here"]);
      return;
    }
    if ("$ref" in schema) {
      const [refBase, target] = this.store.resolve(base, schema.$ref);
      this.check(value, target, refBase, path, errors);
    }
    const kind = jsonType(value);

    if ("type" in schema) {
      const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (
        !(
          allowed.includes(kind) ||
          (kind === "integer" && allowed.includes("number"))
        )
      ) {
        errors.push([path, `must be ${allowed.join(" or ")}, not ${kind}`]);
        return;
      }
    }
    if ("const" in schema && !same(value, schema.const)) {
      errors.push([path, `must be ${show(schema.const)}, not ${show(value)}`]);
      return;
    }
    if (
      "enum" in schema &&
      !schema.enum.some((option) => same(value, option))
    ) {
      errors.push([
        path,
        `${show(value)} is not allowed; allowed: ${schema.enum.map(show).join(", ")}`
      ]);
      return;
    }

    if (kind === "string") {
      this.checkString(value, schema, base, path, errors);
    }
    if (kind === "array") {
      this.checkArray(value, schema, base, path, errors);
    }
    if (kind === "object") {
      this.checkObject(value, schema, base, path, errors);
    }

    for (const part of schema.allOf ?? []) {
      this.check(value, part, base, path, errors);
    }
    if ("anyOf" in schema) {
      this.checkAnyOf(value, schema.anyOf, base, path, errors);
    }
    if ("if" in schema && this.isValid(value, schema.if, base)) {
      if ("then" in schema) {
        this.check(value, schema.then, base, path, errors);
      }
    } else if ("if" in schema && "else" in schema) {
      this.check(value, schema.else, base, path, errors);
    }
  }

  checkString(value, schema, base, path, errors) {
    // JSON Schema counts characters, not the UTF-16 units a JavaScript string's length counts.
    const length = [...value].length;
    if ("minLength" in schema && length < schema.minLength) {
      errors.push([path, `must be at least ${schema.minLength} characters`]);
    }
    if ("maxLength" in schema && length > schema.maxLength) {
      errors.push([path, `must be at most ${schema.maxLength} characters`]);
    }
    if ("pattern" in schema && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push([path, `${show(value)} does not match ${schema.pattern}`]);
    }
    if (schema.contentMediaType === "application/json") {
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch (problem) {
        errors.push([path, `is not valid JSON text: ${problem.message}`]);
        return;
      }
      if ("contentSchema" in schema) {
        this.check(parsed, schema.contentSchema, base, path, errors);
      }
    }
  }

  checkArray(value, schema, base, path, errors) {
    if ("minItems" in schema && value.length < schema.minItems) {
      errors.push([path, `must hold at least ${schema.minItems} item(s)`]);
    }
    if ("maxItems" in schema && value.length > schema.maxItems) {
      errors.push([path, `must hold at most ${schema.maxItems} item(s)`]);
    }
    if (schema.uniqueItems) {
      value.forEach((item, index) => {
        if (value.slice(0, index).some((earlier) => same(item, earlier))) {
          errors.push([
            `${path}[${index}]`,
            `${show(item)} appears more than once`
          ]);
        }
      });
    }
    if ("items" in schema) {
      value.forEach((item, index) =>
        this.check(item, schema.items, base, `${path}[${index}]`, errors)
      );
    }
  }

  checkObject(value, schema, base, path, errors) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) {
        errors.push([path, `missing required ${show(name)}`]);
      }
    }
    // Names come from the file, so they are looked up as own properties: a field named
    // `constructor` must not find what every JavaScript object inherits.
    for (const [name, item] of Object.entries(value)) {
      const child = `${path}.${name}`;
      if ("propertyNames" in schema) {
        this.check(name, schema.propertyNames, base, child, errors);
      }
      if (Object.hasOwn(properties, name)) {
        this.check(item, properties[name], base, child, errors);
      } else if (schema.additionalProperties === false) {
        const allowed = Object.keys(properties).join(", ") || "none";
        errors.push([
          child,
          `${show(name)} is not allowed here; allowed keys: ${allowed}`
        ]);
      } else if (isObject(schema.additionalProperties)) {
        this.check(item, schema.additionalProperties, base, child, errors);
      }
    }
  }

  checkAnyOf(value, branches, base, path, errors) {
    const attempts = [];
    for (const branch of branches) {
      const branchErrors = [];
      this.check(value, branch, base, path, branchErrors);
      if (branchErrors.length === 0) {
        return;
      }
      attempts.push(branchErrors);
    }

    // Choose the branch the value was meant for, so the message is about that branch.
    if (isObject(value)) {
      for (const key of DISCRIMINATORS) {
        const consts = branches.map((branch) =>
          this.constOf(branch, base, key)
        );
        if (
          Object.hasOwn(value, key) &&
          consts.every((option) => option !== undefined)
        ) {
          const chosen = consts.findIndex((option) => same(value[key], option));
          if (chosen !== -1) {
            errors.push(...attempts[chosen]);
            return;
          }
          const allowed = consts.map(show).join(", ");
          errors.push([
            `${path}.${key}`,
            `${show(value[key])} is not allowed here; allowed: ${allowed}`
          ]);
          return;
        }
      }
    }
    const matchingType = attempts.filter(
      (_, index) => this.typeOf(branches[index], base) === jsonType(value)
    );
    if (matchingType.length === 1) {
      errors.push(...matchingType[0]);
      return;
    }
    errors.push([path, "does not match any allowed form"]);
    errors.push(
      ...attempts.reduce((fewest, attempt) =>
        attempt.length < fewest.length ? attempt : fewest
      )
    );
  }

  constOf(branch, base, key) {
    const [, schema] = this.store.follow(base, branch);
    return schema?.properties?.[key]?.const;
  }

  typeOf(branch, base) {
    const [, schema] = this.store.follow(base, branch);
    return schema?.type;
  }
}
