# The Testbench script

The toolkit's script, `scripts/testbench.mjs`, does the exacting work the same way every time: it
makes GUIDs, checks Testbench files against the editor's rules and against an org, loads them into
an org, runs tests, validates personas and data templates, reads what came of it, saves the org's
tests into files, deletes after the developer's yes, and shows a test in plain words. It needs Node
20 or later and nothing else, and reaches an org only through the Salesforce CLI, signed in as the
developer.

**The org is where tests live.** A file is a copy: one written to check a new test before it goes
into the org, or one the developer asked to keep in the project. Loading a file works like the app's
import, and saving one takes the org's active version.

```bash
node <skill-directory>/scripts/testbench.mjs <command> [options]
```

`<skill-directory>` is the folder of the skill you are following. Run it from anywhere inside the
project, so it finds the project's `testbench/` folder (`project-files.md`). Write the script's full
path in every command, rather than changing into the skill's folder or keeping the path in a shell
variable: an assistant's permission checks may refuse either, or stop to ask the developer, because
neither can be checked before it runs. `--target-org` names the org by its alias or username;
without it, the Salesforce CLI's default org is used. When the developer named no org and the CLI
has no default, ask which org to use: never choose one of the orgs the CLI is signed in to.

---

## `list`: what the org holds

```bash
node <skill-directory>/scripts/testbench.mjs list [--category "<category name>"] --target-org <alias>
```

Each category of feature tests, personas and data templates in the org, with its description, and
every test, persona or template in it with its GUID; one without an active version says so. Look here
before writing, to choose a category and to use a persona or template the org already has, and
before running, to find what to run. It writes nothing.

## `guid`: new GUIDs

```bash
node <skill-directory>/scripts/testbench.mjs guid N 12
```

Prints as many GUIDs as asked, one per line, for the prefix given: `C`, `V`, `T`, `P`, `D` or `N`
(`guids.md` says which kind each is).

## `check`: check files before they are loaded

```bash
node <skill-directory>/scripts/testbench.mjs check [file or folder ...] [--target-org <alias>]
```

With no file or folder named, it checks every file in the project's `testbench/` folder. It always
reads the rest of that folder too, so a test may use a persona or template another file holds.

- **The shape:** every key and value against the schema in `schema/v1/`, the allow-list.
- **The file:** steps refer only to what exists when they run, values have the format their type
  requires, comparisons use an operator their type allows, and every record and step has its own
  GUID.
- **The project:** an item lives in one file, and every file in a category folder holds the same
  category record.
- **With `--target-org`, the org:** every object and field a step names exists, with the type the
  file stores and the access the step needs; a persona's user fields can be set; and every persona,
  template and parent a file uses but the project does not hold is in the org, with an active
  version.

Check offline while writing. `check` is the only command that stays offline without `--target-org`;
every other command checks against the org itself before it writes anything.

## `push`: load files into an org

```bash
node <skill-directory>/scripts/testbench.mjs push [file or folder ...] --target-org <alias>
```

It checks the files against the org, and loads nothing while an error remains. Then it loads them
the way the Testbench app's import does, by GUID, and writes only what changed, personas first, then
templates, then tests:

- **A version is its GUID.** Testbench locks a version's steps once it has been active, so a version
  the org already holds is never sent again.
- **Created:** the item, or the file's version of it, was not in the org yet. It is created, and the
  file's version is made active.
- **Made active again:** the org holds the file's version, but another one is active.
- **Unchanged:** the org's active version is the file's. A name or description that differs is
  updated, as the import does.
- **Refused:** the org holds the file's version with other steps. Changed steps are a new version:
  give the version a new GUID (`guid V`) and push again.

**Creating or changing a Global template needs the Testbench - Manage Global Templates permission
set**, administrators included. When the files would create or change one and the signed-in user
lacks it, nothing is loaded, and `--dry-run` says so too; ask an administrator for the permission
set. A Global template the push leaves unchanged needs no permission.

**Every Testbench user in the org sees the Global templates.** If they seem to be missing, opening
the Data Templates page once makes them visible again, and so does running a test or validating a
persona or template.

**Making the file's version active replaces the org's active version**, and the report names the
version replaced. Nothing is deleted: that version stays in the org, inactive, and can be made active
again in the Testbench app. Before loading into an org that other people work in, run with
`--dry-run`, and tell the developer which tests, personas and templates would get another active
version.

