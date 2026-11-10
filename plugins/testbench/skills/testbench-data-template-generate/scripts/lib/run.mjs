/**
 * Running feature tests, validating personas and data templates, and reading what came of either.
 *
 * The toolkit only sets flags; Testbench does the rest. `Test_Run_Required__c` runs a test once it is
 * deployed and stores a result. `Validation_Required__c` validates a persona or template on its own
 * and stores a verdict on it. Every run and validation counts against the org's daily allowance of
 * Apex test runs.
 */
import { Catalogue, contextGuids, explain } from "./explain.mjs";
import { isCategoryGuid, mayName } from "./guid.mjs";
import { KINDS } from "./model.mjs";
import { namespaced, soqlList } from "./org.mjs";
import {
  GUID,
  namesByGuid,
  parentRelationship,
  selectByGuid,
  selectById,
  updateById
} from "./records.mjs";
import { deploymentFailed, ITEM_OBJECTS, pollUntilDone } from "./wait.mjs";

const RUN_REQUIRED = namespaced("Test_Run_Required__c");
const RUNNING = namespaced("Is_Running__c");
const ACTIVE_VERSIONS = namespaced("Active_Versions_Count__c");
const RESULTS = namespaced("Test_Run_Result__r");
const VALIDATION_REQUIRED = namespaced("Validation_Required__c");
const VALIDATION_STATUS = namespaced("Validation_Status__c");
const LAST_VALIDATED = namespaced("Last_Validated__c");

const CATEGORY_FIELDS = {
  featureTest: "Feature_Test_Category__c",
  persona: "Persona_Category__c",
  dataTemplate: "Data_Template_Category__c"
};

const DEPLOYMENT_FIELDS = [
  "Deployment_Status__c",
  "Deployment_Details__c",
  "Deployment_Required__c"
].map(namespaced);
const CATEGORY = namespaced("Feature_Test_Category__r");
const TEST_FIELDS = [
  "Name",
  `${CATEGORY}.Name`,
  ACTIVE_VERSIONS,
  RUN_REQUIRED,
  RUNNING,
  ...DEPLOYMENT_FIELDS,
  `(SELECT Id FROM ${RESULTS} ORDER BY CreatedDate DESC, Id DESC LIMIT 1)`
];
const VALIDATION_FIELDS = [
  "Name",
  ACTIVE_VERSIONS,
  VALIDATION_REQUIRED,
  VALIDATION_STATUS,
  LAST_VALIDATED,
  namespaced("Validation_Outcome__c"),
  namespaced("Validation_Message__c"),
  ...DEPLOYMENT_FIELDS
];
const RESULT_FIELDS = [
  namespaced("Outcome__c"),
  namespaced("Outcome_Details__c"),
  "CreatedDate",
  `${namespaced("Feature_Test__r")}.${GUID}`,
  `${namespaced("Feature_Test_Version__r")}.${GUID}`,
  `${namespaced("Feature_Test_Version__r")}.Name`
];

function deployment(record) {
  return {
    status: record[namespaced("Deployment_Status__c")] ?? null,
    details: record[namespaced("Deployment_Details__c")] ?? null
  };
}

function newestResultId(test) {
  return test[RESULTS]?.records?.[0]?.Id ?? null;
}

/**
 * The items of the given kinds a command is about, as { kind: [{ guid, name }] }: those the files
 * hold, those named by GUID, those of the categories named by GUID, those of one category given by
 * name or GUID, or every one in the org. A category's items, and every one, are those with an active
 * version, as the app's Run All takes them.
 */
export async function findItems(
  org,
  kinds,
  { entries = [], guids = [], category = null, all = false } = {}
) {
  const found = {};
  for (const kind of kinds) {
    const seen = new Map();
    const add = (guid, name) => {
      if (guid && !seen.has(guid)) {
        seen.set(guid, { guid, name });
      }
    };
    for (const entry of entries) {
      for (const record of entry.file?.records(KINDS[kind].items) ?? []) {
        add(record.GUID__c, record.Name);
      }
    }
    const named = (role) => guids.filter((guid) => mayName(guid, kind, role));
    // An item named by GUID is named before its name is known; the org's answer replaces it.
    named("items").forEach((guid) => add(guid, guid));
    const relationship = parentRelationship(CATEGORY_FIELDS[kind]);
    const filters = [];
    if (named("categories").length > 0) {
      filters.push(
        `${relationship}.${GUID} IN (${soqlList(named("categories"))})`
      );
    }
    if (category !== null) {
      const key = isCategoryGuid(category) ? GUID : "Name";
      filters.push(`${relationship}.${key} = ${soqlList([category])}`);
    }
    if (all) {
      filters.push(null);
    }
    for (const filter of filters) {
      const where = [`${ACTIVE_VERSIONS} > 0`, filter]
        .filter(Boolean)
        .join(" AND ");
      for (const record of await org.query(
        `SELECT ${GUID}, Name FROM ${namespaced(ITEM_OBJECTS[kind])} WHERE ${where} ORDER BY Name`
      )) {
        add(record[GUID], record.Name);
      }
    }
    found[kind] = [...seen.values()];
  }
  return found;
}

