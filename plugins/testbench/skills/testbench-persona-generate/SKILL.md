---
name: testbench-persona-generate
description: "Use to write Testbench personas: users Testbench creates for a run, with the profile, role, permission sets, groups and user fields a kind of user holds in the org. Triggers when a user asks for a persona, a role or kind of user to test as, or to check what a particular user can or cannot do. Writes persona records in Testbench's own file format, checks them with the toolkit's script against the schema, the editor's rules and the org, then loads the persona into the org and validates it. Do NOT trigger for data templates (use testbench-data-template-generate), feature test steps (use testbench-feature-test-generate) or running anything that exists (use testbench-run)."
license: Apache-2.0
metadata:
  version: "1.0.0"
  domains: ["Testing"]
  relatedSkills:
    - "testbench-feature-test-generate"
    - "testbench-data-template-generate"
    - "testbench-run"
    - "testbench-org-sync"
  cliTools:
    - tool: ["node"]
      semver: ">=20.0.0"
    - tool: ["sf"]
      semver: ">=2.0.0"
---

# Writing Testbench Personas

Write a persona, check it until it holds no error, load it into the org and validate it. The org is
where personas live; the file is how one is written and checked before it gets there.

## Scope

- **In scope:** persona categories, personas and their versions, and validating them in the org.
- **Out of scope:** data templates (`testbench-data-template-generate`), feature tests
  (`testbench-feature-test-generate`), running what exists (`testbench-run`), and keeping copies in
  the project (`testbench-org-sync`).

---

## What a persona is

A persona is a **kind of user** in the org, such as a sales representative or a support agent:
the profile, role, permission sets, groups and user fields that kind of user holds. Testbench creates
the user when a run needs it, and the user exists only inside that run.

A persona stands on its own. A feature test runs steps as it with a Select Persona step; a data
template can make it the owner of a record; another persona can name it as a manager. A persona is
also validated on its own, in a dry run outside any test. Testbench creates it with what it depends
on, the Global templates first as every run does, then any template or persona it points at, and
reports every problem before anything depends on it. A problem in one of those fails the validation
too.

Write a persona when **who** does something decides the outcome: what a role may see, change or
approve. Before writing one, look for one the org already has: the script's `list` shows them.

---

## The allow-list

The schema in `schema/v1/persona.schema.json` lists everything a persona may hold; anything else is
invalid. After every change, check the file with the script's `check` (`references/script.md`),
including its user fields against the org, until it holds **no error**.

---

## Workflow

1. **Find out what the kind of user holds in the org:** its profile, role, permission sets,
   permission set groups, licences, public groups and queues. Write them down by name.
2. **Choose its category** (`references/project-files.md`), such as _Sales roles_: the one the
   developer names, otherwise an existing one in the org it fits (`list`), otherwise ask.
3. **Get GUIDs** for the category, the persona and its version from the script's `guid`
   (`references/guids.md`).
4. **Write the records**, following `references/personas.md`. `assets/examples/opportunity-tests.json`
   holds a complete one, beside other kinds; the persona's own file holds only its category, the
   persona and its version. Write it into the project's `testbench/` folder when the project has
   one, in its category's folder; otherwise into a new temporary folder (`mktemp -d`).
5. **Check** the file with the script until it holds no error, offline and then with `--target-org`.
6. **Validate it:** `validate <file> --target-org <alias>` loads it into the org, as the app's import
   does, and validates it. Explain an `Invalid` verdict, and fix it.

**Changing a persona the org holds** starts from its active version: save it with `pull <persona
GUID>`, adding `--output-dir <new temporary folder>` when the project keeps no copies; change it,
give the version a new GUID (`guid V`), then check and validate it. A version's settings never
change once it has been active, so a changed one is a new version; keep the persona's and
category's GUIDs.

---

## Rules for an allowed persona

1. **Everything is named, never given by Id**: the profile by name; roles, groups, licences and
   permission set groups by developer name; permission sets by API name. Names travel between orgs;
   Ids do not.
2. **A persona holds every field a user cannot be created without**: `Username`, `LastName`, `Email`,
   `Alias`, `ProfileId`, `TimeZoneSidKey`, `LocaleSidKey`, `EmailEncodingKey` and `LanguageLocaleKey`.
   Nothing is filled in for it.
3. **Every user field value is text**, a checkbox `true` or `false`.
4. **A persona refers to another persona by the persona's GUID** (`P…`), never the version's (`V…`),
   and never to itself.
5. **The data is fictional**: invented names, and addresses on `.example` domains.

---

## References

| File                                     | Read it for                                                   |
| ---------------------------------------- | ------------------------------------------------------------- |
| `references/personas.md`                 | A persona's records, user fields, permissions and memberships |
| `references/script.md`                   | The script: checking, listing, loading and validating         |
| `references/guids.md`                    | Making GUIDs                                                  |
| `references/project-files.md`            | Copies in the project, and choosing a category                |
| `assets/examples/opportunity-tests.json` | A complete, valid file holding a persona                      |
| `schema/v1/persona.schema.json`          | The allow-list itself                                         |
