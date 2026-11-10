/**
 * Waiting for Testbench to finish what a write started: a deployment, a run, a validation.
 *
 * **Wait for the state the work ends in, never for a field to look right.** A field that already
 * holds last time's answer cannot say this time's has arrived, so each wait names the values that
 * mean this piece of work is over.
 */
import { namespaced } from "./org.mjs";
import { DEPLOYED, FAILED_DEPLOYMENTS, selectByGuid } from "./records.mjs";

/** How often to look, in seconds: `TESTBENCH_POLL_SECONDS`, or 20. */
function pollSeconds() {
  const seconds = Number(process.env.TESTBENCH_POLL_SECONDS);
  return process.env.TESTBENCH_POLL_SECONDS !== undefined &&
    Number.isFinite(seconds) &&
    seconds >= 0
    ? seconds
    : 20;
}

/** How long to wait and how often to look. Tests replace sleep and now. */
export const DEFAULT_WAIT = {
  timeoutMs: 30 * 60 * 1000,
  intervalMs: pollSeconds() * 1000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  progress: (text) => process.stderr.write(text + "\n")
};

/** The Testbench object of each kind of item. */
export const ITEM_OBJECTS = {
  persona: "Persona__c",
  dataTemplate: "Data_Template__c",
  featureTest: "Feature_Test__c"
};

/**
 * Asks poll() until it reports nothing pending, or the time is up. poll resolves to
 * { pending, total, label, ... }; the last answer is returned, with timedOut set when time ran out.
 */
export async function pollUntilDone(poll, options = {}) {
  const { timeoutMs, intervalMs, sleep, now, progress } = {
    ...DEFAULT_WAIT,
    ...options
  };
  const deadline = now() + timeoutMs;
  let reported = null;
  for (;;) {
    const answer = await poll();
    if (answer.pending === 0) {
      return { ...answer, timedOut: false };
    }
    if (now() >= deadline) {
      return { ...answer, timedOut: true };
    }
    if (answer.pending !== reported) {
      progress(
        `${answer.label}: ${answer.total - answer.pending} of ${answer.total} done, waiting…`
      );
      reported = answer.pending;
    }
    await sleep(intervalMs);
  }
}

/** True when a deployment has ended, either way. */
export function deploymentEnded(record) {
  const status = record[namespaced("Deployment_Status__c")] ?? null;
  return (
    record[namespaced("Deployment_Required__c")] !== true &&
    (status === DEPLOYED || FAILED_DEPLOYMENTS.includes(status))
  );
}

/** True when a deployment ended without a class to run: the item cannot be used until it is fixed. */
export function deploymentFailed(record) {
  return (
    deploymentEnded(record) &&
    FAILED_DEPLOYMENTS.includes(record[namespaced("Deployment_Status__c")])
  );
}

/**
 * Waits until each item's deployment has ended. items is a list of { kind, guid }. Resolves to the
 * last poll's answer, whose states map each GUID to { status, details, ended }; an item no longer in
 * the org has no state.
 *
 * Activating a version clears its item's deployment status in the same transaction, so the status a
 * deployment ends in can only be this deployment's.
 */
export async function waitForDeployments(org, items, options) {
  const fields = [
    "Name",
    ...[
      "Deployment_Status__c",
      "Deployment_Details__c",
      "Deployment_Required__c"
    ].map(namespaced)
  ];
  const poll = async () => {
    const states = new Map();
    for (const [kind, objectName] of Object.entries(ITEM_OBJECTS)) {
      const guids = items
        .filter((item) => item.kind === kind)
        .map((item) => item.guid);
      if (guids.length === 0) {
        continue;
      }
      for (const [guid, record] of await selectByGuid(
        org,
        objectName,
        fields,
        guids
      )) {
        states.set(guid, {
          status: record[namespaced("Deployment_Status__c")] ?? null,
          details: record[namespaced("Deployment_Details__c")] ?? null,
          ended: deploymentEnded(record)
        });
      }
    }
    const pending = [...states.values()].filter((state) => !state.ended).length;
    return { pending, total: states.size, label: "Deploying", states };
  };
  return pollUntilDone(poll, options);
}
