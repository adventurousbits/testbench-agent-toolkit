/**
 * What an org must answer before anything touches its Testbench data: whether Testbench can be
 * reached, what kind of org it is, and which Testbench version it runs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OrgError } from "./org.mjs";
import { requireTestbench } from "./orgchecks.mjs";

/** The Testbench versions the toolkit supports, in the data folder beside the scripts folder. */
export const COMPATIBILITY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "compatibility.json"
);

export const PRODUCTION = "production";

/** The org's kind. A scratch org reports itself as a sandbox, and neither is production. */
export async function orgKind(org) {
  const [organization] = await org.query(
    "SELECT IsSandbox, TrialExpirationDate FROM Organization"
  );
  if (organization?.IsSandbox === true) {
    return "sandbox or scratch org";
  }
  if (organization?.TrialExpirationDate) {
    return "trial org";
  }
  return PRODUCTION;
}

/** The installed Testbench version, such as "1.6.0", or null where Testbench was deployed from source. */
export async function installedVersion(org) {
  // The namespace cannot be filtered on in this query, so every installed package is read.
  const records = await org.query(
    "SELECT SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, " +
      "SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion " +
      "FROM InstalledSubscriberPackage",
    { tooling: true }
  );
  const testbench = records.find(
    (record) => record.SubscriberPackage?.NamespacePrefix === "testbench"
  );
  if (!testbench) {
    return null;
  }
  const version = testbench.SubscriberPackageVersion;
  return `${version.MajorVersion}.${version.MinorVersion}.${version.PatchVersion}`;
}

/** Below zero when left is the older version, above zero when it is the newer. */
export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Checks the org before anything is read from it, written or run. Throws when the work must not go
 * on: Testbench cannot be reached, the org is production and the developer has not said yes, or its
 * Testbench is older than the toolkit supports, which would read some steps differently.
 *
 * Resolves to { kind, version, notes }, notes being what the developer should hear but that stops
 * nothing.
 */
export async function preflight(
  org,
  { write = false, allowProduction = false } = {}
) {
  await requireTestbench(org);
  const kind = await orgKind(org);
  if (write && kind === PRODUCTION && !allowProduction) {
    throw new OrgError(
      `${org.label} is a production org. Writing there creates and changes records in the live org, ` +
        `so ask the developer first, and run again with --allow-production once they have said yes.`,
      "PRODUCTION"
    );
  }
  const version = await installedVersion(org);
  const supported = JSON.parse(readFileSync(COMPATIBILITY_PATH, "utf8"));
  const notes = [];
  // No installed package means Testbench was deployed from source, which is normal in a development
  // org, and the version is null to say so.
  if (version !== null && compareVersions(version, supported.minimum) < 0) {
    throw new OrgError(
      `${org.label} has Testbench ${version}, older than ${supported.minimum}, the oldest version this ` +
        `toolkit supports: some steps would behave differently there. Ask for Testbench to be upgraded.`,
      "VERSION"
    );
  } else if (
    version !== null &&
    compareVersions(version, supported.testedWith) > 0
  ) {
    notes.push(
      `${org.label} has Testbench ${version}, newer than ${supported.testedWith}, the newest version this ` +
        `toolkit was tried with. A newer toolkit may be available.`
    );
  }
  return { kind, version, notes };
}
