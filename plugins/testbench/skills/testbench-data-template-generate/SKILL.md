---
name: testbench-data-template-generate
description: "Use to write Testbench data templates: sets of related records created together, such as a customer with contacts or an open deal with its products, that tests start from, and Global templates for baseline data every run needs. Triggers when a user asks for test data, a data template, a starting situation several tests share, or data the org's automation needs to exist. Writes data template records in Testbench's own file format, checks them with the toolkit's script against the schema, the editor's rules and the org, then loads the template into the org and validates it. Do NOT trigger for personas (use testbench-persona-generate), feature test steps (use testbench-feature-test-generate) or running anything that exists (use testbench-run)."
license: Apache-2.0
metadata:
  version: "1.0.1"
  domains: ["Testing"]
  relatedSkills:
    - "testbench-feature-test-generate"
    - "testbench-persona-generate"
    - "testbench-run"
    - "testbench-org-sync"
  cliTools:
    - tool: ["node"]
      semver: ">=20.0.0"
    - tool: ["sf"]
      semver: ">=2.0.0"
---

# Writing Testbench Data Templates

Write a data template, check it until it holds no error, load it into the org and validate it. The
org is where templates live; the file is how one is written and checked before it gets there.

## Scope

- **In scope:** data template categories, data templates and their versions, and validating them in
  the org.
- **Out of scope:** personas (`testbench-persona-generate`), feature tests
  (`testbench-feature-test-generate`), running what exists (`testbench-run`), and keeping copies in
  the project (`testbench-org-sync`).

---

## What a data template is

A data template is a **set of related records**, created together: a customer account with its
contacts, an open deal with its products. It stands on its own. A feature test loads it with a Use
Data Template step; a persona or another template can point at one of its records, which creates it
too. A template is also validated on its own, in a dry run outside any test. Testbench creates its
records with what they depend on, the Global templates first as every run does, then any persona or
template a record points at, and reports every problem before anything depends on it. A problem in
one of those fails the validation too.

| Type        | Created                                                   | Use it for                                    |
| ----------- | --------------------------------------------------------- | --------------------------------------------- |
| **Regular** | Where a step loads it, or a record elsewhere points at it | A situation several tests start from          |
| **Global**  | At the start of every test run and every validation       | Data the org's automation cannot work without |

Write a Global template only when automation needs the data to exist, and keep it small: a Global
template that fails, fails every test and every validation in the org. A Global template's category
is always Global Templates, and writing one needs the Testbench - Manage Global Templates permission
set (`references/data-templates.md`). Before writing a template, look for one the org already has:
the script's `list` shows them.

---

## The allow-list

The schema in `schema/v1/data-template.schema.json` lists everything a template may hold; anything
else is invalid. After every change, check the file with the script's `check`
(`references/script.md`), including every object, field and field type against the org, until it
holds **no error**.

---

## Workflow

1. **Decide the situation** the records describe, and name the template for its role, such as "Open
   deal with products", not for its sample content.
2. **Choose its category** (`references/project-files.md`), such as _Customer accounts_: the one
   the developer names, otherwise an existing one in the org it fits (`list`), otherwise ask. A
   Global template's is Global Templates.
3. **Look at the org:** `sf sobject describe --sobject <Object> --target-org <alias>` for each object.
4. **Get GUIDs** for the category, the template, its version and each record (a node) from the
   script's `guid` (`references/guids.md`).
5. **Write the records**, following `references/data-templates.md` and `references/field-values.md`.
   `assets/examples/opportunity-tests.json` holds a complete one, beside other kinds; the template's
   own file holds only its category, the template and its version. Write it into the project's
   `testbench/` folder when the project has one, in its category's folder; otherwise into a new
   temporary folder (`mktemp -d`).
6. **Check** the file with the script until it holds no error, offline and then with `--target-org`.
7. **Validate it:** `validate <file> --target-org <alias>` loads it into the org, as the app's import
   does, and validates it. Explain an `Invalid` verdict, and fix it.

**Changing a template the org holds** starts from its active version: save it with `pull <template
GUID>`, adding `--output-dir <new temporary folder>` when the project keeps no copies; change it,
give the version a new GUID (`guid V`), then check and validate it. A version's records never
change once it has been active, so a changed one is a new version; keep the template's and
category's GUIDs.

---

## Rules for an allowed template

1. **Each record is a Create Record step**, and refers only to a record **above** it in the same
   template, by that record's `guid`.
2. **A lookup holds a reference, never a record Id**: a record above, another template's record, a
   persona's GUID or `StandardPricebookId`.
3. **Every value is text in the format its type requires**, and each field's type is stored as the
   org's describe names it.
4. **Every field a record sets must be visible and creatable** for whoever loads the template: the
   records are created as that user, with that user's access.
5. **A fixed date ages.** A date the org compares with today stops being valid once that day has
   passed. Choose one well ahead.
6. **The data is fictional**: invented names, and addresses on `.example` domains.

---

## References

| File                                     | Read it for                                                |
| ---------------------------------------- | ---------------------------------------------------------- |
| `references/data-templates.md`           | A template's records, references, and how they are created |
| `references/field-values.md`             | Field entries, types, value formats and references         |
| `references/script.md`                   | The script: checking, listing, loading and validating      |
| `references/guids.md`                    | Making GUIDs                                               |
| `references/project-files.md`            | Copies in the project, and choosing a category             |
| `assets/examples/opportunity-tests.json` | A complete, valid file holding a template                  |
| `schema/v1/data-template.schema.json`    | The allow-list itself                                      |
