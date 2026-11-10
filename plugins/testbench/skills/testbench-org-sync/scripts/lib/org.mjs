/**
 * Talks to a Salesforce org through the Salesforce CLI.
 *
 * Every request goes through `sf`, which holds the developer's own sign-in, so no access token passes
 * through this code.
 *
 * **A query never passes through a command line.** It is written to a file for `sf data query
 * --file`, and a request body goes to `sf api request rest` on standard input. On Windows `sf` is a
 * `.cmd` file, which Node can only start through the shell, where quoting is unreliable; what is
 * left on the command line is names, aliases and paths, and those are quoted.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isObject } from "./schema.mjs";

export const NAMESPACE = "testbench__";

/** A request the org refused, or one that could not be made. */
export class OrgError extends Error {
  constructor(message, code = null) {
    super(message);
    this.code = code;
  }
}

/** A Testbench object or field name as the org knows it: `Feature_Test__c` is `testbench__Feature_Test__c`. */
export function namespaced(name) {
  return name.endsWith("__c") || name.endsWith("__r") ? NAMESPACE + name : name;
}

/** Values for a SOQL `IN (...)` list. */
export function soqlList(values) {
  return [...values]
    .map(
      (value) =>
        "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"
    )
    .join(", ");
}

/** Splits values into groups of at most size, for requests that take a limited number. */
export function chunks(values, size = 200) {
  const list = [...values];
  const groups = [];
  for (let start = 0; start < list.length; start += size) {
    groups.push(list.slice(start, start + size));
  }
  return groups;
}

// Characters the Windows command line passes on unchanged without quotes.
const PLAIN_ARGUMENT = /^[A-Za-z0-9_@./:+-]+$/;

/** An argument for `cmd.exe`, which starts `sf.cmd` on Windows. */
function quoteForCmd(argument) {
  if (/["%!\r\n]/.test(argument)) {
    throw new OrgError(
      `cannot pass ${JSON.stringify(argument)} to sf on Windows`
    );
  }
  return PLAIN_ARGUMENT.test(argument) ? argument : `"${argument}"`;
}

/** Runs `sf` and resolves to { code, stdout, stderr }. The default runner; tests replace it. */
export function runSf(args, input) {
  return new Promise((resolvePromise, reject) => {
    const windows = process.platform === "win32";
    // Node passes arguments to a shell unescaped, so on Windows the command line is built here.
    const child = windows
      ? spawn(["sf", ...args.map(quoteForCmd)].join(" "), {
          shell: true,
          windowsHide: true
        })
      : spawn("sf", args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (problem) =>
      reject(
        problem.code === "ENOENT"
          ? new OrgError(
              "the Salesforce CLI (sf) was not found: install it from https://developer.salesforce.com/tools/salesforcecli"
            )
          : problem
      )
    );
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

function parseOutput(text) {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

/** The message of a REST error body or of an `sf --json` error. */
export function describeError(parsed) {
  if (Array.isArray(parsed) && parsed.length > 0 && isObject(parsed[0])) {
    return parsed
      .map((item) => `${item.errorCode ?? "ERROR"}: ${item.message ?? ""}`)
      .join("; ");
  }
  if (isObject(parsed)) {
    const code = parsed.data?.errorCode ?? parsed.errorCode ?? parsed.name;
    const message = String(parsed.message ?? "").trim();
    return code && message && !message.startsWith(code)
      ? `${code}: ${message}`
      : message || JSON.stringify(parsed);
  }
  return typeof parsed === "string" ? parsed : null;
}

function errorCode(parsed) {
  if (Array.isArray(parsed) && isObject(parsed[0])) {
    return parsed[0].errorCode ?? null;
  }
  return isObject(parsed)
    ? (parsed.data?.errorCode ?? parsed.errorCode ?? parsed.name ?? null)
    : null;
}

/** One org, as the Salesforce CLI knows it: by alias or username, or the CLI's default org. */
export class Org {
  constructor(alias = null, { runner = runSf } = {}) {
    this.alias = alias;
    this.runner = runner;
    this.version = null;
    this.describes = new Map();
    this.folder = null;
    this.queries = 0;
    this.user = null;
  }

  /** How the org is named in messages. */
  get label() {
    return this.alias ?? "the Salesforce CLI's default org";
  }

  targetOrg() {
    return this.alias ? ["--target-org", this.alias] : [];
  }

  /** A REST request. Resolves to the parsed response, or null for an empty one. */
  async rest(method, path, body) {
    const args = [
      "api",
      "request",
      "rest",
      path,
      "--method",
      method,
      ...this.targetOrg()
    ];
    let input;
    if (body !== undefined) {
      args.push("--body", "-");
      input = JSON.stringify(body);
    }
    const { code, stdout, stderr } = await this.runner(args, input);
    const parsed = parseOutput(stdout);
    if (code !== 0) {
      throw new OrgError(
        describeError(parsed) || stderr.trim() || `${method} ${path} failed`,
        errorCode(parsed)
      );
    }
    return parsed;
  }

  /** The org's newest API version, such as 66.0. */
  async apiVersion() {
    if (this.version === null) {
      const versions = await this.rest("GET", "/services/data/");
      if (!Array.isArray(versions) || versions.length === 0) {
        throw new OrgError(`${this.label} did not list its API versions`);
      }
      this.version = versions[versions.length - 1].version;
    }
    return this.version;
  }

  /** The Id of the user the Salesforce CLI is signed in to the org as. */
  async userId() {
    if (this.user === null) {
      this.user =
        (await this.rest("GET", "/services/oauth2/userinfo"))?.user_id ?? null;
      if (this.user === null) {
        throw new OrgError(
          `${this.label} did not say who the signed-in user is`
        );
      }
    }
    return this.user;
  }

  async dataPath(suffix) {
    return `/services/data/v${await this.apiVersion()}/${suffix.replace(/^\//, "")}`;
  }

  /** Every record a SOQL query returns, up to the CLI's limit of 10,000. */
  async query(soql, { tooling = false } = {}) {
    this.folder ??= mkdtempSync(join(tmpdir(), "testbench-"));
    const file = join(this.folder, `query-${++this.queries}.soql`);
    writeFileSync(file, soql, "utf8");
    const args = [
      "data",
      "query",
      "--file",
      file,
      "--json",
      ...this.targetOrg()
    ];
    if (tooling) {
      args.push("--use-tooling-api");
    }
    const { stdout, stderr } = await this.runner(args);
    const parsed = parseOutput(stdout);
    if (!isObject(parsed) || parsed.status !== 0) {
      throw new OrgError(
        describeError(parsed) || stderr.trim() || "the query failed",
        errorCode(parsed)
      );
    }
    return parsed.result?.records ?? [];
  }

  /** The object's describe as this user sees it, or null when the object does not exist for them. */
  async describe(objectName) {
    if (!this.describes.has(objectName)) {
      let described = null;
      try {
        described = await this.rest(
          "GET",
          await this.dataPath(`sobjects/${objectName}/describe`)
        );
      } catch (problem) {
        if (!(problem instanceof OrgError) || problem.code !== "NOT_FOUND") {
          throw problem;
        }
      }
      this.describes.set(objectName, described);
    }
    return this.describes.get(objectName);
  }

  /** Removes the query files this org wrote. */
  close() {
    if (this.folder) {
      rmSync(this.folder, { recursive: true, force: true });
      this.folder = null;
    }
  }
}
