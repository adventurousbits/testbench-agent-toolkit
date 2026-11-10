# Testbench agent toolkit

Skills and tools that teach AI coding assistants to author, run and diagnose Testbench tests for
Salesforce.

Testbench is a no-code regression testing app for Salesforce. Its tests check how an org behaves,
including its flows, validation rules, sharing and permissions, through steps that create, change and check
records, run as the people who use the org. This toolkit lets an assistant in your Salesforce project
write those tests, check them, run them in your org and explain their results. The tests live in your
org, as they do when you work in the Testbench app, and your project can keep copies of them.

## What it does

| Skill                              | Lets your assistant                                                      |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `testbench-feature-test-generate`  | Write feature tests, and try them in your org                            |
| `testbench-persona-generate`       | Write personas: the kinds of user a test runs as                         |
| `testbench-data-template-generate` | Write data templates: sets of related records tests start from           |
| `testbench-run`                    | Run tests, validate personas and templates, and run tests in a pipeline  |
| `testbench-org-sync`               | Save tests into your project, load them into another org, or delete them |
| `testbench-run-result-verify`      | Explain a result in the words the Testbench editor uses, and find causes |

What the assistant writes is checked before it is used: a schema lists everything a Testbench file may
hold, and the toolkit's script checks every file against it, against the rules a schema cannot
express, such as a step only using records that exist when it runs, and against your org.

## Requirements

- Testbench installed in the org, and set up as its installation guide describes.
- The [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`), signed in to that
  org as a user holding the Testbench permission set.
- [Node.js](https://nodejs.org) 20 or later, which runs the toolkit's script. The script uses only
  Node's built-in modules, so nothing else is installed.

## Installing

**Claude Code:**

```
/plugin marketplace add adventurousbits/testbench-agent-toolkit
/plugin install testbench@adventurousbits
```

**Other assistants** that read Agent Skills:

```bash
npx skills add adventurousbits/testbench-agent-toolkit
```

## Using it

Ask your assistant in plain language: "write a Testbench test that a large opportunity needs approval",
"run my Testbench tests in the dev sandbox", "why did this Testbench test fail?". The skills tell it how,
and it does the work with the toolkit's script and the Salesforce CLI.

In Claude Code, these commands are shortcuts into the same skills:

| Command               | Does                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `/testbench:write`    | Writes a test, persona or data template you describe into its category, then tries it |
| `/testbench:run`      | Runs tests (named, a category or all) and explains the results                        |
| `/testbench:validate` | Validates personas and templates (named, a category or all) and explains verdicts     |
| `/testbench:results`  | Explains the latest results and verdicts                                              |
| `/testbench:pull`     | Saves tests, personas and templates from your org into your project                   |
| `/testbench:push`     | Loads the copies in your project into an org, as the app's import does                |
| `/testbench:pipeline` | Adds a pipeline step that runs the tests and fails the build on a fail                |

Your tests, personas and data templates live in your org. When your team wants them in source
control, to review them with the metadata they check or to bring them to another org, the assistant
saves copies in a `testbench/` folder in your project, one file each in a folder per category.

## Safety

- **Production only after your yes.** The assistant checks the org's kind first, and asks you to
  confirm before writing anything to a production org.
- **Deleting only after your yes.** The assistant deletes a test, persona or template only when you
  ask, after showing what goes with it and what still uses it.
- **Nothing replaced unseen.** Loading copies into an org makes their versions active, as the app's
  import does, and the versions they replace stay in the org. In an org others work in, the assistant
  shows you which would change before it loads anything.
- **Your own sign-in.** Every request goes through the Salesforce CLI with your existing
  authentication. The toolkit never handles a password or token.

## Compatibility

Requires Testbench 1.6.0 or later, the release that introduced the toolkit. The assistant checks your
org's Testbench version first, and stops when it is older.

## Feedback

Please report problems and ideas as [issues](https://github.com/adventurousbits/testbench-agent-toolkit/issues).
This repository receives releases of a toolkit developed elsewhere, so it does not take pull requests.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
