---
description: Run Testbench tests in an org and explain their results
argument-hint: [test name, "category <name>", "all", or a file] [in <org alias>]
---

Run Testbench tests: $ARGUMENTS

Use the `testbench-run` skill. Run the tests named above as the org holds them, or every test of the
category named, or every test in the org for "all", in the org named or the Salesforce CLI's default
org. A file is loaded into the org first, then run. Before running many tests, say how many and wait
for the developer's yes. Wait for the new results, then explain each: what passed, what failed, and
why, using `testbench-run-result-verify` to find the cause of a failure.

If nothing is named, start nothing: list the org's categories with how many tests each holds, and ask
which to run, or all.
