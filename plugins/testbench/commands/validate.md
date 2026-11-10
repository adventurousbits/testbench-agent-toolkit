---
description: Validate Testbench personas and data templates in an org and explain their verdicts
argument-hint: [persona or template name, "category <name>", "all", or a file] [in <org alias>]
---

Validate Testbench personas and data templates: $ARGUMENTS

Use the `testbench-run` skill. Validate the personas or templates named above as the org holds them,
or every one of the category named, or every one in the org for "all", in the org named or the
Salesforce CLI's default org. A file is loaded into the org first, then validated. Wait for the new
verdicts, then say which are valid, and explain each invalid one with `testbench-run-result-verify`:
what was refused, and what to change.

If nothing is named, start nothing: list the org's categories with how many personas and templates
each holds, and ask which to validate, or all.
