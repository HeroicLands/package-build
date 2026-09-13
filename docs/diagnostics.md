# Diagnostics

Every warning or error this toolchain emits is machine-parseable and says
where it is. This document is for the person reading a wall of that output:
what the fields mean, why a field is sometimes missing, why a run's exit code
does not always track its warning count, and how to parse the output
yourself. `engine/diagnostics.mjs` is the module that owns the contract;
everything here is read from it.

## The located form

A finding about a file is printed as:

```text
file:line:column: severity: message
```

For example:

```text
assets/content/Regions/Capital_Nome.md:43:635: error: address [[place-kenbetpat]] resolves to no note — no package publishes it. Fix the shortcode, or declare the package that does as a dependency and run `content-build deps fetch` — in "The Capital Nome".
```

That is the same shape every C-family compiler, `tsc` and ESLint already use,
which is deliberate: an editor, a CI annotator or a `grep` parses it with no
knowledge of this build. `formatDiagnostic` builds the line and
`formatLocator` builds the `file:line:column` part of it; `severity` is
either `warning` or `error`, and `message` is one sentence.

The path is relative to the working directory — during a build, the
consuming repository's root — because that is both shorter to read and what
an editor resolves a relative diagnostic against. A file outside the working
directory keeps its absolute path; a `../../..` locator would help nobody.

Three rules hold the form together.

### The path starts the line

