---
name: testbench-run-result-verify
description: "Use to read and explain Testbench results: whether a feature test passed, which step failed and why, and whether a persona or data template validated. Turns a stored result into the sentences the Testbench editor shows, finds the cause and says what to change. Triggers when a user asks why a Testbench test failed, what a result or status code means, whether a test proves what it should, or to check the outcome of a run. Do NOT trigger for writing tests (use testbench-feature-test-generate) or for starting runs (use testbench-run)."
license: Apache-2.0
metadata:
  version: "1.0.0"
  domains: ["Testing"]
  relatedSkills:
    - "testbench-feature-test-generate"
    - "testbench-persona-generate"
    - "testbench-data-template-generate"
    - "testbench-run"
  cliTools:
    - tool: ["node"]
      semver: ">=20.0.0"
    - tool: ["sf"]
      semver: ">=2.0.0"
---

# Verifying Testbench Results

Read a feature test's result or a persona's or template's verdict, explain it in the editor's words,
and decide what it means: the org is wrong, the test is wrong, or the setup is incomplete.

## Scope

- **In scope:** feature test results, persona and data template verdicts, status codes, deployment
  failures, and judging whether a passing test proves anything.
- **Out of scope:** changing tests (the `-generate` skills) and starting runs (`testbench-run`).

---

## Getting the result

The script's `results` reads the newest result of each feature test and the latest verdict of each
persona and template, and explains every problem in the sentence the Testbench editor shows, under the
step it belongs to. It starts nothing.

```bash
node <skill-directory>/scripts/testbench.mjs results <GUID ...> --target-org <alias>
node <skill-directory>/scripts/testbench.mjs results --category "<category name>" --target-org <alias>
```

Find the GUIDs with the script's `list`. To read the steps of the test that failed, with what each
refers to named, use `show`:

```bash
node <skill-directory>/scripts/testbench.mjs show <test GUID> --target-org <alias>
```

`references/status-codes.md` holds every sentence, and `references/result-format.md` the stored result
itself, for when the script cannot be run.

| Outcome       | Means                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `Pass`        | Every step did what it should and every check held                                                   |
| `Fail`        | At least one problem was reported; each one names its step and status code                           |
| `CompileFail` | The test could no longer be started in the org as it was deployed: re-activate it to deploy it again |
| `Skip`        | The platform did not run the test                                                                    |

---

## Reading a failure

1. **Start at the first step that reports a problem.** Later problems are often its consequences: a
   record that was never created makes every step using it fail too, as `REFERRED_RECORD_NOT_FOUND`.
2. **Read the sentence, then the status code.** `references/status-codes.md` lists every sentence.
3. **A problem inside a persona or template** shows where it was found, such as
   `Persona “Sales representative” via ManagerId`. The cause is in that persona or template: validate
   it on its own (`testbench-run`) to see its problems in full. A validation shows the problems of
   what it depends on the same way, so a persona or template can be Invalid because of a dependency,
   a Global template included.
4. **A general problem** belongs to no step: the run itself was stopped, for example by the daily
   allowance of test runs.
5. **Find the cause in the test and the org, not only in the result.** The result says what differed;
   the test says what should have happened and why. Read the test's description and steps with
   `show`, then look in the org for the automation it relies on, on the object of the failing step:
   whether it exists, and whether it is active.

```bash
sf data query --target-org <alias> --json -q "SELECT ApiName, Label, IsActive, TriggerType FROM FlowDefinitionView WHERE TriggerObjectOrEvent.QualifiedApiName = '<Object>'"
sf data query --use-tooling-api --target-org <alias> --json -q "SELECT ValidationName, Active, Description FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '<Object>'"
sf data query --use-tooling-api --target-org <alias> --json -q "SELECT Name, Status FROM ApexTrigger WHERE TableEnumOrId = '<Object>'"
```

Automation that is missing or inactive explains a check that failed or an error that did not
occur. When the automation is there and active, compare what it does with what the test expects.

## Deciding what it means

| The result shows                                                                                                             | Usually means                                                                 | Do                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A check failed: `FIELD_VALUE_MISMATCH`, `RECORD_COUNT_MISMATCH`                                                              | The org behaves differently than the test expects                             | Find out which is right before changing either                   |
| An expected error did not occur: `EXCEPTION_NOT_FOUND`, `EXCEPTION_TYPE_NOT_FOUND`, `EXCEPTION_STATUS_CODE_NOT_FOUND`        | The rule did not fire, or fired differently                                   | As above                                                         |
| A save was refused: `REQUIRED_FIELD_MISSING`, `FIELD_CUSTOM_VALIDATION_EXCEPTION`, `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` | The test's data does not satisfy the org's rules                              | Fix the data, unless refusal was the point                       |
| Something is missing: `OBJECT_NOT_FOUND`, `FIELD_NOT_FOUND`                                                                  | The org lacks what the test names, or the user cannot see it                  | Check the org and the persona's access                           |
| A persona or template is not available: `PERSONA_NOT_FOUND`, `DATA_TEMPLATE_NOT_FOUND`                                       | It has no active version, or its active version failed to deploy              | Activate it, or correct the failed version and activate it again |
| A persona problem: `PERSONA_PROFILE_NOT_FOUND`, `PERSONA_PERMISSION_SET_NOT_FOUND` and the like                              | A name the org does not have                                                  | Correct the name in the persona                                  |
| A reference problem: `INVALID_CROSS_REFERENCE_KEY`, `INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY`                          | A lookup points at a record that was not created, or that the user cannot see | Look at the step or template that should have created it         |

**Never change a test only to make it pass.** A test states what the org should do. When a check fails,
the org may be wrong; establish which before editing the test, and ask the person who owns the
behaviour when it is not clear.

## Judging a passing test

A pass is only worth something if the test could have failed.

- **It checks what the behaviour produces**, not a value the test itself just wrote.
- **An error check names its error.** One with no exception type and status code passes on any error,
  including the wrong one.
- **A test built to show a refusal must fail when the rule is switched off.** Where you can, switch
  the rule off in a sandbox, run the test, and see it fail on its check.

---

## What Testbench cannot see

These are platform limits, not test mistakes:

- **Criteria-based sharing rules never apply** to records a test creates; they are recalculated outside
  the test. Ownership rules, roles, organisation-wide defaults, manual shares and groups do apply.
- **Existing records are invisible.** A test sees only the records it and its templates create, apart
  from setup data such as users, profiles, record types and custom metadata.
- **A profile is matched by its name**, so a renamed or translated profile name is not found.
- **A very long result is shortened** to fit: the stack trace goes first, then detail inside personas
  and templates, then the newest steps. The result says how much was left out; fix the first problems
  and run again.

---

## References

| File                          | Read it for                                    |
| ----------------------------- | ---------------------------------------------- |
| `references/script.md`        | The script's `results`, `show` and `list`      |
| `references/status-codes.md`  | Every status code and the sentence it produces |
| `references/result-format.md` | The stored result, for reading it directly     |
