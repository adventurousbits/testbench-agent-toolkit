# The stored result

Where a result is stored and what it holds, for reading it with `sf data query` and explaining it.

## Where results are stored

| Object.field                                                                                                                                             | Holds                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `testbench__Feature_Test_Run_Result__c`                                                                                                                  | One record per run of a test                                                                                                      |
| `…Run_Result__c.testbench__Outcome__c`                                                                                                                   | `Pass`, `Fail`, `CompileFail` or `Skip`                                                                                           |
| `…Run_Result__c.testbench__Outcome_Details__c`                                                                                                           | What went wrong, described below                                                                                                  |
| `…Run_Result__c.testbench__Feature_Test__c`, `…Feature_Test_Version__c`                                                                                  | The test and the version that ran                                                                                                 |
| `testbench__Feature_Test__c.testbench__Run_Status__c`                                                                                                    | Where the latest run is: `Pending`, `Queued`, `Running`, `Completed` and others. `Completed` does not mean passed                 |
| `testbench__Feature_Test__c.testbench__Deployment_Status__c`                                                                                             | `Deployed`, or why not: `TranspilationFailed`, `DeploymentFailed`, `DeploymentCancelled`, with details in `Deployment_Details__c` |
| `testbench__Persona__c` and `testbench__Data_Template__c`: `Validation_Status__c`, `Validation_Outcome__c`, `Validation_Message__c`, `Last_Validated__c` | A validation and its verdict. `Validated` ends a validation; `Valid` or `Invalid` is the verdict                                  |

The newest result of a test is the one with the latest `CreatedDate`. A field such as `Run_Status__c`
still shows the previous run until the next one starts, so wait for a **new result**, never for a status.

## Outcome_Details\_\_c

Usually a JSON object:

```json
{
  "nodes": [
    {
      "guid": "N<32 hex>",
      "label": "Verify that the opportunity is open at Prospecting",
      "exceptions": [
        {
          "status_code": "FIELD_VALUE_MISMATCH",
          "fields": ["StageName"],
          "expected": "Prospecting",
          "actual": "Qualification",
          "operator": "eq",
          "severity": "error"
        }
      ]
    }
  ],
  "contexts": [],
  "general": null
}
```

- **`nodes`**: the steps, by `guid` and `label`, each with its problems in `exceptions`. A data
  template's record is named `<templateGuid>:<nodeGuid>`.
- **A problem** carries its `status_code` and whatever applies of `fields`, `expected`, `actual`,
  `operator`, `api_name`, `message` and `exception_type`.
  Write the values as the editor does: a number stored as `20.0` reads `20`, and an operator in
  words (`status-codes.md`).
- **`context`** on a problem is the id of a `contexts` entry: the persona or template it was found
  inside (`kind`, `guid`), the step that used it (`node`), the field that reached it (`field`), and
  the enclosing context (`parent`). A problem without one belongs to the test itself.
- **`about`** on a summary such as `DATA_TEMPLATE_STEP_FAILED` names the use it reports on.
- **`general`**: present only when something stopped the run outside every step.
- **`omitted_nodes`, `omitted_entries`**: present only when the result was too long to store in full.

It can also be `{"generalStatusCode": "TEST_RUN_DAILY_LIMIT_REACHED"}`, or plain text when a run could
not start at all. A persona's or template's `Validation_Message__c` has the same shape, with the persona
or template itself as the step.
