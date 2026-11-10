# Field values

A step that writes, filters or compares fields holds a list of **entries**:

```json
{ "apiName": "CloseDate", "dataType": "DATE", "value": "2027-03-31" }
```

A comparison adds an `operator`. An entry exported by the editor may also carry a `guid` (`F…`); you
never need to write one.

## dataType

The field's type **as the org's describe names it**, in upper case:

```bash
sf sobject describe --sobject Opportunity --target-org <alias>
```

The describe's `int` is `INTEGER`; every other type is its name in upper case. A different type than
the org's is an error when the script checks the file against the org, and the editor flags it as
changed.

The allowed types are the `dataType` list in `schema/v1/common.schema.json`.

## value

Every value is **text**, never a JSON number or boolean, in the format its type requires:

| dataType                        | Value                               | Example                      |
| ------------------------------- | ----------------------------------- | ---------------------------- |
| `BOOLEAN`                       | `true` or `false`                   | `"true"`                     |
| `DATE`                          | `YYYY-MM-DD`, a real date           | `"2027-03-31"`               |
| `DATETIME`                      | ISO 8601 in UTC, ending in `Z`      | `"2027-03-31T09:30:00.000Z"` |
| `TIME`                          | `HH:MM` or `HH:MM:SS`, optional `Z` | `"09:30:00.000Z"`            |
| `INTEGER`, `LONG`               | digits, optional minus              | `"42"`                       |
| `DOUBLE`, `CURRENCY`, `PERCENT` | digits, optional decimals           | `"2500000"`, `"12.5"`        |
| `MULTIPICKLIST`                 | a list of values                    | `["Red", "Blue"]`            |
| text and picklist types         | the text or picklist value itself   | `"Prospecting"`              |
| `REFERENCE`, `ID`               | a reference, below                  |                              |

`null` leaves the field empty.

## References

A lookup (`REFERENCE` or `ID`) never holds a record Id: an Id exists in one org only. It holds one of:

| Points at                                     | Value                           |
| --------------------------------------------- | ------------------------------- |
| A record a step above created or found        | that step's `guid`, `N<32 hex>` |
| A record a data template created, once loaded | `<templateGuid>:<nodeGuid>`     |
| A persona's user (only on a lookup to User)   | the persona's GUID, `P<32 hex>` |
| The standard price book (`REFERENCE` only)    | `StandardPricebookId`           |

## Names instead of Ids

These fields hold a **name**, which the run resolves in the org, and their dataType is always
`PICKLIST`:

| Field                    | Value                                       |
| ------------------------ | ------------------------------------------- |
| `RecordTypeId`           | the record type's developer name            |
| `ProfileId`              | the profile's name                          |
| `UserRoleId`             | the role's developer name                   |
| `PermissionSetId`        | the permission set's API name               |
| `PermissionSetGroupId`   | the permission set group's developer name   |
| `PermissionSetLicenseId` | the permission set licence's developer name |

A record type of `Master` means the object's default and is left unset.

## Operators

A Verify Outcome entry, a record-count filter and a Find Record filter compare with an operator its
type allows:

| dataType                                                                       | Operators                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `BOOLEAN`                                                                      | `eq`, `ne`                                                       |
| `MULTIPICKLIST`                                                                | `includes`, `excludes`                                           |
| `INTEGER`, `LONG`, `DOUBLE`, `CURRENCY`, `PERCENT`, `DATE`, `DATETIME`, `TIME` | `eq`, `ne`, `gt`, `lt`, `ge`, `le`                               |
| `STRING`, `TEXTAREA`, `PHONE`, `EMAIL`, `URL`                                  | `eq`, `ne`, `contains`, `not contains`, `startswith`, `endswith` |
| every other type                                                               | `eq`, `ne`                                                       |
