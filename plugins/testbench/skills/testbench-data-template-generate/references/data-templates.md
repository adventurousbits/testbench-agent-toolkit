# Data templates

A data template is a set of related records, created together. A **Regular** template is created where
a test loads it with a Use Data Template step, or where a persona or another template points at one of
its records. A **Global** template is created at the start of every test run.

## Records

```json
"dataTemplateCategories": [{ "GUID__c": "C<32 hex>", "Name": "Customers", "Description__c": "..." }],
"dataTemplates": [{ "GUID__c": "D<32 hex>", "Name": "Customer account", "Type__c": "Regular", "Data_Template_Category__c": "C<32 hex>" }],
"dataTemplateVersions": [{
  "GUID__c": "V<32 hex>",
  "Name": "Customer account",
  "Data_Template__c": "D<32 hex>",
  "Editor_Version__c": 1,
  "Description__c": "What situation the records describe.",
  "Definition_Data__c": [ ]
}]
```

Name a template for its role, such as "Open deal with products", not for its sample content.

## Definition_Data\_\_c

A list of Create Record steps, one per record, in the same shape as in a feature test:

```json
{
  "guid": "N<32 hex>",
  "type": "CreateRecord",
  "label": "Customer account",
  "details": {
    "objectApiName": "Account",
    "fieldsToCreate": [
      { "apiName": "Name", "dataType": "STRING", "value": "Northwind Traders" }
    ]
  }
}
```

Field entries, value formats and names-instead-of-Ids are described in `field-values.md`.

## References inside a template

A lookup holds one of:

| Points at                                  | Value                                                               |
| ------------------------------------------ | ------------------------------------------------------------------- |
| A record **above** it in the same template | that record's `guid`, `N…`                                          |
| A record of another template               | `<templateGuid>:<nodeGuid>`; that template is created with this one |
| A persona's user (a lookup to User)        | the persona's GUID, `P…`                                            |
| The standard price book                    | `StandardPricebookId`                                               |

A record never refers to a record of its own template by `<templateGuid>:<nodeGuid>`; use its `guid`.

## How the records are created

- **As whoever loads the template.** In a test, put the Select Persona step before the Use Data
  Template step when the persona must own the records.
- **With that user's access.** A field the user cannot see or create fails the record.
- **One record at a time, in order.** A record that fails is reported, and the template's other records
  are still created.
- **Once per run.** Loading the same template again uses the records already created.

## Global templates

Every test run and every validation creates every active Global template first. Use one only for
data the org's automation cannot work without, such as a setting a flow reads, and keep it small:
a Global template that fails, fails every test and every validation in the org. A Use Data Template
step never loads a Global template.

A template cannot fill a setting that must hold a record's Id. It points a lookup at a record it
creates, but it never writes an Id into a text field, and a custom setting has no lookup fields. Say
so when an org's automation depends on such a setting, rather than writing an Id from one org.

**A Global template's category is always Global Templates**, whose GUID is `CGlobalTemplates` in
every org; never make one with `guid`. Its file holds that category like any other:

```json
"dataTemplateCategories": [{ "GUID__c": "CGlobalTemplates", "Name": "Global Templates" }],
"dataTemplates": [{ "GUID__c": "D<32 hex>", "Name": "Pricing settings", "Type__c": "Global", "Data_Template_Category__c": "CGlobalTemplates" }],
```

Loading the file creates Global Templates when the org lacks it, and otherwise leaves it as the org
has it. **Writing a Global template needs the Testbench - Manage Global Templates permission set**,
administrators included: without it, loading the file stops before anything is written. Everyone
can still validate a Global template.

**The category and the type always agree.** Moving a template into Global Templates makes it
Global, and moving it out makes it Regular. To make a Regular template Global, give its file the
Global type and Global Templates as its category, move the file to Global Templates' folder, and
load it; to make it Regular, name another category and the Regular type. Every run loads the new set
of Global templates from then on, and each of these needs the same permission set.

**Every Testbench user in the org sees the Global templates.** If they seem to be missing, opening
the Data Templates page once makes them visible again, and so does running a test or validating a
persona or template.

## Validating

Validate a template on its own before tests use it: the script's `validate <file>` loads it and
validates it (`script.md`). An Invalid verdict names the record that failed and why.