/** Explains stored results, naming the personas and templates their problems were found in. */
async function explainAll(org, detailsList, catalogue) {
  const wanted = { personas: new Set(), dataTemplates: new Set() };
  for (const details of detailsList) {
    const guids = contextGuids(details);
    guids.personas.forEach((guid) => wanted.personas.add(guid));
    guids.dataTemplates.forEach((guid) => wanted.dataTemplates.add(guid));
  }
  const names = await namesByGuid(org, {
    personas: [...wanted.personas],
    dataTemplates: [...wanted.dataTemplates]
  });
  return detailsList.map((details) => explain(details, { names, catalogue }));
}

/** The stored results with these Ids, by Id, each with its explanation. */
async function readResults(org, resultIds, catalogue) {
  const results = await selectById(
    org,
    "Feature_Test_Run_Result__c",
    RESULT_FIELDS,
    resultIds
  );
  const records = [...results.values()];
  const explanations = await explainAll(
    org,
    records.map((record) => record[namespaced("Outcome_Details__c")]),
    catalogue
  );
  return new Map(
    records.map((record, index) => [
      record.Id,
      {
        id: record.Id,
        outcome: record[namespaced("Outcome__c")] ?? null,
        at: record.CreatedDate,
        version: record[namespaced("Feature_Test_Version__r")]?.[GUID] ?? null,
        explanation: explanations[index]
      }
    ])
  );
}

/**
 * Runs feature tests, each { guid, name }, and waits for a new result of each.
 *
 * **It waits for the new result, never for a status:** `Run_Status__c` still reads `Completed` from
 * the previous run until this one starts, so it cannot tell a finished run from one not yet begun. A
 * test already queued or running is not flagged again; its next result is the one waited for.
 *
 * Resolves to one outcome per test: { guid, name, category, state, reason, result, deployment },
 * state being "finished", "not run" or "still running" when the wait ran out. With dryRun, nothing is
 * flagged, and the tests that would run have the state "would run".
 */
export async function runTests(
  org,
  tests,
  { dryRun = false, wait = {}, catalogue = new Catalogue() } = {}
) {
  const records = await selectByGuid(
    org,
    "Feature_Test__c",
    TEST_FIELDS,
    tests.map((test) => test.guid)
  );
  const outcomes = new Map();
  const runnable = [];
  for (const test of tests) {
    const record = records.get(test.guid);
    const outcome = {
      guid: test.guid,
      name: record?.Name ?? test.name,
      category: record?.[CATEGORY]?.Name ?? null,
      state: "not run",
      reason: null
    };
    outcomes.set(test.guid, outcome);
    if (!record) {
      outcome.reason = "it is not in the org: push it first";
    } else if (!record[ACTIVE_VERSIONS]) {
      outcome.reason = "it has no active version";
    } else if (deploymentFailed(record)) {
      outcome.reason = "its deployment failed";
      outcome.deployment = deployment(record);
    } else {
      outcome.state = dryRun ? "would run" : "running";
      runnable.push({
        outcome,
        id: record.Id,
        baseline: newestResultId(record),
        queued: record[RUN_REQUIRED] === true || record[RUNNING] === true
      });
    }
  }
  if (dryRun || runnable.length === 0) {
    return [...outcomes.values()];
  }

  const toFlag = runnable.filter((test) => !test.queued);
  const flagged = await updateById(
    org,
    "Feature_Test__c",
    toFlag.map((test) => ({ Id: test.id, [RUN_REQUIRED]: true }))
  );
  flagged.forEach((result, index) => {
    if (!result.success) {
      toFlag[index].outcome.state = "not run";
      toFlag[index].outcome.reason =
        `it could not be started: ${result.errors.join("; ")}`;
    }
  });
  const waiting = runnable.filter((test) => test.outcome.state === "running");

  const answer = await pollUntilDone(async () => {
    const now = await selectById(
      org,
      "Feature_Test__c",
      TEST_FIELDS,
      waiting.map((test) => test.id)
    );
    const states = new Map();
    for (const test of waiting) {
      const record = now.get(test.id);
      const newest = record ? newestResultId(record) : null;
      const finished =
        record !== undefined &&
        newest !== null &&
        newest !== test.baseline &&
        record[RUN_REQUIRED] !== true &&
        record[RUNNING] !== true;
      const failed = record !== undefined && deploymentFailed(record);
      states.set(test.id, {
        done: record === undefined || finished || failed,
        finished,
        failed,
        newest,
        record
      });
    }
    const pending = [...states.values()].filter((state) => !state.done).length;
    return { pending, total: waiting.length, label: "Running", states };
  }, wait);

  const resultIds = [...answer.states.values()]
    .filter((state) => state.finished)
    .map((state) => state.newest);
  const results = await readResults(org, resultIds, catalogue);
  for (const test of waiting) {
    const state = answer.states.get(test.id);
    if (state.finished) {
      test.outcome.state = "finished";
      test.outcome.result = results.get(state.newest) ?? null;
    } else if (state.failed) {
      test.outcome.state = "not run";
      test.outcome.reason = "its deployment failed";
      test.outcome.deployment = deployment(state.record);
    } else if (state.record === undefined) {
      test.outcome.state = "not run";
      test.outcome.reason = "it was deleted from the org";
    } else {
      test.outcome.state = "still running";
      test.outcome.reason =
        "no new result arrived in the time allowed; it goes on in the org";
    }
  }
  return [...outcomes.values()];
}

