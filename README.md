# agent-info

Standard guide files and scripts for a repository that people and
coding agents work in. Each file sits at the path it takes in a
project, so adopting one is a copy, and taking an update is the same
copy again.

The scripts need Node.js 18 or later and nothing else: there is no
package to install.

## Kept identical in every project

A project never edits these. A change is made here, and reaches a
project when it copies the file again.

| File | What it is |
|---|---|
| [`DEV-PROCESS.md`](DEV-PROCESS.md) | how work is done: the prompt log, testing, documentation, code comments, and what each folder holds |
| [`STYLE-GUIDE.md`](STYLE-GUIDE.md) | how documentation is written, and the gates that hold a page to it |
| [`admin/README.md`](admin/README.md) | what `admin/` holds |
| [`sketch/README.md`](sketch/README.md) | that every file in `sketch/` is to be ignored |
| [`admin/scripts/comment-gate.cjs`](admin/scripts/comment-gate.cjs) | the comment gate of `DEV-PROCESS.md` |
| [`admin/scripts/prose-gate.cjs`](admin/scripts/prose-gate.cjs) | the local documentation gate of `STYLE-GUIDE.md`, and the page list Vale reads |
| [`admin/scripts/vale-counts.cjs`](admin/scripts/vale-counts.cjs) | the check that every count `.vale.ini` records is what Vale reports |
| [`.githooks/pre-push`](.githooks/pre-push) | the comment gate, run before a push leaves the machine |
| [`reject.txt`](.vale/styles/config/vocabularies/House/reject.txt) | the banned list, read by Vale and by the prose gate |
| [`WordChoice.yml`](.vale/styles/House/WordChoice.yml) | the house word-choice rule for Vale |

The last two sit under `.vale/styles/`, at the paths this repository
gives them.

## Copied once, then the project's own

Each of these starts a project's own file, and the project edits it
from then on.

| File | What the project sets |
|---|---|
| [`admin/scripts/comment-gate.json`](admin/scripts/comment-gate.json) | its source extensions and their comment syntax, generated files, fixture trees and build output |
| [`admin/scripts/prose-gate.json`](admin/scripts/prose-gate.json) | its gated pages, tutorials, contributor pages, own spellings and internal records |
| [`.vale.ini`](.vale.ini) | the Google rules its pages show to be wrong, demoted with their counts |
| [`accept.txt`](.vale/styles/config/vocabularies/House/accept.txt) | the terms its pages use that the dictionary lacks |
| [`.gitattributes`](.gitattributes) | the prompt log's merge driver, added to the project's own |
| [`.gitignore`](.gitignore) | the Vale entries at its end, added to the project's own |

`DEV-PROCESS.md` names the rest, which a project writes for itself:
the agent guide `AGENTS.md`, with `CLAUDE.md` a link to it, the
decision record `ADR.md`, the prompt log `sketch/PROMPT-LOG.md`, and
`docs/`.

## Adopting

1. Copy both sets of files into the project, at the same paths.
2. Set the project's languages in `comment-gate.json` and its pages in
   `prose-gate.json`. `DEV-PROCESS.md` describes the first file's keys,
   and `STYLE-GUIDE.md` the second's.
3. Install Vale, pin its version in the CI workflow as `VALE_VERSION`,
   and fetch the Google package `.vale.ini` pins with `vale sync`.
   `vale-counts.cjs` reports a count measured by any other version.
   After adding a count to `.vale.ini`, measure it with
   `node admin/scripts/vale-counts.cjs --write`.
4. Name the commands in `AGENTS.md`, and run each in CI on every push.
   Every gate exits non-zero on a finding:

   ```sh
   node admin/scripts/comment-gate.cjs
   node admin/scripts/prose-gate.cjs
   vale --minAlertLevel=error $(node admin/scripts/prose-gate.cjs --list)
   node admin/scripts/vale-counts.cjs
   ```

5. Point git at the hook with `git config core.hooksPath .githooks`.
6. Create `sketch/PROMPT-LOG.md` under a `# Prompt log` heading, and
   append the first prompt to it before the work starts.

To take an update, copy the first set again. The second set changes by
hand, so a script that gains a configuration key here gives it a
default, and an older file keeps working.

## Working on this repository

The two configuration files here set the gates for this repository.
`prose-gate.json` gates this page, and checks the links of every page
but `DEV-PROCESS.md` and `sketch/README.md`, whose links name files
only an adopting project has. Before a push:

```sh
node admin/scripts/comment-gate.cjs
node admin/scripts/prose-gate.cjs
node --test
```

The tests under `test/` belong to this repository, and are not copied.
