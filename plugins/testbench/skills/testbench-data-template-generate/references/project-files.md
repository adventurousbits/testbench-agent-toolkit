# Testbench files in the project

The org is where Testbench tests, personas and data templates live. A project keeps copies of them
when its team wants them there: to review them with the metadata they check, to outlive a scratch org
or a refreshed sandbox, or to load them into another org. A project with a `testbench/` folder keeps
copies; one without it keeps none, and nothing starts one unless the developer asks.

## Where they live

```
testbench/
  feature-tests/<category>/<test>.json
  personas/<category>/<persona>.json
  data-templates/<category>/<template>.json
```

- **One file per test, persona or template**, in a folder per category. Each is activated, run and
  reported on separately in the org, so the file is the same unit: a pull request shows only the
  items that changed, and two developers adding tests to one category never edit the same file.
- **A folder is named after its category, and a file after its item**, made safe for every file
  system:
  - only the letters `a` to `z` and digits, in lower case. An accented letter loses its accent, so
    `é` becomes `e`;
  - every other run of characters becomes one hyphen, with none at the start or the end.

  So _Access & Permissions_ becomes `access-permissions/`, and _Account Executive (EMEA)_ becomes
  `account-executive-emea.json`.

- **A name that is taken gets a number**: a second category that comes out as `r-d` is `r-d-2`.
  Never put two categories in one folder, or two items in one file.
- **Global Templates is a category like any other**, with a GUID that is the same in every org,
  `CGlobalTemplates`, so its folder is usually `data-templates/global-templates/`. A template moved
  into it in the app becomes Global, and one moved out becomes Regular; saving it moves its file, as
  for any move between categories.
- **A name is made once**, when the folder or file is created. The GUID inside is the identity, so
  renaming a category or an item in the app moves nothing: a folder is found by the category GUID in
  its files, and a file by the item's GUID, never by their names.
- **The folder sits at the project root**, outside every package directory, so `sf project deploy`
  never treats it as metadata. A project may put it elsewhere in `sfdx-project.json`:
  `{ "plugins": { "testbench": { "path": "<folder>" } } }`. The script reads that first; the default
  is `testbench/`.

## What a file holds

**Each file is a complete Testbench file** (`file-format.md` in the test-writing skill), so it is
checked against the schema on its own, and loading it creates its category in an org without it. It
holds three lists of its kind:

| Kind          | Lists                                                             |
| ------------- | ----------------------------------------------------------------- |
| Feature test  | `featureTestCategories`, `featureTests`, `featureTestVersions`    |
| Persona       | `testPersonaCategories`, `testPersonas`, `testPersonaVersions`    |
| Data template | `dataTemplateCategories`, `dataTemplates`, `dataTemplateVersions` |

- **The category list holds the folder's category**, the same record in every file of the folder:
  the same GUID, name and description.
- **The record list holds the one item**, and the version list its active version.
- **A test names the personas and templates it uses by GUID.** In the project they live in files of
  their own, never copied into the test's file.

## Saving and loading

- **Saving takes the org's active version** (`pull`, in `testbench-org-sync`): it replaces what the
  file held, writes only what changed, and brings along the personas and templates a saved test uses
  that no file holds yet.
- **Loading works like the app's import** (`push`): a version the org holds is never sent again, and
  the file's version becomes the active one, the version it replaces staying in the org. A folder is
  loaded in dependency order: persona files, then data template files, then feature test files; a
  category held by several files is loaded once.
- **A file is a copy.** Changing an item starts from the org's active version: save it, change it,
  give a changed version a new GUID (`guids.md`), and load it.
- **Loading, changing or deleting a Global template needs the Testbench - Manage Global Templates
  permission set**, administrators included. Without it, loading stops before anything is written,
  and a delete lists the Global template as refused. Ask an administrator for the permission set.

## Choosing a category

Every test, persona and template belongs to a category: a business area, such as _Lease approvals_,
_Sales roles_ or _Customer accounts_. A Global template has no choice: its category is always Global
Templates.

1. **A category the developer names**: use it.
2. **Otherwise, an existing category that fits**: the script's `list` shows the org's categories of
   each kind with their descriptions. Use the one whose area the new item belongs to.
3. **Otherwise, ask** which category it belongs to, proposing a name for a new one. A category is a
   lasting grouping that others will read, so do not invent one silently.

A new category gets a GUID and a description of one sentence saying what area it covers. A new item
in an existing category copies the category's record as `list` shows it: its GUID, name and
description.
