---
description: Load Testbench tests, personas and data templates from the project into an org, as the app's import does
argument-hint: [file or folder, default testbench/] [to <org alias>]
---

Load Testbench files into an org: $ARGUMENTS

Use the `testbench-org-sync` skill. Load the file or folder named above, or the project's whole
`testbench/` folder if none is named, into the org named, or the Salesforce CLI's default org. Each
file's version becomes the active one, as the Testbench app's import makes it. In an org other people
work in, show first which tests, personas and templates would get another active version, and load
only once the developer agrees. Report what was loaded, which version each replaced, and the
validation of every persona and template whose definition changed.
