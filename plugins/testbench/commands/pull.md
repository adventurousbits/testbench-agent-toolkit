---
description: Save Testbench tests, personas and data templates from an org into the project
argument-hint: [category, test, persona or template name, or file, default everything in testbench/] [from <org alias>]
---

Save Testbench tests into the project: $ARGUMENTS

Use the `testbench-org-sync` skill. Save the category, feature test, persona or data template named
above, or everything the project's `testbench/` folder already holds, from the org named or the
Salesforce CLI's default org, into the `testbench/` folder: one file per test, persona or template,
in a folder per category, each holding the active version. A saved feature test brings the personas
and data templates it uses into files of their own. If the project has no `testbench/` folder, ask
before starting one. Then show what changed compared with the files as they were.