/** A verdict as stored on a persona or template. */
function verdict(record, explanation) {
  return {
    outcome: record[namespaced("Validation_Outcome__c")] ?? null,
    at: record[LAST_VALIDATED] ?? null,
    explanation
  };
}

/**
 * Validates personas and data templates, given as { persona: [...], dataTemplate: [...] } of
 * { guid, name }, and waits for each new verdict.
 *
 * **A validation is over when nothing asks for it any more, its status reads `Validated`, and
 * `Last_Validated__c` holds a new time.** Asking for a validation leaves the status alone until it
 * starts, as asking for a run does, so a `Validated` status can still be the last validation's.
 *
 * **Personas are validated first, and templates only once every persona has its verdict.** Every
 * Testbench version the toolkit supports validates personas and templates one at a time, whichever
 * kind they are, so the order is no longer needed for a correct verdict; it costs at most the wait
 * between the two kinds. A validation Salesforce refuses, because someone else is running Apex
 * tests synchronously, returns to Not Validated without a verdict.
 *
 * Resolves to one outcome per item: { kind, guid, name, state, reason, verdict, deployment }.
 */
export async function validateItems(org, items, options = {}) {
  const outcomes = [];
  for (const kind of ["persona", "dataTemplate"]) {
    if (items[kind]?.length) {
      outcomes.push(...(await validateKind(org, kind, items[kind], options)));
    }
  }
  return outcomes;
}

