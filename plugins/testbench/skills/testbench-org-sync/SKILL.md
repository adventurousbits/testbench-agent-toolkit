---
name: testbench-org-sync
description: "Use to move Testbench tests, personas and data templates between a Salesforce org and the project, or to delete them: save what the org holds into the project's files, load files into an org, and delete tests, personas, templates, versions or categories after the developer's yes. Works through the toolkit's script and the Salesforce CLI. Triggers when a user asks to save, keep, back up, export or pull Testbench tests into the project, to load, push, import or copy them into an org, or to delete them. Asks for confirmation before writing to a production org and before deleting anything. Do NOT trigger for writing tests (use testbench-feature-test-generate), running them (use testbench-run) or explaining results (use testbench-run-result-verify)."
license: Apache-2.0
metadata:
  version: "1.0.0"
  domains: ["Testing"]
  relatedSkills:
    - "testbench-run"
    - "testbench-feature-test-generate"
    - "testbench-persona-generate"
    - "testbench-data-template-generate"
  cliTools:
    - tool: ["node"]
      semver: ">=20.0.0"
    - tool: ["sf"]
      semver: ">=2.0.0"
---

# Saving, Loading and Deleting Testbench Tests

The org is where Testbench tests, personas and data templates live. This skill keeps copies of them in
the project when the developer wants them there, loads copies into an org, and deletes what the
developer asks to delete. The toolkit's script does each (`references/script.md`).

## Scope

- **In scope:** saving into the project, loading into an org, and deleting from it.
- **Out of scope:** writing tests and data (the `-generate` skills), running them (`testbench-run`)
  and explaining results (`testbench-run-result-verify`).

---

## Copies in the project

Tests live in the org. A project keeps copies of them, in its `testbench/` folder, when its team wants
them there (`references/project-files.md`):

- to review them with the metadata they check, in a pull request;
- to outlive the org: a scratch org expires, and a developer sandbox loses its records when it is
  refreshed;
- to load them into another org, such as the one a pipeline runs in.

Not every team keeps copies. A project with no `testbench/` folder keeps none: ask before starting one.

---

## Saving into the project

```bash
node <skill-directory>/scripts/testbench.mjs pull <GUID ...> --target-org <alias>
node <skill-directory>/scripts/testbench.mjs pull --category "<category name>" --target-org <alias>
node <skill-directory>/scripts/testbench.mjs pull --target-org <alias>
```

Find the GUIDs with the script's `list`. Saving takes each item's **active version**, replacing what
its file held, and writes only what changed, so `git diff` shows exactly that. With nothing named, it
saves again everything the project's files hold. A test brings along the personas and templates it
uses that no file holds yet. Show the developer what changed. To save into another folder, such as a
copy to change when the project keeps none, add `--output-dir <folder>`.

---

## Loading into an org

```bash
node <skill-directory>/scripts/testbench.mjs push [file or folder ...] --target-org <alias>
```

Loading works the way the Testbench app's import does, by GUID. A version the org already holds is
never sent again; one it lacks is created; and the file's version becomes the **active** one. The
version it replaces stays in the org, inactive, and the report names it, so nothing is lost: it can
be made active again in the app.

1. **Before loading into an org other people work in**, run with `--dry-run`, and tell the developer
   which tests, personas and templates would get another active version. Load once they agree.
2. **Load.** The script checks the files first and loads nothing while an error remains, then waits
   for the deploy, and validates the personas and templates whose definition changed.
3. **A refused item** holds changed steps under the GUID of a version the org already holds. Changed
   steps are a new version: give the version a new GUID (`guid V`), and load
   it again.

---

## Deleting

The developer may delete a test, a persona, a template, one of their versions, or a whole category, as
they can in the app. Deleting cannot be undone, so it takes two calls:

```bash
node <skill-directory>/scripts/testbench.mjs delete <GUID ...> --target-org <alias>
node <skill-directory>/scripts/testbench.mjs delete <GUID ...> --target-org <alias> --confirm <code>
```

1. **The first call deletes nothing.** It lists what would go, everything that goes with it, what
   still uses a persona or template that goes, what Testbench refuses to delete for now, and the
   project's files that go with the same yes, and it ends with a code for exactly that list.
2. **Show the developer the list, and ask.** Only after their explicit yes to that list, make the
   second call with its code. When the list has changed since, nothing is deleted and the new list is
   shown: ask again.

---

## Rules

1. **Production only after an explicit yes.** Loading and deleting write to the developer's live org
   there. Say so, wait for their confirmation for that org, and only then pass `--allow-production`.
   Saving and a delete's list write nothing to the org.
2. **Delete only what the developer asks for, after their yes to the exact list.** A yes covers that
   list, never the next. A file missing from the project is never a reason to delete.
3. **Ask before replacing active versions in an org others use**, with the dry run's list.
4. **Show what a save changed** in the project, with `git diff`.

---

## References

| File                          | Read it for                                            |
| ----------------------------- | ------------------------------------------------------ |
| `references/script.md`        | Every command of the script: what it does, its options |
| `references/project-files.md` | Where copies live in the project, one file per item    |
| `testbench-run`               | Running what was loaded                                |
