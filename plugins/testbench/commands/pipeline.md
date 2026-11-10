---
description: Set up a CI pipeline step that runs Testbench tests and fails the build when one fails
argument-hint: [category name] [for <CI system, such as GitHub Actions>]
---

Set up Testbench tests in a pipeline: $ARGUMENTS

Use the `testbench-run` skill and its pipeline recipe. Copy the script, with its schema
and data, into the project's `.testbench/` folder as the recipe shows, and add a step to the
project's pipeline that runs it after the pipeline signs in to its org: every test in the org, or the
category named above with `--category`. Load the project's copies first only when the team keeps
its tests in the project. Have the step write the JUnit report, and publish the report where the
pipeline system can. If the pipeline system is not named and the project holds none, show the step
for GitHub Actions and say where it goes. Explain what the step does and what it cannot do, as the
recipe lists.
