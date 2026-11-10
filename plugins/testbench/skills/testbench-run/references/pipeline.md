# Running Testbench tests in a pipeline

A pipeline runs the Testbench tests in its org, waits for them, and fails the build when one does
not pass. It uses the toolkit's script, copied into the project, so it needs Node 20 or later and the
Salesforce CLI, which most Salesforce pipelines already have, and nothing else.

The pipeline must already be signed in to the org, for example with `sf org login jwt`, as a user
holding the Testbench permission set. That is the pipeline's own setup, not Testbench's.

## Setting it up

1. **Copy the script into the project**, with the schema and data it reads beside it, from the
   folder of this skill:

   ```bash
   mkdir -p .testbench
   cp -RL <skill-directory>/scripts <skill-directory>/schema <skill-directory>/data .testbench/
   ```

   `-L` copies what the skill's links point at. Commit `.testbench/`: the pipeline runs that copy,
   not the plugin, so the build does not depend on anyone's assistant. Copy it again when the
   toolkit is updated.

2. **Add one step, after the one that signs in:**

   ```bash
   node .testbench/scripts/testbench.mjs run --all --target-org <alias> --junit testbench-results.xml
   ```

   It runs every test in the org that has an active version, and waits for a new result of each. It
   exits with 1 when a test did not pass or could not run, so the build fails.

## What to choose

- **What runs:** every test with an active version, or one category's with
  `--category "<category name>"`, as the org holds them. The org is where the tests live.
- **Loading the repository's copies first**, for a team that keeps its tests in the project: name the
  folder instead, `run testbench`. Each copy is loaded the way the Testbench app's import does it,
  and its version becomes the active one; the version it replaces stays in the org, inactive. A copy
  whose steps changed while it kept its version's GUID is refused, and the build fails saying so.
- **The JUnit report**, `testbench-results.xml`, holds a test case per test: a failure explained step
  by step in the Testbench editor's words, and a test that could not run as an error. When loading
  the copies was refused, nothing runs and there is no report; the log says why.
- **How long it waits:** up to 30 minutes, or the minutes given with `--wait`.
- **Production:** the script refuses to write there without `--allow-production`, and a run writes:
  it flags each test. Add it only when the team has decided that the pipeline may run tests in their
  live org.

## Limits worth knowing

- **It is not a run of its own.** A run someone else starts at the same time touches the same tests,
  and the script cannot tell their results from its own.
- **It uses the org's daily allowance of Apex test runs.** A large suite run on every commit can use
  it up; run it where it matters, such as before a release.

## In a pipeline

GitHub Actions, after the step that signs in. GitHub has no built-in view of a JUnit report: a test
report action of the team's choice shows it, and the build fails on a failing test either way.

```yaml
- name: Run Testbench tests
  run: node .testbench/scripts/testbench.mjs run --all --target-org ci_org --junit testbench-results.xml
```

GitLab CI shows the report on the merge request:

```yaml
testbench:
  script:
    - node .testbench/scripts/testbench.mjs run --all --target-org ci_org --junit testbench-results.xml
  artifacts:
    when: always
    reports:
      junit: testbench-results.xml
```

Azure Pipelines shows it under Tests:

```yaml
- script: node .testbench/scripts/testbench.mjs run --all --target-org ci_org --junit testbench-results.xml
  displayName: Run Testbench tests
- task: PublishTestResults@2
  condition: always()
  inputs:
    testResultsFormat: JUnit
    testResultsFiles: testbench-results.xml
```
