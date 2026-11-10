# GUIDs

Every record and every step in a Testbench file has a GUID: a prefix naming its kind, followed by 32
lowercase hexadecimal characters. It identifies the record in every org, so loading the same file
twice updates rather than duplicates.

| Kind                                | Prefix |
| ----------------------------------- | ------ |
| Category, of any kind               | `C`    |
| Version, of any kind                | `V`    |
| Feature test                        | `T`    |
| Persona                             | `P`    |
| Data template                       | `D`    |
| Step (node) of a test or a template | `N`    |

Every prefix is one letter, so none is the start of another. A category's or a version's GUID does
not say its kind: the list holding it does, in a file, and the org does for a GUID given on its own.

A field entry exported by the editor may also carry a `guid` starting with `F`; you never need to
write one.

**One GUID is fixed:** Global Templates, the category of every Global data template, is
`CGlobalTemplates` in every org. Use it as it is; never make one for it.

## Making one

Make GUIDs with the script, never in your own head: a GUID written by hand repeats patterns, and two
that collide overwrite each other's records. The script takes them from the system's random
generator, on every operating system. Make as many as the file needs in one go:

```bash
node <skill-directory>/scripts/testbench.mjs guid N 12
```

This prints twelve step GUIDs. Give the prefix of the kind you need, from the table above.

## Rules

- **Never reuse a GUID** for a different record or step, and never copy one from an unrelated org.
- **A version is its GUID.** A version's steps, a persona's settings and a template's records never
  change once the version has been active, so the org holding a version's GUID holds exactly those.
- **Changed steps are a new version, with a new GUID** (`V`). Loading a file whose
  steps changed under a GUID the org already holds is refused. Keep the GUIDs of the test, persona or
  template and of its category: only the version is new.
- **A changed name or description keeps its record's GUID.** The GUID is how loading finds the
  record, and a name or description can change in place.