/** Validates the personas, or the templates, given, and waits for every verdict. */
async function validateKind(
  org,
  kind,
  list,
  { dryRun = false, wait = {}, catalogue = new Catalogue() } = {}
) {
  const objectName = ITEM_OBJECTS[kind];
  const outcomes = [];
  const validatable = [];
  const records = await selectByGuid(
    org,
    objectName,
    VALIDATION_FIELDS,
    list.map((item) => item.guid)
  );
  for (const item of list) {
    const record = records.get(item.guid);
    const outcome = {
      kind,
      guid: item.guid,
      name: record?.Name ?? item.name,
      state: "not validated",
      reason: null
    };
    outcomes.push(outcome);
    if (!record) {
      outcome.reason = "it is not in the org: push it first";
    } else if (!record[ACTIVE_VERSIONS]) {
      outcome.reason = "it has no active version, so it cannot be validated";
    } else if (deploymentFailed(record)) {
      outcome.reason = "its deployment failed";
      outcome.deployment = deployment(record);
    } else {
      outcome.state = dryRun ? "would validate" : "validating";
      const status = record[VALIDATION_STATUS];
      validatable.push({
        outcome,
        id: record.Id,
        baseline: record[LAST_VALIDATED] ?? null,
        queued:
          record[VALIDATION_REQUIRED] === true ||
          status === "Pending" ||
          status === "Validating"
      });
    }
  }
  if (dryRun || validatable.length === 0) {
    return outcomes;
  }

  const toFlag = validatable.filter((item) => !item.queued);
  if (toFlag.length > 0) {
    const flagged = await updateById(
      org,
      objectName,
      toFlag.map((item) => ({ Id: item.id, [VALIDATION_REQUIRED]: true }))
    );
    flagged.forEach((result, index) => {
      if (!result.success) {
        toFlag[index].outcome.state = "not validated";
        toFlag[index].outcome.reason =
          `it could not be validated: ${result.errors.join("; ")}`;
      }
    });
  }
  const waiting = validatable.filter(
    (item) => item.outcome.state === "validating"
  );

  const answer = await pollUntilDone(async () => {
    const now = await selectById(
      org,
      objectName,
      VALIDATION_FIELDS,
      waiting.map((item) => item.id)
    );
    const states = new Map();
    for (const item of waiting) {
      const record = now.get(item.id);
      // Asking leaves the status alone until the queue takes the validation, as asking for a run
      // does, so a Validated status can be the last one's. This one has finished when nothing asks
      // any more and a new validation time is stamped.
      const finished =
        record !== undefined &&
        record[VALIDATION_REQUIRED] !== true &&
        record[VALIDATION_STATUS] === "Validated" &&
        (record[LAST_VALIDATED] ?? null) !== null &&
        record[LAST_VALIDATED] !== item.baseline;
      const failed = record !== undefined && deploymentFailed(record);
      // Back to Not Validated, and no longer asking: this validation ended without a verdict.
      const returned =
        record !== undefined &&
        record[VALIDATION_STATUS] === "Not Validated" &&
        record[VALIDATION_REQUIRED] !== true;
      states.set(item.id, {
        done: record === undefined || finished || failed || returned,
        finished,
        failed,
        returned,
        record
      });
    }
    const pending = [...states.values()].filter((state) => !state.done).length;
    return { pending, total: waiting.length, label: "Validating", states };
  }, wait);

  const finished = waiting.filter(
    (item) => answer.states.get(item.id).finished
  );
  const explanations = await explainAll(
    org,
    finished.map(
      (item) =>
        answer.states.get(item.id).record[namespaced("Validation_Message__c")]
    ),
    catalogue
  );
  finished.forEach((item, index) => {
    item.outcome.state = "finished";
    item.outcome.verdict = verdict(
      answer.states.get(item.id).record,
      explanations[index]
    );
  });
  for (const item of waiting.filter(
    (each) => !answer.states.get(each.id).finished
  )) {
    const state = answer.states.get(item.id);
    item.outcome.state = "not validated";
    if (state.failed) {
      item.outcome.reason = "its deployment failed";
      item.outcome.deployment = deployment(state.record);
    } else if (state.record === undefined) {
      item.outcome.reason = "it was deleted from the org";
    } else if (state.returned) {
      item.outcome.reason =
        "it ended without a verdict: the org was running another synchronous Apex test run, or it was deactivated meanwhile. Validate it again";
    } else {
      item.outcome.state = "still validating";
      item.outcome.reason =
        "no new verdict arrived in the time allowed; it goes on in the org";
    }
  }
  return outcomes;
}

/**
 * The latest result of each feature test and the latest verdict of each persona and template, without
 * starting anything. items is { featureTest, persona, dataTemplate } of { guid, name }.
 */
export async function latestResults(
  org,
  items,
  { catalogue = new Catalogue() } = {}
) {
  const tests = [];
  if (items.featureTest?.length) {
    const records = await selectByGuid(
      org,
      "Feature_Test__c",
      TEST_FIELDS,
      items.featureTest.map((test) => test.guid)
    );
    const newest = [...records.values()].map(newestResultId).filter(Boolean);
    const results = await readResults(org, newest, catalogue);
    for (const test of items.featureTest) {
      const record = records.get(test.guid);
      tests.push({
        guid: test.guid,
        name: record?.Name ?? test.name,
        inOrg: record !== undefined,
        deployment: record ? deployment(record) : null,
        result: record ? (results.get(newestResultId(record)) ?? null) : null
      });
    }
  }
  const verdicts = [];
  for (const kind of ["persona", "dataTemplate"]) {
    if (!items[kind]?.length) {
      continue;
    }
    const records = await selectByGuid(
      org,
      ITEM_OBJECTS[kind],
      VALIDATION_FIELDS,
      items[kind].map((item) => item.guid)
    );
    const list = items[kind].map((item) => ({
      item,
      record: records.get(item.guid)
    }));
    const explanations = await explainAll(
      org,
      list.map(
        ({ record }) => record?.[namespaced("Validation_Message__c")] ?? null
      ),
      catalogue
    );
    list.forEach(({ item, record }, index) =>
      verdicts.push({
        kind,
        guid: item.guid,
        name: record?.Name ?? item.name,
        inOrg: record !== undefined,
        status: record?.[VALIDATION_STATUS] ?? null,
        deployment: record ? deployment(record) : null,
        verdict: record ? verdict(record, explanations[index]) : null
      })
    );
  }
  return { tests, verdicts };
}
