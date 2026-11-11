---
name: testbench-run
description: "Use to run Testbench feature tests and validate personas and data templates in a Salesforce org, and to run them in a pipeline: run tests by name, category or all, or try a file just written, wait for the results and explain them. Works through the toolkit's script and the Salesforce CLI. Triggers when a user asks to run, re-run, try or validate Testbench tests, personas or templates, to see what passes in an org, or to run Testbench tests in a pipeline. Asks for confirmation before writing to a production org. Do NOT trigger for writing tests (use testbench-feature-test-generate), for saving tests into the project, loading them into another org or deleting them (use testbench-org-sync), or for explaining a failure in depth (use testbench-run-result-verify)."
license: Apache-2.0
metadata:
  version: "1.0.1"
  domains: ["Testing"]
  relatedSkills:
    - "testbench-feature-test-generate"
    - "testbench-persona-generate"
    - "testbench-data-template-generate"
    - "testbench-org-sync"
    - "testbench-run-result-verify"
  cliTools:
    - tool: ["node"]
      semver: ">=20.0.0"
    - tool: ["sf"]
      semver: ">=2.0.0"
---

# Running Testbench Tests

Run feature tests, and validate personas and data templates, in the org where they live; wait for
the results, and explain them. The toolkit's script does the work (`references/script.md`); this
skill says what to run, and how to report it.

## Scope

- **In scope:** running feature tests, validating personas and templates, reading the latest results
  and verdicts, trying a file just written, and running tests in a pipeline.
- **Out of scope:** writing tests and data (the `-generate` skills); saving tests into the project,
  loading them into another org and deleting them (`testbench-org-sync`); finding the cause of a
  failure in depth (`testbench-run-result-verify`).

---

## Before the first run

These are one-time steps for the org, done by its administrator, and the toolkit cannot do them:

- Testbench is installed, and its connection is set up as the installation guide describes: the
  External Client App, the External Credential, the Named Credential, and the Testbench Setup custom
  setting naming it.
- The user the Salesforce CLI is signed in as holds the **Testbench** permission set, and the
  permission set that grants access to the External Credential.

Check the CLI is signed in to the right org:

```bash
sf org display --target-org <alias>
```

---

## Choosing what to run

**The org holds the tests.** Name what to run by its GUID. The script's `list` shows each category in
the org with its tests, personas and templates, and their GUIDs:

```bash
node <skill-directory>/scripts/testbench.mjs list --target-org <alias>
```

| The developer asks for     | Run                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| A test, by its name        | `run <test GUID>`, the GUID taken from `list`                                              |
| A category                 | `run --category "<category name>"`, or `run <category GUID>`                               |
| Every test                 | `run --all`, once the developer agrees to the number (see the workflow)                    |
| A file just written        | `run <file>`: it loads the file into the org first, as the app's import does, then runs it |
| Nothing, and nothing found | Start nothing: show the categories from `list` with how many tests each holds, and ask     |

A name can match more than one test, or none: say which ones match, and ask. `validate` takes
personas and templates the same way, and `results` takes either and starts nothing.

---

## Workflow

1. **Check the org.** The script reports the org's kind before anything else. **In production, stop
   and ask the developer to confirm** before running anything there: a run writes to the org. Pass
   `--allow-production` only after their explicit yes, and only for that org.
2. **Count before a large run.** For `--all` or a large category, run with `--dry-run` first, tell the
   developer how many tests would run, and start them only once they agree.
3. **Run**, and let the script wait for a new result of each test. A test whose definition changed is
   deployed first, which takes minutes.
4. **Report each result** in the words the Testbench editor uses, which the script already gives,
   step by step. Say plainly what passed and what failed, and for a failure, why. To find the cause,
   use `testbench-run-result-verify`.

**Validating** personas and templates follows the same steps with `validate`. Report each verdict,
and explain every `Invalid` one: fix it before running tests that use it.

**For a pipeline**, follow `references/pipeline.md`: the script is copied into the project, and one
step runs the org's tests, waits, writes a JUnit report and fails the build when a test fails.

---

## What happens in the org

The toolkit only writes records. Testbench does the rest, exactly as when someone uses the app:

| The toolkit sets                                   | Testbench then                                           |
| -------------------------------------------------- | -------------------------------------------------------- |
| A test's `Test_Run_Required__c`                    | Runs the test once it is deployed, and stores the result |
| A persona's or template's `Validation_Required__c` | Validates it once it is deployed, and stores the verdict |
| A version's `Active__c`, when a file is loaded     | Deactivates the other versions and deploys the new one   |

- **A test waits for what it uses, and so does a validation.** A run or validation requested while a
  persona or template it uses is still deploying, or while a change to the global templates is,
  starts once that has finished.
- **A deployment can fail.** The script then shows its status (`TranspilationFailed`,
  `DeploymentFailed` or `DeploymentCancelled`) and Testbench's details. `TranspilationFailed` means
  the test could not be prepared, usually because a step names something the org lacks; check its
  file against the org (`references/script.md`).
- **A test already running is not started again**: its next result is the one reported.
- **The org has a daily allowance of Apex test runs**, set by Salesforce and shared with everything
  else in the org. Every run and validation uses it, and when it is used up a run fails with
  `TEST_RUN_DAILY_LIMIT_REACHED` until it resets.

---

## Rules

1. **Production only after an explicit yes.** Testbench runs in production too, but a run there
   writes to the developer's live org. Say so, and wait for their confirmation for that org.
2. **Ask before a large run.** Name the number of tests first; every run uses the daily allowance.
3. **Report results as they are.** A test that fails because the org does not do what it should has
   found something. Never change a test to match the org without asking.
4. **Running loads nothing, unless a file is named.** A test named by GUID runs as the org holds it.
   To try a change, write it with the `-generate` skills, and run the file.

---

## References

| File                          | Read it for                                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| `references/script.md`        | Every command of the script: what it does, its options, its codes |
| `references/pipeline.md`      | Running the tests in a pipeline                                   |
| `testbench-run-result-verify` | Finding the cause of a failure                                    |
