# The Testbench file

A Testbench file is the export file Testbench itself produces and imports. One file can hold feature
tests, personas and data templates together.

```json
{
  "version": 1,
  "data": {
    "testPersonaCategories": [],
    "testPersonas": [],
    "testPersonaVersions": [],
    "dataTemplateCategories": [],
    "dataTemplates": [],
    "dataTemplateVersions": [],
    "featureTestCategories": [],
    "featureTests": [],
    "featureTestVersions": []
  }
}
```

Leave out any list you do not need. An exported file also carries `exportedAt`, `scope` and
`includeDependencies`; they are informational.

## Records

Every record has a `GUID__c` and a `Name` of at most 80 characters, and names its parent by the
parent's GUID, never by an Id:

| List                    | Parent field               | Other keys                                                                                                                 |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `featureTestCategories` |                            | `Description__c`                                                                                                           |
| `featureTests`          | `Feature_Test_Category__c` |                                                                                                                            |
| `featureTestVersions`   | `Feature_Test__c`          | `Editor_Version__c`, `Description__c`, `Arrange_Definition_Data__c`, `Act_Definition_Data__c`, `Assert_Definition_Data__c` |

Personas are described in `testbench-persona-generate`, data templates in
`testbench-data-template-generate`.

`Assert_Definition_Data__c` holds the Assert section.

## GUIDs

Every record and every step has a GUID: a prefix naming its kind and 32 lowercase hexadecimal
characters. `guids.md` lists the prefixes and how to make one.

## Versions

- A test, persona or template runs its **active** version. Activating a version deactivates the others.
- A version that has been active is **locked**: its steps cannot change. Changed steps are a new
  version with a new GUID under the same parent; loading it makes it the active one.
- Two versions of the same parent in one file are allowed; loading makes the last one active.
- **Every version states the editor version its steps are written for**, `"Editor_Version__c": 1` in
  a file of schema v1. Keep the value a saved version has. Left out, the org would record its own
  current one, and a later Testbench could read the steps as something they are not.

## Steps as JSON or as JSON text

Testbench stores each section's steps as **JSON text** inside the field. In a file you write, give them
as a JSON array: it is easier to read and review, and it is checked the same way. The script sends
them as text when it loads the file.

Testbench's own **Import** in the app reads only JSON text. To import a file through the app instead of
loading it with the script, write each of those fields as a string holding the JSON.

## Order

Loading writes parents before children: personas, then data templates, then feature tests. Within a
file, order does not matter.
