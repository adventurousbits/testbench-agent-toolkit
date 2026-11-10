---
description: Write a Testbench test, persona or data template you describe, then load it into the org and run or validate it
argument-hint: <what to write: a test for a behaviour, a persona or a data template, in your own words> [in category <name>] [in <org alias>]
---

Write Testbench content for this: $ARGUMENTS

Decide what is asked for. A behaviour to check is a feature test: use the
`testbench-feature-test-generate` skill, with `testbench-persona-generate` and
`testbench-data-template-generate` for any persona or data template it needs and the org does not
hold yet. A user role to work as is a persona: use `testbench-persona-generate`. Records to prepare is
a data template: use `testbench-data-template-generate`. If it is unclear which, ask.

Work in the org named above or, if none is named, the Salesforce CLI's default org. Start by seeing
what it holds, and put each item in its category as the skills describe: the category named above,
otherwise an existing one it fits, otherwise ask, proposing a name. Write each file where the skills
say: in the project's `testbench/` folder when the project has one, otherwise in a temporary folder.
Check every file until it holds no error.

Then load it and try it: run a feature test and explain its result; validate a persona or data
template and explain its verdict. Report in plain words what was written, in which category, and
whether it passed or is valid, and if not, why.
