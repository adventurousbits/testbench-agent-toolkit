# Testbench file schema

This folder is the allow-list for a Testbench file. It describes every key a file may hold and every
value a fixed choice may take. Anything it does not describe is invalid, so no list of forbidden
things exists or is needed.

The schema describes what Testbench itself accepts and honours, taken from the package's editors,
transpiler and run time. When a package change alters what a step may hold, the schema changes in the
same commit.

## Files

| File                            | Describes                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `v1/testbench-file.schema.json` | The envelope: the export file Testbench produces and imports, and the order a push writes it in |
| `v1/common.schema.json`         | Identifiers, names, field types, field entries, value formats and operators                     |
| `v1/feature-test.schema.json`   | Feature test categories, tests and versions, and which steps each section allows                |
| `v1/persona.schema.json`        | Persona categories, personas and versions                                                       |
| `v1/data-template.schema.json`  | Data template categories, templates and versions                                                |
| `v1/nodes/*.schema.json`        | One file per step type, and one per Verify Outcome kind                                         |

## Versions

`v1` matches envelope `"version": 1`. **Adding something is not a new version**: a new step type, a
new optional key or a new enum value stays in `v1`, because every file that was valid stays valid. Only
a change that makes a valid file invalid, or changes what a valid file means, gets a `v2` folder beside
`v1`, together with a new envelope version.

## The `x-testbench` annotations

JSON Schema describes shapes. What a step _does_, such as whether later steps may refer to it, whether it
can fail and which of its keys point at something else, is declared beside the shape, under `x-testbench`,
and the toolkit's script reads it from there when it checks a file. So a new step type needs a schema
file, and, where it brings a new kind of rule, a rule in the script (`scripts/lib/rules.mjs`) with a
test that fails without it.

**On a step file** (`nodes/*.schema.json`):

| Key                         | Meaning                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `nodeType`                  | The step's `type` value                                                                                              |
| `editorName`                | What the Testbench editor calls the step                                                                             |
| `producesRecord`            | Later steps may refer to the record this step creates or finds, by this step's `guid`                                |
| `failable`                  | A Verify Outcome of kind error-occurred may name this step                                                           |
| `recordReferenceKeys`       | `details` keys holding a record reference, which must name a record available at this point                          |
| `failableReferenceKeys`     | `details` keys holding the `guid` of an earlier failable step                                                        |
| `sameObjectAsReference`     | `objectApiName` must be the object of the record the reference names                                                 |
| `loadsTemplateKey`          | The `details` key naming a data template this step loads                                                             |
| `personaKey`                | The `details` key naming a persona                                                                                   |
| `objectKey`, `objectAccess` | The `details` key naming an object, and the access the org must grant on it                                          |
| `entryLists`                | `details` keys holding field entries: their `kind` (`value`, `comparison`) and the field `access` the org must grant |
| `subtypeKey`                | The `details` key that chooses among sub-kinds, each in its own file with its own annotations                        |
| `recommendsDescription`     | The step should carry a `description`; a missing one is a warning                                                    |

**On a sub-kind file** (`nodes/assert-*.schema.json`): the same keys, plus `assertType`, the value it
stands for.

**On `common.schema.json`:** `valueFormats` (the text each dataType requires),
`listValueDataTypes`, `referenceDataTypes`, `specialReferenceValues`, `principalFields`,
`operatorsByDataType` and `describeTypes`.

**On `feature-test.schema.json`:** `sections`, the sections in the order they run.

**On `testbench-file.schema.json`:** `pushOrder`, the order records are written in, parents first,
which is the order Testbench's own import uses.

## Adding a step type

1. Write `v1/nodes/<name>.schema.json`. Give it exactly the base properties every step has: `guid`,
   `type` (a `const`), `label`, `description`, `labelAutoUpdate`, `labelAutoUpdateTemplate` and
   `details`, with `additionalProperties: false`. Declare its behaviour under `x-testbench`.
2. Add it to the section lists in `v1/feature-test.schema.json` where the editor offers it, and to
   `templateNodes` in `v1/data-template.schema.json` if the template editor does.
3. Add an example to the skill that writes such steps, and run the tests. They check every step file
   has the base properties and is reachable from a section.

## Adding a key or a value

Add it where it belongs, as an optional property or an extra `enum` value. A push sends every key a
record holds, so a new field on a Testbench object needs no other change.
