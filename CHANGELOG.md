# Changelog

## 1.0.0 (10 November 2026)

The first version.

- Six skills: writing feature tests, writing personas, writing data templates, running and
  validating them, saving and loading copies, and explaining results. Each kind of Testbench record
  has a skill of its own.
- Tests, personas and data templates live in the org, as they do in the Testbench app. The assistant
  writes one, checks it, loads it into the org and tries it; a project keeps copies only when its team
  wants them, one file each in a `testbench/` folder with a folder per category.
- A script, `testbench.mjs`, does the exacting work the same way every time: it lists what an org
  holds, makes GUIDs, checks files, loads them, runs tests, validates personas and templates, explains
  results in the editor's words, saves copies, deletes after the developer's yes, and shows a test in
  plain words. It needs Node 20 or later and nothing else, and reaches an org only through the
  Salesforce CLI.
- A schema that lists everything a Testbench file may hold, and checks for the rules a schema cannot
  express, including against the org's objects, fields and types.
- Loading works like the app's import, by GUID: the file's version becomes the active one, and the
  version it replaces stays in the org. Saving takes the org's active version.
- Global templates are in Global Templates, a category whose GUID is the same in every org; loading
  one creates it when the org lacks it and never changes it. Loading, changing or deleting a Global
  template needs the Testbench - Manage Global Templates permission set, and the script says so
  before writing anything.
- Claude Code commands: `/testbench:write`, `run`, `validate`, `results`, `pull`, `push` and
  `pipeline`, each working on tests, personas and data templates where it applies.
- A pipeline step that runs the tests in its org, fails the build when one fails, and writes a JUnit
  report.
- Writing to a production org, and deleting anything, only after the developer confirms.
- Requires Testbench 1.6.0 or later, the release that introduces it. Among other things, 1.6.0 applies
  the operator of a Find Record filter, which earlier versions read as equals.
