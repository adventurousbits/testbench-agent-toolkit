# Steps

Every step has the same outer shape. `details` depends on its `type`: the schema file for each type in
`schema/v1/nodes/` lists its keys and is the authority.

```json
{
  "guid": "N<32 hex>",
  "type": "CreateRecord",
  "label": "Open an opportunity for the customer",
  "description": "Optional. Required in spirit on a Verify Outcome: what it proves.",
  "details": {}
}
```

`labelAutoUpdate` and `labelAutoUpdateTemplate` may appear in a file the editor exported; they only
affect how the editor relabels a step, and you never need to write them.

---

## Select Persona: `SetRunAsUser`

Runs every following step as a persona, across sections, until the next Select Persona step.
`null` returns to the test's own user.

```json
"details": { "personaGuid": "P<32 hex>" }
```

- Allowed in Arrange, Act and Assert.
- The persona must be in the file or already active in the org.
- Put it **before** the steps that should run as the persona, including a Use Data Template step whose
  records the persona must own.

## Use Data Template: `UseDataTemplate`

Creates a Regular data template's records at this point, as whoever the step runs as.

```json
"details": { "dataTemplateGuid": "D<32 hex>" }
```

- Allowed in Arrange only.
- Only a **Regular** template. A Global template is created at the start of every run already.
- After it, later steps may use the template's records as `<templateGuid>:<nodeGuid>`, and the records
  of any template those records point at.
- Label it "Load <template name> template".

## Create Record: `CreateRecord`

Creates one record. In Arrange the editor calls it **Prepare Record**.

```json
"details": {
  "objectApiName": "Opportunity",
  "fieldsToCreate": [
    { "apiName": "StageName", "dataType": "PICKLIST", "value": "Prospecting" }
  ]
}
```

- Later steps refer to the record by this step's `guid`.
- A failure is reported against the step and the test goes on, so a later Verify Outcome can check
  that it failed.

## Find Record: `GetRecord`

Finds the first record that matches every filter, each compared with its own operator.

```json
"details": {
  "objectApiName": "Case",
  "fieldsToFilterBy": [
    { "apiName": "Subject", "dataType": "STRING", "value": "Delivery late", "operator": "contains" }
  ]
}
```

- Each entry needs an `operator` its type allows: see `field-values.md`.
- Use it for a record the org created by itself, such as one a flow created. Later steps refer to it by
  this step's `guid`.

## Update Record: `UpdateRecord`

Changes fields on a record a step above created or found, or a template created.

```json
"details": {
  "referredRecordGuid": "N<32 hex> or D<32 hex>:N<32 hex>",
  "objectApiName": "Opportunity",
  "fieldsToUpdate": [
    { "apiName": "StageName", "dataType": "PICKLIST", "value": "Closed Won" }
  ]
}
```

- Allowed in Act. `objectApiName` is the object of the record it changes.
- An update runs update automation. To start from a record already in a later state, create it in that
  state instead, in a template or a Prepare Record step.

## Delete Record: `DeleteRecord`

Deletes a record a step above created or found, or a template created.

```json
"details": { "referredRecordGuid": "N<32 hex>", "objectApiName": "Opportunity" }
```

- Allowed in Act. `objectApiName` is the object of the record it deletes.

## Verify Outcome: `AssertOutcome`

Checks the outcome. `assertType` chooses the kind. Give every one a `description` of one sentence,
starting "Proves", and a label starting "Verify that …".

### Field values: `AssertRecordFieldValues`

```json
"details": {
  "assertType": "AssertRecordFieldValues",
  "referredRecordGuid": "N<32 hex>",
  "objectApiName": "Opportunity",
  "fieldsToAssert": [
    { "apiName": "StageName", "dataType": "PICKLIST", "value": "Prospecting", "operator": "eq" }
  ]
}
```

- Reads the record again after Act, so it sees what automation changed.
- Each entry needs an `operator` its type allows: see `field-values.md`.

### Record count: `AssertRecordCount`

```json
"details": {
  "assertType": "AssertRecordCount",
  "objectApiName": "Task",
  "fieldsToFilterBy": [
    { "apiName": "WhatId", "dataType": "REFERENCE", "value": "N<32 hex>", "operator": "eq" }
  ],
  "expectedRecordCount": "1",
  "expectedRecordCountOperator": "eq"
}
```

- The count is text: `"0"`, `"1"`, `"25"`. Its operator is one of `eq`, `ne`, `gt`, `ge`, `lt`, `le`.
- Filters may use every operator their type allows.

### An error occurred: `AssertErrorOccurred`

Passes when a step above failed with this error, and consumes the error so it does not fail the test.

```json
"details": {
  "assertType": "AssertErrorOccurred",
  "referredRecordGuid": "N<32 hex>",
  "objectApiName": "Opportunity",
  "exceptionTypeToVerify": "System.DmlException",
  "statusCodeToVerify": "FIELD_CUSTOM_VALIDATION_EXCEPTION"
}
```

- `referredRecordGuid` is the `guid` of the step expected to fail: a Create, Find, Update or Delete
  Record step above it.
- Name the exception type and, for a save error, the status code. A status code needs
  `System.DmlException`. `describe` lists every allowed value.