A located diagnostic is never indented and never carries a prefix — not a
timestamp, not a severity tag, nothing before the file name. `emitDiagnostic`
prints every diagnostic with a bare `console.error` or `console.warn`,
deliberately bypassing this toolchain's own `loglevel` logger, whose
configured `[timestamp] [WARN]:` prefix occupies exactly the position a
parser reads the path from. A greedy path pattern would swallow that prefix
and hand a reader a filename nothing can open. Progress and summary lines are
not diagnostics and go through `loglevel` as ordinary prose — see
[Summary counts and prose are not findings](#summary-counts-and-prose-are-not-findings)
below.

### A field is dropped, never guessed

`formatLocator` reports the most precise position it can honestly establish
and nothing more:

- `file:line:column: …` when a line and a meaningful column are both known.
- `file:line: …` when only the line is — a column is ignored entirely once
  there is no line to pair it with, since a column alone locates nothing.
- `file: …` when nothing beyond the file itself could be established.

Nothing ever defaults to `1:1`. A missing position that silently became `1:1`
would send a reader to the top of the file — usually the frontmatter — for
every diagnostic that could not otherwise be placed, and it would look
exactly like a real position instead of an absent one.

### An implicit position is recovered by search

Some diagnostics know their position by construction — a compile pass
tracking a scanner's offset as it reads a note's body. Others know only that
something is wrong with a literal a file contains — a wikilink, a caption, a
localization key — and never carried a byte offset in the first place.
`engine/diagnostics.mjs` supplies one function for the first case and three
for the second, and all of them fall back to `{}` — an empty spreadable
object — when a position cannot be established, so a caller writes
`{ ...position }` and gets the drop-not-guess rule for free.

**`positionInBody(body, offset, opts)`** answers the constructed case: where
a character offset into a note's parsed **body** falls in the note's **file**.
Three corrections apply, each only where it is true:

1. The frontmatter's own lines are not part of the body, so an offset is not
   a file line until they are added back (`opts.bodyLine`).
2. The body is trimmed before it is scanned, which can strip leading
   whitespace from only its first line; `opts.bodyColumn` restores it, and
   only on that line.
3. A body is scanned **after** its content tables expand, so an offset can
   land in text nobody authored. `opts.lineMap` — from
   `expandContentTables` — maps each scanned line back to the authored line
   it came from. A line with no authored source reports the directive that
   generated it and **no column**, because there is no authored character to
   point a column at; `positionInBody` marks this `generated: true`.

**`positionOfLiteral(text, needle, occurrence)`** answers the plain case: a
string the reader can see in a file that is not a note body — a manifest, a
lockfile, a config file, a file being checked as raw text rather than parsed
frontmatter. Because one literal can appear more than once, `occurrence`
(1-based, default `1`) selects which match the position is for — the caller
counts how many times it has already seen the literal in this file and passes
the next number, so four identical findings on one note land on four
different lines or columns instead of collapsing onto the first.

**`positionInFrontmatter(raw, key, value, opts)`** locates a **top-level
frontmatter key** by searching the fence rather than the whole file — a bare
search for a key like `name` or `type` would routinely match a line of prose
first. Passing `value` narrows the match to the entry that carries it, which
is what a list-valued key (`aliases`) needs: the finding belongs on the
wrong entry, not on the key that introduces the list. `opts.topLevel`
requires the match at column 1, for a key name that is legal both at the top
level and nested (`aliases` is both a retired top-level field and a
permitted `name.aliases`) — without it, a finding about the retired field
could resolve to the nested one and tell an author to delete a field they are
allowed to write.

**`positionOfYamlPath(text, keyPath, opts)`** and
**`positionOfFrontmatterPath(raw, keyPath, opts)`** locate a node by
**path** rather than by searching for a name, which is the right tool once a
name can legally appear in more than one place — `data.weight` and a
top-level `weight` are different keys, and a name search finds whichever
comes first. `keyPath` is an array of map keys (strings) and sequence indices
(numbers); `yamlKeyPath(field)` turns a dotted path as a message would write
it — `packs[1].name`, `site.sections.affliction.title` — into that array,
refusing the whole path rather than resolving part of it if any segment does
not parse. `positionOfYamlPath` re-parses the document to get a node with a
range attached — the loader that originally read the file discards ranges
once the data is materialized, so carrying a parallel position tree through
configuration resolution would be a second representation of the same file to
keep in sync. `positionOfFrontmatterPath` is the same lookup scoped to a
note's frontmatter fence rather than a whole document.

By default the position is the node's **value** — a finding that a value is
wrong belongs on the value. Passing `opts.key: true` reports where the last
segment is **declared** instead, for a finding that names the field itself
(`site.sections.x is not a recognized option`) — in a flow mapping like
`{ title: X, banner: Y }` the key and the value are different columns on the
same line, and a field-naming finding should send the reader to the field,
not to whatever happens to be written there.

## A configuration error is located the same way

`content-config.mjs` and `config.mjs` report every configuration check
through one `fail()`, which names the offending key's dotted path and knows
nothing about where in the file it was written.
`locateConfigError`, in `engine/pack-config.mjs`, is where the path becomes a
position: it turns the dotted field into a `keyPath` with `yamlKeyPath`, asks
`positionOfYamlPath` for that key's own declaration (`{ key: true }`), and
falls back one level to the **enclosing mapping** when the exact key has no
node of its own — a required key that is simply absent has nothing to point
at but the block it belongs in. A field one level deep with nothing above it
but the whole document gets no position at all, which is the same
drop-rather-than-guess rule applied one level higher.

This only runs against a YAML configuration. An `.mjs` configuration is
JavaScript, not data a YAML parser can be asked for a range in — feeding it
to one would not fail, since arbitrary JavaScript source routinely also
parses as _some_ YAML document, and the resulting position would point at a
line that has nothing to do with the key. A wrong position is worse than
none, so `positionInConfig` (the function behind `locateConfigError`) checks
the file extension first and returns `{}` for anything that is not
`.yaml`/`.yml`.

A configuration finding reads the same as any other:

```text
package-build.config.yaml:382:64: error: package-build config: `site.sections.being.descrption` is not a recognized option (expected one of: title, banner, description, listType, listSubType).
```

## Summary counts and prose are not findings

A run's progress and summary lines — `42 address(es) across 10 note(s).`,
`Formatting is clean (120 file(s)).`, `3 of 22 compared field pair(s)
disagree between the specification and the declaration that compiles them.`
— are not diagnostics and are never emitted through `emitDiagnostic`. They
carry no file, no position and nothing for a parser to act on; printing them
in the located form would be a lie about what is known; a machine reading the
findings has to skip them regardless, since they have no `file:line:column:`
prefix to key on. They go through this toolchain's ordinary `loglevel`
logger and keep whatever prefix that logger is configured with.

## Both severities go to stderr

`emitDiagnostic` writes both a `warning` and an `error` to `console.error`.
`console.warn` writes to `process.stderr` too — in Node it is simply another
name for `console.error` — so there is no separate warning stream to redirect
a build's findings away from its errors. Splitting warnings from errors, or
suppressing one severity, means reading the emitted `severity` field, not
picking which stream to listen on. A shell filter that assumes warnings land
on stdout and errors on stderr will see nothing on stdout and everything on
stderr, including every warning.

## Which commands exit non-zero

The rule that recurs everywhere a command reports diagnostics: **a run fails
when it reports at least one `error`-severity diagnostic. A `warning` alone
never fails a run.** `bin/report.mjs`'s `reportFindings` draws this line once
for the commands built from the package's pure rule functions (`content-build
lint`, `package-build lang check`, `package-build lang coverage`,
`package-build yaml`, `package-build labels check`): it emits every finding
and returns only the count whose `severity` is `error`, and the command sets
`process.exitCode = 1` exactly when that count is nonzero. Commands whose
findings are hand-assembled — `content-build links`, `content-build
reachability`, `content-build site`, `content-build package compile` — apply
the same rule by construction: everything they can report is a broken
address, a dead link or a document Foundry would silently drop a field from,
so every finding they emit is already `severity: "error"` and any finding at
all fails the run.

**A corpus problem always fails, regardless of severity or a `--strict`
flag.** When the content tree itself cannot be indexed — a note the walk
cannot record, most often a retired `package:` key — the note is absent from
every other answer a command gives. Reporting it and still exiting `0` would
call the tree clean while silently omitting a note, so every command that
indexes a corpus (`lint`, `links`, `reachability`, `content-format notes`,
`addresses diff`) fails on a corpus problem unconditionally, before it
evaluates anything else.

**A few commands report advisory findings that never fail the run on their
own**, and say so where they emit them: `content-format notes` measures a
content tree against the format specification as a progress report during a
migration, printing every finding as a `warning` and passing `--strict` to
promote a class to `error` only once that class has reached zero; `format`
reports where this repository's Prettier configuration diverges from the
shared convention as a `warning`, because a repository's own configuration
is allowed to win on purpose; `addresses diff` reports a withdrawn or renamed
published address as a `warning` by default and only as an `error` under
`--strict`, since retiring or renaming content is legitimate and the check
exists to make sure it was noticed, not to forbid it; `pdf` reports a
book-build finding but fails only when it could not build the book for a
reason that is not a deliberate no-op (an empty filter, an absent block); and
`lang coverage`'s unreferenced-key half is advisory without a way to promote
it — nothing can see every way a key might be reached, so failing a build
over one would teach people to stop reading the report.

| command                                          | fails when                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content-build lint [root]`                      | an address, frontmatter, schema, charset, icon or HTML finding is `error`-severity, or the corpus cannot be indexed                                                                                                                                                |
| `content-build content-format notes [root]`      | `--strict` was passed and it reported any finding (all findings are `error`-severity only under `--strict`), or the corpus cannot be indexed                                                                                                                       |
| `content-build content-format schema`            | it reports any finding at all                                                                                                                                                                                                                                      |
| `content-build content-format fields`            | it reports any finding at all                                                                                                                                                                                                                                      |
| `content-build links [root]`                     | it reports any finding at all, an index is unusable (a stale or unaddressable foreign manifest), or the corpus cannot be indexed                                                                                                                                   |
| `content-build reachability <dir> [file]`        | it reports any orphaned document, or the corpus cannot be indexed                                                                                                                                                                                                  |
| `content-build addresses diff --from <artifact>` | the corpus cannot be indexed (always); otherwise only with `--strict`, and only then are the address findings `error`-severity                                                                                                                                     |
| `content-build format [paths..]`                 | a file it checked is not formatted (or, under `--write`, could not be brought to a fixpoint) — never on a shared-convention divergence, which is always advisory                                                                                                   |
| `content-build markdown [paths..]`               | it reports any markdownlint finding                                                                                                                                                                                                                                |
| `content-build site`                             | any gate finding (no homepage, a wikilink in frontmatter, an address that cannot be derived, an unusable or unaddressable foreign manifest, a conflicting address) or any table or wikilink error while writing pages — the run stops at the first gate that fires |
| `content-build pdf`                              | it could not build the book for a reason other than a deliberate no-op — never on a reported finding by itself                                                                                                                                                     |
| `content-build docs item-fields --check`         | the generated page differs from what is committed                                                                                                                                                                                                                  |
| `content-build package compile`                  | pack JSON generation reported any `error`-severity finding (checked, and the compile refused, before any pack is written), or a compiled pack fails its Scene/Level integrity check                                                                                |
| `content-build deps fetch`                       | the fetch itself throws — it emits no diagnostics                                                                                                                                                                                                                  |
| `package-build lang check`                       | any localization finding is `error`-severity                                                                                                                                                                                                                       |
| `package-build lang coverage`                    | a referenced key is missing (`error`-severity); an unreferenced key is always advisory and never fails the run                                                                                                                                                     |
| `package-build yaml [paths..]`                   | any YAML finding is `error`-severity                                                                                                                                                                                                                               |
| `package-build labels check`                     | the label registry and the documented table disagree on any label                                                                                                                                                                                                  |

Every command in both binaries also fails on a thrown error unrelated to a
diagnostic — a missing configuration, an unreadable file, a network failure —
through the same `process.exitCode = 1` (or `process.exit(1)`), reported as
one line with no stack.

## A worked example

This parses a run's diagnostics the way a script or a CI step would: run the
command, capture stderr, turn each line into a record, and decide what to do
based on the `severity` field.

A command that emits a few diagnostics, using the same `emitDiagnostic` every
pass in this package calls:

```js
// emit.mjs
import { emitDiagnostic } from "@heroiclands/package-build/engine/diagnostics";

emitDiagnostic({
  file: "assets/content/Regions/Capital_Nome.md",
  line: 43,
  column: 635,
  severity: "error",
  message:
    "address [[place-kenbetpat]] resolves to no note — no package publishes it. " +
    "Fix the shortcode, or declare the package that does as a dependency and " +
    'run `content-build deps fetch` — in "The Capital Nome".',
});
emitDiagnostic({
  file: "assets/content/Regions/Capital_Nome.md",
  line: 12,
  severity: "warning",
  message: "`system.sohl.unemitted` is declared but no builder ever sets it",
});
emitDiagnostic({
  file: "assets/content/Regions/Capital_Nome.md",
  severity: "error",
  message: "duplicate frontmatter key `name` — the second declaration wins and the first is dead",
});

// A build's own summary line: prose, not a finding.
console.log("3 finding(s) across 1 note(s).");
```

A parser that runs it, reads its diagnostics off stderr, and reports the
split:

```js
// parse.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// `formatDiagnostic`'s own grammar, read backwards: the path is whatever
// comes before an optional `:line` and `:line:column`, then
// `severity: message`. A field the diagnostic dropped is simply absent from
// its capture group — never a guessed `1:1`.
const LOCATED =
  /^(?<file>[^:]+?)(?::(?<line>\d+))?(?::(?<column>\d+))?: (?<severity>warning|error): (?<message>.+)$/;

function parseDiagnostic(line) {
  const m = LOCATED.exec(line);
  if (!m) return null;
  const { file, line: ln, column, severity, message } = m.groups;
  return {
    file,
    ...(ln ? { line: Number(ln) } : {}),
    ...(column ? { column: Number(column) } : {}),
    severity,
    message,
  };
}

const child = spawn(process.execPath, [fileURLToPath(new URL("./emit.mjs", import.meta.url))]);
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += chunk));
await new Promise((resolve) => child.on("close", resolve));

const findings = stderr.split("\n").filter(Boolean).map(parseDiagnostic).filter(Boolean);
const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");

console.log(`${errors.length} error(s), ${warnings.length} warning(s):\n`);
for (const f of findings) {
  const where = f.file + (f.line ? `:${f.line}` + (f.column ? `:${f.column}` : "") : "");
  console.log(`[${f.severity}] ${where} — ${f.message}`);
}

process.exitCode = errors.length ? 1 : 0;
```

Running `node parse.mjs` prints:

```text
2 error(s), 1 warning(s):

[error] assets/content/Regions/Capital_Nome.md:43:635 — address [[place-kenbetpat]] resolves to no note — no package publishes it. Fix the shortcode, or declare the package that does as a dependency and run `content-build deps fetch` — in "The Capital Nome".
[warning] assets/content/Regions/Capital_Nome.md:12 — `system.sohl.unemitted` is declared but no builder ever sets it
[error] assets/content/Regions/Capital_Nome.md — duplicate frontmatter key `name` — the second declaration wins and the first is dead
```

and exits `1`, because it saw two `error`-severity diagnostics. The summary
line the emitting process printed to stdout, `3 finding(s) across 1
note(s).`, never reaches the parser at all — it was never on stderr, and the
regex would not have matched it if it had been.
