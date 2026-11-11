---
name: testbench-feature-test-generate
description: "Use to write Testbench feature tests for a Salesforce org: no-code regression tests that check how the org behaves, built from Arrange, Act and Assert steps. Triggers when a user asks to write, add, extend or change a Testbench test, to cover a business rule, flow, validation rule or permission with a Testbench test, or to turn a described scenario into one. Writes the test in Testbench's own file format, checks it with the toolkit's script against the schema, the editor's rules and the org, then loads it into the org and runs it. Do NOT trigger for Apex test classes (use platform-apex-test-generate), for personas (use testbench-persona-generate) or data templates (use testbench-data-template-generate), or for running tests that exist (use testbench-run)."
license: Apache-2.0
metadata:
  version: "1.0.1"
  domains: ["Testing"]
  relatedSkills:
    - "testbench-persona-generate"
    - "testbench-data-template-generate"
    - "testbench-run"
    - "testbench-org-sync"
    - "testbench-run-result-verify"
  cliTools:
    - tool: ["node"]
      semver: ">=20.0.0"
    - tool: ["sf"]
      semver: ">=2.0.0"
---

# Writing Testbench Feature Tests

Write a Testbench feature test, check it until it holds no error, load it into the org and run it.
The org is where tests live; the file is how one is written and checked before it gets there.

## Scope

- **In scope:** feature test categories, feature tests and their versions; the steps of a version; the
  file that holds them; trying the test in the org.
- **Out of scope:** personas (`testbench-persona-generate`), data templates
  (`testbench-data-template-generate`), running tests that exist (`testbench-run`), keeping copies in
  the project (`testbench-org-sync`), reading results in depth (`testbench-run-result-verify`), and
  Apex test classes. A Testbench test is made of steps alone; never write code for it.

---

## What a feature test is

A **feature test** checks one behaviour of the org. It belongs to a **category** and holds one or more
**versions**; the **active** version is the one that runs. A version holds three lists of **steps**,
run in this order:

| Section     | Holds                         | Steps allowed                                       |
| ----------- | ----------------------------- | --------------------------------------------------- |
| **Arrange** | Prepares the situation        | Select Persona, Use Data Template, Prepare Record   |
| **Act**     | Does the one thing under test | Select Persona, Find, Create, Update, Delete Record |
| **Assert**  | Checks the outcome            | Select Persona, Find Record, Verify Outcome         |

A **persona** is a user created for the run; a **Select Persona** step runs every following step as
that persona, across sections, until the next one. A **data template** is a set of related records; a
**Use Data Template** step creates them at that point. Each is written with its own skill:
`testbench-persona-generate` and `testbench-data-template-generate`.

---

## The allow-list

**The schema is the only authority on what a file may hold.** Every key, step type and fixed value is
listed in `schema/v1/`; anything it does not list is invalid. There is no list of forbidden things,
and none is needed. Read the step types' schema files in `schema/v1/nodes/` before writing a step,
and `references/steps.md` for what each one does.

After every change, check the file with the script's `check` (`references/script.md`) until it holds
**no error**: its shape against the schema, its order and references, and, against the org, its
objects, fields and field types, and that every persona and template it names exists there.

---

## Workflow

1. **Understand the behaviour.** One test checks one behaviour. Name it as a sentence about the
   business: _"<subject> should <behaviour>"_, at most 80 characters, such as "An opportunity
   without a close date should be refused".
2. **See what the org holds** with the script's `list`: its categories, with their tests, personas and
   templates (`references/script.md`).
3. **Choose its category** (`references/project-files.md`): the one the developer names, otherwise an
   existing one it fits, otherwise ask, proposing a name.
4. **Look at the org.** For each object the test touches, `sf sobject describe --sobject <Object>
--target-org <alias>` gives field API names and types. Store each field's type as the describe
   names it, in upper case (`int` is `INTEGER`).
5. **Decide the data.** Prefer a data template for a situation several tests share; use Prepare
   Record steps for what only this test needs. Use a persona whenever the behaviour depends on who
   does it. Use a persona or template the org already has: `show <GUID> --target-org <alias>` shows
   what one holds. Write a new one with its own skill only when none fits.
6. **Get GUIDs** from the script's `guid` (`references/guids.md`) for every record and every step.
   Never invent one; never copy one from another org.
7. **Write the file.** Start from `assets/examples/opportunity-tests.json`, which shows every kind in
   one file. The test's file holds its category, the test and its version. Write it into the
   project's `testbench/` folder when the project has one, in its category's folder; otherwise into
   a new temporary folder (`mktemp -d`), outside the project.
