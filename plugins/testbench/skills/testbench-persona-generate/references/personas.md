# Personas

A persona is a user Testbench creates when a test runs, with the fields, permissions and memberships
its active version names. A Select Persona step runs the following steps as that user. The user exists
only inside the run.

## Records

```json
"testPersonaCategories": [{ "GUID__c": "C<32 hex>", "Name": "Sales", "Description__c": "..." }],
"testPersonas": [{ "GUID__c": "P<32 hex>", "Name": "Sales representative", "Persona_Category__c": "C<32 hex>" }],
"testPersonaVersions": [{
  "GUID__c": "V<32 hex>",
  "Name": "Sales representative",
  "Persona__c": "P<32 hex>",
  "Editor_Version__c": 1,
  "Description__c": "Who this is and why a test needs them.",
  "User_Fields__c": { "...": "..." },
  "Permission_Sets__c": [],
  "Permission_Set_Groups__c": [],
  "Permission_Set_Licenses__c": [],
  "Group_Memberships__c": [],
  "Territory_Assignments__c": []
}]
```

Steps and fields refer to the persona by the persona's GUID (`P…`), never the version's (`V…`).

## User_Fields\_\_c

User field API name to value. **Every value is text.**

| Field                                                 | Value                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Username`                                            | Unique across Salesforce: use a distinctive address on a `.example` domain                |
| `LastName`, `FirstName`, `Email`                      | Fictional                                                                                 |
| `Alias`                                               | At most 8 characters                                                                      |
| `ProfileId`                                           | The profile's **name**, as shown in Setup                                                 |
| `UserRoleId`                                          | The role's **developer name**                                                             |
| `TimeZoneSidKey`, `LocaleSidKey`, `LanguageLocaleKey` | Salesforce keys, such as `Europe/Amsterdam`, `nl_NL`, `en_US`                             |
| `EmailEncodingKey`                                    | Usually `UTF-8`                                                                           |
| A lookup to User, such as `ManagerId`                 | Another persona's GUID, `P…`                                                              |
| A lookup to another object, such as `ContactId`       | A data template record, `<templateGuid>:<nodeGuid>`                                       |
| A checkbox                                            | `true` or `false`. Leaving it out gives the platform's default, which is not always false |

The fields above marked required by the schema must be present; the user cannot be created without
them. Leave out what the persona does not need.

**A profile is matched by its name**, because profiles have no developer name. Standard profile names
differ between orgs set to different languages, and a renamed profile no longer matches: the run then
reports `PERSONA_PROFILE_NOT_FOUND`.

**Profiles are resolved as the integration user** Testbench runs tests as. That user needs View All
Profiles to see them.

## Permissions and memberships

Each is a list of names. A name the org does not have is reported when the persona is validated or a
test runs as it, and the persona is created without it.

| Field                        | Each entry is                                                       |
| ---------------------------- | ------------------------------------------------------------------- |
| `Permission_Sets__c`         | A permission set's API name                                         |
| `Permission_Set_Groups__c`   | A permission set group's developer name                             |
| `Permission_Set_Licenses__c` | An active permission set licence's developer name                   |
| `Group_Memberships__c`       | A public group's or queue's developer name; both share this list    |
| `Territory_Assignments__c`   | A territory's developer name; needs Enterprise Territory Management |

## Personas that refer to each other

A persona may name another as its manager or delegated approver, and two personas may name each other.
Testbench creates every persona before it links them, so no order is needed. A loop the platform
refuses, such as two managers of each other, is reported against the persona.

## Validating

Validate a persona on its own before tests use it: the script's `validate <file>` loads it and
validates it (`script.md`). A verdict of Invalid lists every problem, in the words the Testbench editor
uses.
