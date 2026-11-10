---
description: Explain the latest Testbench test results and persona and data template verdicts
argument-hint: [test, persona or template name, "category <name>", or "all"] [in <org alias>]
---

Explain the latest Testbench results: $ARGUMENTS

Use the `testbench-run-result-verify` skill. Read the newest result of the feature tests named above,
and the latest verdict of the personas and data templates named, or of everything in the category
named, or in the org for "all", in the org named or the Salesforce CLI's default org. Say what passed
and what failed, and which are valid and which are not. For each failure, say which step, why, and
what to change. Start nothing new.

If nothing is named, start nothing: list the org's categories with how many tests, personas and
templates each holds, and ask which to use, or all.