8. **Check** the file with the script until it holds no error: offline while writing, then with
   `--target-org` against the org it is headed for.
9. **Try it:** `run <file> --target-org <alias>` loads it into the org, as the app's import does, and
   runs it. Report the result in the editor's words; for a failure, find the cause with
   `testbench-run-result-verify` before changing anything.

**Changing a test the org holds** starts from its active version, never from an older copy:

1. **Save it to change it:** `pull <test GUID>` saves its active version with what it uses, into the
   project's `testbench/` folder when the project keeps copies; otherwise add
   `--output-dir <new temporary folder>` (`mktemp -d`), so the project gains no folder it did not
   ask for.
2. **Change the steps, and give the version a new GUID** (`guid V`). A version's steps never change
   once it has been active, so changed steps are a new version of the same test. Keep the test's and
   the category's GUIDs.
3. **Check and try it** as above. Loading makes the new version the active one; the old one stays in
   the org.

---

## Rules for an allowed test

The script's `check` checks most rules below; the reasons are here so the test is right the first
time.

1. **Arrange prepares, Act does the one thing under test, Assert checks.** Put the persona and the
   data in Arrange, so Act holds only the action the test is about.
2. **A step refers only to what exists when it runs:** a record a step **above** it created or found,
   by that step's `guid`; or a record of a template a step above it loaded, as
   `<templateGuid>:<nodeGuid>`. A Global template's records exist from the start.
3. **A lookup holds a reference, never a record Id.** An Id exists in one org only. The allowed forms
   are in `references/field-values.md`.
4. **Every value is text in the format its type requires:** dates `YYYY-MM-DD`, booleans `true` or
   `false`, numbers as digits. A multi-select picklist takes a list of values.
5. **A record type, profile, role or permission set is named, never given by Id**, and stored as
   `PICKLIST`.
6. **Every Verify Outcome has a description** of one sentence, starting "Proves", saying what it
   proves for the business.
7. **An error check names its error:** exception type `System.DmlException` and the status code
   expected, such as `FIELD_CUSTOM_VALIDATION_EXCEPTION`. Without them it passes on any error,
   including the wrong one.
8. **A test that can never fail proves nothing.** Check the value the business rule produces, not a
   value the test itself just wrote.
9. **Changed steps are a new version, with a new GUID.** Loading it makes it the active version, and
   the version it replaces stays in the org.
10. **A fixed date ages.** A date the org compares with today, such as a close date a rule requires
    to lie in the future, makes the test fail once that day has passed. Choose one well ahead, and
    say so in the version's description.

---

## Platform events

A test can publish a platform event with a Create Record step on the event, and then verify what the
flows subscribed to it did. Verify that effect, never only that the event was published. When such a
flow fails, the test is not told why: what the flow should have done is missing, so the check on it
fails, for example with a record not found. Look at the flow when that happens.

---

## What a test cannot check

A test proves things by finding records and comparing their values, so it can only check what the
behaviour leaves behind as a record it can see. Before writing a test, make sure the behaviour does;
when it does not, say so and propose what can be checked instead, rather than writing a test that can
never pass.

- **A bell notification or a sent email** leaves no record a test can find. Check a record the same
  automation creates, such as a task for the user, or test the sending outside Testbench.
- **Records that existed before the run** are invisible, apart from setup data such as users,
  profiles, record types and custom metadata. A test creates what it needs, with steps or a data
  template.
- **Criteria-based sharing rules** never apply to records a test creates; they are recalculated
  outside the test.
- **A flow's scheduled path** runs later, outside the test, so what it does is not there to check.

---

## Labels

The step labels are what a person reads in the Testbench editor and in a failing result.

- Arrange and Act labels start with a verb and an indefinite article: "Work as a sales representative",
  "Prepare a business account", "Open an opportunity for the customer".
- Verify labels start "Verify that …": "Verify that the opportunity is open at Prospecting".
- A Use Data Template step is labelled "Load <template name> template".

---

## References

| File                                     | Read it for                                                     |
| ---------------------------------------- | --------------------------------------------------------------- |
| `references/steps.md`                    | Every step type: what it does, its keys, an example             |
| `references/field-values.md`             | Field entries, types, value formats, references and operators   |
| `references/file-format.md`              | The file: records, versions, and importing through the app      |
| `references/script.md`                   | The script: checking, listing, loading and running              |
| `references/guids.md`                    | Making GUIDs                                                    |
| `references/project-files.md`            | Copies in the project, and choosing a category                  |
| `assets/examples/opportunity-tests.json` | A complete, valid file with a persona, a template and two tests |
| `schema/v1/`                             | The allow-list itself                                           |
