# Testbench plugin

The skills, commands and schema that let a coding assistant work with Testbench. See the
[repository README](../../README.md) for installing and using it.

## Layout

| Path                        | Holds                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `skills/<name>/SKILL.md`    | One skill each: what it is for, its workflow and its rules            |
| `skills/<name>/references/` | Detail a skill points to, such as the script's commands and the steps |
| `skills/<name>/schema/`     | The allow-list: every key and value a Testbench file may hold         |
| `skills/<name>/data/`       | The Testbench versions the toolkit supports                           |
| `skills/<name>/scripts/`    | The toolkit's script, `testbench.mjs`, and its modules                |
| `commands/`                 | The Claude Code commands, `/testbench:<name>`, each starting a skill  |

The script does the exacting work the same way every time: it lists what an org holds, makes GUIDs,
checks files against the schema, the editor's rules and the org, loads them, runs and validates, saves
copies, deletes after a yes, and explains results. It is written for Node 20 or later and uses only
Node's built-in modules. It ships in each skill's `scripts/` folder, as Salesforce's own skills ship theirs,
and reaches an org only through the Salesforce CLI. The skills say when to run it and how to read
what it reports.

Every skill carries the schema, data and script it needs, so each one works when installed on its
own.

Each kind of Testbench record has a skill of its own: feature tests, personas and data templates are
written independently, because each can be used without the others. A new kind of record gets a new
skill beside them.

## The schema

`schema/v1/` describes the Testbench file and every step type, one file per step. What each step does,
such as whether later steps may use its record, whether it can fail and which keys point at something
else, is declared beside its shape under `x-testbench`, and the script reads it from there. See
`schema/README.md`.