It then waits until every loaded item has deployed or failed to, and validates the personas and
templates whose definition changed, personas first.

| Option               | Does                                          |
| -------------------- | --------------------------------------------- |
| `--dry-run`          | Says what it would do, and changes nothing    |
| `--no-validate`      | Leaves the personas and templates unvalidated |
| `--no-wait`          | Returns without waiting for the deploy        |
| `--allow-production` | Writes to a production org: see below         |

## `run`: run feature tests

```bash
node <skill-directory>/scripts/testbench.mjs run <GUID ...> --target-org <alias>
node <skill-directory>/scripts/testbench.mjs run --category "<category name>" --target-org <alias>
node <skill-directory>/scripts/testbench.mjs run --all --target-org <alias>
node <skill-directory>/scripts/testbench.mjs run [file or folder ...] --target-org <alias>
```

The org holds the tests, so a test or a category named by its GUID runs as the org holds it, and
nothing is loaded. `--category` runs a category's tests by its name or GUID, and `--all` every test
with an active version. Files are loaded first, as `push` does, and nothing runs when the load left
the org without what they hold; `--no-push` runs the files' tests as the org holds them.

It flags each test to run and waits for a **new** result of each, then reports each test's outcome,
and for a failure every step with a problem, in the words the Testbench editor uses. A test already
running is not started again; its next result is the one reported.

**Every run counts against the org's daily allowance of Apex test runs.** Before `--all` or a large
category, run it with `--dry-run`, tell the developer how many tests would run, and start them only
once they agree.

`--junit <file>` also writes the results as a JUnit report, which a pipeline shows as test results
(`pipeline.md`): a failure explained in the editor's words, and a test that could not run as an
error. Nothing is written when the run never started, such as when loading the files was refused.

## `validate`: validate personas and data templates

```bash
node <skill-directory>/scripts/testbench.mjs validate [GUID ... | --category <name> | --all | file or folder ...] --target-org <alias>
```

The same choice of what to validate as `run`, for personas and templates. Each is validated on its
own, and its verdict, `Valid` or `Invalid`, is reported with every problem an `Invalid` one found.
Personas are validated before templates: two validations at once collide in the org, and the one
refused is recorded as `Invalid` although it never ran. Validations count against the same daily
allowance as runs.

## `results`: what the latest runs and validations found

```bash
node <skill-directory>/scripts/testbench.mjs results [GUID ... | --category <name> | --all | file or folder ...] --target-org <alias>
```

The newest result of each feature test and the latest verdict of each persona and template, each
explained. It starts nothing, so it costs nothing of the daily allowance.

## `pull`: save the org's tests into files

```bash
node <skill-directory>/scripts/testbench.mjs pull <GUID ...> --target-org <alias>
node <skill-directory>/scripts/testbench.mjs pull --category "<category name>" --target-org <alias>
node <skill-directory>/scripts/testbench.mjs pull [file or folder ...] --target-org <alias>
```

The org holds the tests, and a file is a copy. Pulling saves each test's, persona's or template's
active version into its file, replacing what the file held: a change made in the file since is
replaced too. A GUID, of a test, persona, template or category, saves what may be only in the org,
as does `--category`, by name or GUID, and `--all` saves everything there. With nothing named, it
saves again every item the project's files hold.

- **One file per item**, in its category's folder (`project-files.md`). An item's file is found by
  the GUID inside it, so a renamed item keeps its file, and a new one is named after the item. An
  item moved to another category in the app moves to that category's folder, Global Templates
  included.
- **Only what changed is written**, with the file's keys kept in their order, so `git diff` shows
  exactly that. Show the developer what changed.
- **What a saved item uses comes too**: a persona or template that no file of the project holds is
  saved into a file of its own.
- **Not in the org:** the item's file is left in place. Whether to remove it is the developer's
  decision.
- **No active version:** there is nothing to save, and the file is left as it is.

`--output-dir <folder>` saves what GUIDs, `--category` or `--all` name into that folder instead of
the project's `testbench/` folder, in the same layout. Use it for a copy to change, in a new
temporary folder, when the project keeps no copies: the project then gains no `testbench/` folder it
did not ask for. `--dry-run` says what it would write, and writes nothing.

## `delete`: delete from an org, after the developer's yes

```bash
node <skill-directory>/scripts/testbench.mjs delete <GUID ...> --target-org <alias>
node <skill-directory>/scripts/testbench.mjs delete <GUID ...> --target-org <alias> --confirm <code>
```

Deletes tests, personas, templates, their versions or whole categories, named by their GUIDs only, so
naming a folder can never widen what goes. Deleting cannot be undone, so it takes two calls:

1. **Without `--confirm`, it deletes nothing.** It lists what would go and everything that goes with
   it, what still uses a persona or template that goes, what Testbench refuses to delete for now (a
   test while it runs, a persona while it is validated, a Global template for a user without the
   Testbench - Manage Global Templates permission set), and the project's files that go with the
   same yes. It ends with a code for exactly that list.
2. **Show the developer the list, and ask.** Only after their explicit yes to that list, run the same
   command with `--confirm <code>`. The code fits that list and that org only: when anything changed
   since, nothing is deleted, and the new list is shown with a new code, to ask about again. A yes
   covers the list it was given to, never the next one.

Then it removes the project's files of what was deleted, and a folder left empty. A file that holds
something the org never had is kept. A file missing from the project is never a reason to delete:
a push only creates and updates.

## `show`: a test, persona or template in plain words

```bash
node <skill-directory>/scripts/testbench.mjs show [file, folder or GUID ...] [--target-org <alias>]
```

Each step under the name the editor gives it, with its label and what it does, naming the personas,
templates, template records and earlier steps it refers to. Read a test back with it after writing
one, or use it to explain a test to the developer. It shows the project's files, by default every
one, without reaching the org. A GUID the project does not hold is shown from the org, the CLI's
default one unless `--target-org` names another; with `--target-org`, it also names what the
project's files use but do not hold.

---

## Production

**A command that writes refuses a production org** unless given `--allow-production`. Testbench runs
in production too, but writing there creates and changes records in the developer's live org. When
the script refuses, say so plainly, and ask the developer whether to go ahead in that org. Pass
`--allow-production` only after their explicit yes, and only for that org. A `--dry-run`, a pull and
a delete's list write nothing to the org, so they need no yes; a confirmed delete needs both.

## Waiting

Deploying takes minutes, and Testbench works through what is waiting in turn. The script waits up to
30 minutes, or the minutes given with `--wait`, looking every 20 seconds, or every
`TESTBENCH_POLL_SECONDS`. While it waits it writes progress to standard error.

Give the command the longest time your tool allows, or run it in the background where you can. If it
is interrupted, the work goes on in the org: running the same command again picks it up, since a push
waits for any deploy still under way, and a run does not start a test that is already running.

## Reading what it reports

Each problem in a file names its file, its place in the file, such as
`$.data.featureTestVersions[0].Act_Definition_Data__c[2].details`, and what is wrong.

- **An error** must be fixed before the file is loaded. Fix it in the file and check again, until no
  error remains.
- **A warning** names something the file relies on the org already holding, or a habit the editor
  would correct, such as a check without a description. Confirm it or fix it, then go on.

Each test, persona and template is reported with what happened to it: what the push did, how its
deploy ended, its verdict or its outcome, and every problem found, under the step it belongs to.

Add `--json` for one JSON document instead of text. `check` reports `files`, each with its `path`,
`errors` and `warnings`, and `show` reports `items`, each with its `lines`. The other commands
report the org, then a part for each thing they did: `check` when the check stopped the push,
`push`, `run`, `validation`, `results`, `pull` and `delete`, and `junit`, the report's path.

| Exit code | Means                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Everything is in order: no error, every test passed, every persona and template is valid                                          |
| 1         | Something was found: an error in a file, an item refused or failed, a test that did not pass, an `Invalid`, a changed delete list |
| 2         | The work could not be done; the message says why, such as a missing file, an unreachable org or production                        |

## When it cannot run

- **Node is missing or older than 20** (`node --version`): say so, and ask the developer to install
  a current Node from [nodejs.org](https://nodejs.org) or their package manager. Never load a file
  the script has not checked: a file that breaks the editor's rules can be accepted by the org and
  fail later for a reason no author could have caused.
- **The Salesforce CLI is missing, or the org cannot be reached**, the message says which. Testbench
  being unreachable means it is not installed in that org, or the signed-in user lacks the Testbench
  permission set; the toolkit cannot fix either.
