/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Build diagnostics that name the file, line and column they are about.
 *
 * A build that reports a problem by the **note's name** — `Unresolved wikilink
 * in "The Capital Nome"` — has told the author what is wrong and not where it
 * is. A name is not an address: finding it means searching the tree for a note
 * whose `name.full` matches and then searching that file for the link, and
 * four identical warnings on one note are indistinguishable from one another.
 *
 * So every diagnostic about a note is emitted in the form every C-family
 * compiler, `tsc` and ESLint already use:
 *
 * ```text
 * assets/content/Nomes/Capital.md:42:17: warning: unresolved wikilink [[Kenbet_Pat]] (unknown)
 * ```
 *
 * `file:line:column: severity: message`. Nothing here is invented, which is
 * the point: an editor, a CI annotator or a `grep` already parses it, with no
 * knowledge of this build and nothing extra for it to emit.
 *
 * **Two rules keep the form parseable.**
 *
 * - _The locator starts the line._ Diagnostics deliberately bypass `loglevel`,
 *   whose `[timestamp] [WARN]:` prefix occupies exactly the position a parser
 *   reads the path from — a greedy path pattern swallows the prefix and yields
 *   a filename no editor can open.
 * - _A field is dropped, never guessed._ A position that cannot be established
 *   honestly is omitted (`file: warning: …`) rather than defaulted to `1:1`,
 *   which would send a reader to the frontmatter every time.
 */

import fs from "node:fs";
import path from "node:path";
import YAML, { LineCounter } from "yaml";

/**
 * Split opening YAML frontmatter from its untrimmed body without parsing it.
 * LF and CRLF delimiters retain the exact source strings and their offsets.
 * @param {string} raw - Complete Markdown source.
 * @returns {{yaml: string, body: string}|null} Source slices, or no fence.
 */
export function splitFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
    return match ? { yaml: match[1], body: match[2] } : null;
}

/**
 * The `file:line:column` locator, with whatever is known.
 *
 * The path is relativized against the working directory — during a build that
 * is the consuming repository's root, so the result is both shorter to read
 * and what an editor resolves a relative diagnostic against. A path outside
 * the tree stays absolute, since a `../../..` locator helps nobody.
 *
 * @param {object} at
 * @param {string} [at.file] - Absolute or relative path to the source file.
 * @param {number} [at.line] - 1-based line.
 * @param {number} [at.column] - 1-based column. Ignored without a line.
 * @returns {string} The locator, or `""` when not even a file is known.
 */
export function formatLocator({ file, line, column } = {}) {
    if (!file) return "";
    let shown = file;
    if (path.isAbsolute(file)) {
        const rel = path.relative(process.cwd(), file);
        // `..` means the file sits outside the working directory; an absolute
        // path is the more useful of the two there.
        if (rel && !rel.startsWith("..")) shown = rel;
    }
    if (!Number.isFinite(line)) return shown;
    if (!Number.isFinite(column)) return `${shown}:${line}`;
    return `${shown}:${line}:${column}`;
}

/**
 * One diagnostic, as a parseable line.
 *
 * @param {object} d
 * @param {string} [d.file] - Source file the diagnostic is about.
 * @param {number} [d.line] - 1-based line.
 * @param {number} [d.column] - 1-based column.
 * @param {"warning"|"error"} d.severity - Which of the two levels this is.
 * @param {string} d.message - What is wrong, in one sentence.
 * @returns {string} `file:line:column: severity: message`, with any unknown
 *   leading field omitted.
 */
export function formatDiagnostic({ file, line, column, severity, message }) {
    const locator = formatLocator({ file, line, column });
    return `${locator ? `${locator}: ` : ""}${severity}: ${message}`;
}

/**
 * Prints one diagnostic on the console, unprefixed.
 *
 * **Both severities go to stderr**, which is what keeps findings clear of the
 * progress and summary prose a build writes to stdout. That is Node's doing,
 * not a choice made here: `console.warn` is an alias for `console.error` and
 * writes to `process.stderr`, so the two branches below differ only in which
 * severity word the line carries, never in the stream.
 *
 * Saying otherwise has already cost something — an earlier version of this
 * comment claimed warnings went to stdout, and a consumer wrote a whole
 * local wrapper to obtain the stderr routing it already had. Anything relying
 * on the separation should split on the `severity` field, not on the stream.
 *
 * This deliberately sidesteps `loglevel`, for the reason given in the module
 * docs.
 *
 * @param {object} d - As {@link formatDiagnostic}.
 * @returns {void}
 */
export function emitDiagnostic(d) {
    const line = formatDiagnostic(d);
    if (d.severity === "error") console.error(line);
    else console.warn(line);
}

/**
 * Where a character offset within a note's **body** falls in its **file**.
 *
 * Three corrections separate the two, and each is applied only where it is
 * true:
 *
 * 1. _The frontmatter._ A body offset is not a file line until the lines
 *    before the body are added — `bodyLine`.
 * 2. _The trimmed first line._ `parseMarkdownFile` trims the body, so its
 *    first line may have lost indentation the file still has. `bodyColumn`
 *    restores it, and only on that line.
 * 3. _Generated text._ A body is scanned **after** its content tables expand,
 *    so an offset may fall in text no one authored. `lineMap` maps each
 *    scanned line back to the line it came from; a generated line reports the
 *    directive that produced it and **no column**, since there is no authored
 *    character to point at.
 *
 * @param {string} body - The text the offset indexes into.
 * @param {number} offset - 0-based character offset within `body`.
 * @param {object} [opts]
 * @param {number} [opts.bodyLine=1] - 1-based file line of the body's line 0.
 * @param {number} [opts.bodyColumn=1] - 1-based file column of the body's
 *   first character.
 * @param {Array<{line: number, generated: boolean}>} [opts.lineMap] - Per
 *   scanned line, the 0-based body line it came from. From
 *   {@link expandContentTables}.
 * @returns {{line: number, column: number|undefined, generated: boolean}}
 */
export function positionInBody(body, offset, { bodyLine = 1, bodyColumn = 1, lineMap } = {}) {
    const upTo = String(body ?? "").slice(0, Math.max(0, offset));
    const nl = upTo.lastIndexOf("\n");
    const scannedLine = upTo.length === 0 ? 0 : upTo.split("\n").length - 1;
    const column = upTo.length - nl; // 1-based: offset - (nl + 1) + 1

    const mapped = lineMap?.[scannedLine];
    const sourceLine = mapped ? mapped.line : scannedLine;
    const generated = mapped ? mapped.generated : false;

    return {
        line: bodyLine + sourceLine,
        // A generated line has no authored column, and the first line's
        // column is the only one the trim can have moved.
        column:
            generated ? undefined
            : sourceLine === 0 ? bodyColumn + column - 1
            : column,
        generated,
    };
}

/**
 * Where a **frontmatter key** is declared in a note's file.
 *
 * {@link positionInBody} answers the same question for the body, and the two
 * are separate because the body is what the compilers scan while frontmatter is
 * what the linters read — a key sits *before* the body, so a body offset can
 * never reach it.
 *
 * The search is deliberately scoped to the frontmatter block rather than run
 * over the whole file. A bare search for the key would match the first place
 * the word appears anywhere, which for a key like `name` or `type` is routinely
 * a line of prose — sending the reader to a position that is not the problem,
 * which is the one thing the located form exists to prevent.
 *
 * The key match tolerates leading whitespace by default, so a nested key of the
 * same name answers when no top-level one is present — which is usually what a
 * reader wants, the key being unique in nearly every note. Pass `topLevel` where
 * it is not: a finding about a top-level key must never open on a nested key
 * of the same name.
 *
 * @param {string} raw - The file's full contents, frontmatter included.
 * @param {string} key - The top-level frontmatter key.
 * @param {string} [value] - When given, prefer the occurrence whose line also
 *   carries this text. A list-valued key (`aliases`) is reported at the entry
 *   that is wrong, not at the key that introduces it.
 * @param {object} [options] - Options.
 * @param {boolean} [options.topLevel=false] - Require the key at column 1, so
 *   an identically named nested key cannot answer for it.
 * @returns {{line?: number, column?: number}} Spreadable position fields, empty
 *   when the key cannot be located — dropped rather than guessed, as
 *   {@link formatDiagnostic} requires.
 */
export function positionInFrontmatter(raw, key, value = undefined, { topLevel = false } = {}) {
    if (typeof raw !== "string" || !key) return {};
    const fence = splitFrontmatter(raw);
    if (!fence) return {};
    const block = fence.yaml;
    const lines = block.split("\n");

    // A value locates the exact entry; the key alone locates its declaration.
    const wanted = value == null ? undefined : String(value);
    let keyLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (wanted != null && lines[i].includes(wanted)) {
            keyLine = i;
            break;
        }
        if (
            keyLine === -1 &&
            new RegExp(`^${topLevel ? "" : "\\s*"}${escape(key)}\\s*:`).test(lines[i])
        ) {
            keyLine = i;
            if (wanted == null) break;
        }
    }
    if (keyLine === -1) return {};

    const needle = wanted != null ? wanted : key;
    const column = lines[keyLine].indexOf(needle);
    return {
        // +2: the file's line 1 is the opening `---`, so the block's line 0 is
        // the file's line 2.
        line: keyLine + 2,
        ...(column === -1 ? {} : { column: column + 1 }),
    };
}

/**
 * A frontmatter key's position in a note's file, or nothing.
 *
 * {@link positionInFrontmatter} answers the same question from the file's
 * *text*; this reads the file to ask it.
 *
 * @param {string|undefined} absPath - The note's file.
 * @param {string} key - The frontmatter key.
 * @param {string} [value] - When given, prefer the occurrence whose line also
 *   carries this text — so a finding about one entry of a block opens on that
 *   entry rather than on the key that introduces it.
 * @param {object} [options] - Options, forwarded to
 *   {@link positionInFrontmatter}.
 * @param {boolean} [options.topLevel=false] - Require the key at column 1, so
 *   an identically named nested key cannot answer for it.
 * @param {string} [options.raw] - Source text already read by the caller.
 * @returns {{line?: number, column?: number}|undefined} Spreadable position
 *   fields, dropped rather than guessed when the file cannot be read or the key
 *   cannot be found — as `formatDiagnostic` requires.
 */
export function locateFrontmatterKey(
    absPath,
    key,
    value = undefined,
    { topLevel = false, raw } = {},
) {
    if (!absPath && raw === undefined) return undefined;
    try {
        raw ??= fs.readFileSync(absPath, "utf8");
    } catch {
        return undefined;
    }
    const at = positionInFrontmatter(raw, key, value, { topLevel });
    return at.line === undefined ? undefined : at;
}

/** Escape a literal for use inside a `RegExp`. */
function escape(literal) {
    return String(literal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where a literal sits in a text, so a finding about it can be opened.
 *
 * {@link positionInBody} maps an offset within a parsed note body, and
 * {@link positionInFrontmatter} finds a key in the fence. This is the plainer
 * case: a finding about a string the reader can see in a file that is neither —
 * a manifest, a lockfile, a config.
 *
 * `@heroiclands/package-build` carries the same arithmetic for the files *it*
 * reads. That is a duplicate worth naming: unlike the diagnostic *format* or a
 * validation *rule*, "which line and column is this substring on" has exactly
 * one correct answer and cannot drift into disagreement. The tidier arrangement
 * is for that package to re-export this one — the dependency runs that way — and
 * it should, next time either is touched.
 *
 * @param {string} text - The file's contents.
 * @param {string} needle - The literal to locate.
 * @param {number} [occurrence] - Which occurrence, 1-based. Repeats of one
 *   literal are otherwise indistinguishable.
 * @returns {{line?: number, column?: number}} Spreadable position fields, empty
 *   when the literal is not there — dropped rather than guessed.
 */
export function positionOfLiteral(text, needle, occurrence = 1) {
    if (typeof text !== "string" || !needle) return {};
    let at = -1;
    for (let n = 0; n < occurrence; n++) {
        at = text.indexOf(needle, at + 1);
        if (at === -1) return {};
    }
    const before = text.slice(0, at);
    return {
        line: before.split("\n").length,
        column: at - before.lastIndexOf("\n"),
    };
}

/** The most recently located text; retaining one document bounds memory. */
let locatedYaml;

/**
 * Where a **key or value in a YAML document** sits, addressed by its path.
 *
 * {@link positionOfLiteral} is the plain search, and it is the wrong tool for a
 * configuration file: a pack name like `items` or `actors` appears in the
 * `packs:` block, in a folder's list, in a path, and often in prose, so the
 * first occurrence is routinely not the one the finding is about — which is the
 * one thing the located form exists to prevent.
 *
 * A path resolves the exact node. The most recently located text retains its
 * document and line counter, so several findings in one note share a parse.
 * A different text replaces that entry, including an edited copy of the same
 * file. The loader returns plain data without source ranges.
 *
 * Every failure — unparseable text, an `.mjs` configuration, a path that
 * resolves to nothing — yields `{}`, so a caller spreads the result and the
 * position is dropped rather than guessed.
 *
 * **`key: true` addresses the declaration rather than the value.** A finding
 * about a *value* — this pack name is not in `packs[]` — belongs on the value,
 * which is the default. A finding that names a **field** — `\`site.notfound.x\`
 * is not a recognized option` — sends the reader to look for that field, so the
 * position should be the field's own, and in a flow mapping
 * (`{ title: X, banner: Y }`) the two are different columns on one line. The
 * key's node is found through the same parse, so this stays one locator rather
 * than a second one free to disagree with it.
 *
 * @param {string} text - The document's contents.
 * @param {ReadonlyArray<string|number>} keyPath - Path to the node: map keys as
 *   strings, sequence entries as numbers.
 * @param {object} [opts]
 * @param {boolean} [opts.key=false] - Report where the last segment is
 *   *declared* rather than where its value sits. Ignored for a sequence entry,
 *   which has no key.
 * @returns {{line?: number, column?: number}} Spreadable position fields.
 */
export function positionOfYamlPath(text, keyPath, { key = false } = {}) {
    if (typeof text !== "string" || !text) return {};
    if (!Array.isArray(keyPath) || keyPath.length === 0) return {};

    let node;
    let counter;
    try {
        if (locatedYaml?.text !== text) {
            const lineCounter = new LineCounter();
            const doc = YAML.parseDocument(text, { lineCounter });
            locatedYaml = { text, doc, counter: lineCounter };
        }
        const { doc } = locatedYaml;
        counter = locatedYaml.counter;
        // `keepScalar` returns the Scalar node rather than its value, which is
        // the only form carrying a range.
        node = doc.getIn(keyPath, true);
        if (key && node !== undefined) {
            const last = keyPath[keyPath.length - 1];
            const parent =
                keyPath.length === 1 ? doc.contents : doc.getIn(keyPath.slice(0, -1), true);
            const pair = parent?.items?.find?.(
                (item) => item?.key != null && String(item.key.value) === String(last),
            );
            if (pair?.key?.range) node = pair.key;
        }
    } catch {
        return {};
    }

    const start = node?.range?.[0];
    if (!Number.isFinite(start)) return {};
    const { line, col } = counter.linePos(start);
    return { line, column: col };
}

/**
 * The YAML key path a **dotted field path** addresses.
 *
 * Configuration checks report the offending key as the path a reader would
 * write it — `packs[1].name`, `site.notfound.links[0].url` — because that
 * is what the message has to say. {@link positionOfYamlPath} addresses a node
 * by segments instead, so this is the one translation between them: `.`
 * separates map keys, and a bracketed suffix is a sequence index.
 *
 * A path this cannot parse yields `[]`, which {@link positionOfYamlPath} in
 * turn resolves to no position — dropped rather than guessed, as everything
 * else here is.
 *
 * @param {string} field - The dotted path, as a diagnostic spells it.
 * @returns {Array<string|number>} Its segments, sequence indices as numbers.
 */
export function yamlKeyPath(field) {
    if (typeof field !== "string" || field === "") return [];
    /** @type {Array<string|number>} */
    const segments = [];
    for (const segment of field.split(".")) {
        const parsed = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
        // Anything else is not a path this understands — a key holding a `[`,
        // or a dot inside a key. Refuse the whole path rather than resolve
        // part of it to a node that is not the one named.
        if (!parsed) return [];
        if (parsed[1] !== "") segments.push(parsed[1]);
        for (const index of parsed[2].matchAll(/\[(\d+)\]/g)) {
            segments.push(Number(index[1]));
        }
    }
    return segments;
}

/**
 * The scalar a note's frontmatter states at a path, **as the author wrote it**.
 *
 * A check reads a note whose Addresses are already resolved to their canonical
 * form, so a finding quoting the value it holds would quote text the file does
 * not contain. This reads the file instead, through the same parse
 * {@link positionOfYamlPath} uses.
 *
 * @param {string} raw - The note's full contents, frontmatter included.
 * @param {ReadonlyArray<string|number>} keyPath - Path to the node, from the
 *   top of the frontmatter.
 * @returns {string|number|boolean|undefined} The scalar, or `undefined` where
 *   the path names no scalar.
 */
export function frontmatterValueAt(raw, keyPath) {
    if (typeof raw !== "string" || !Array.isArray(keyPath) || keyPath.length === 0)
        return undefined;
    const fence = splitFrontmatter(raw);
    if (!fence) return undefined;
    try {
        const node = YAML.parseDocument(fence.yaml).getIn(keyPath, true);
        const value = node?.value;
        return ["string", "number", "boolean"].includes(typeof value) ? value : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Where a key sits **inside a note's frontmatter fence**, addressed by path.
 *
 * {@link positionInFrontmatter} searches the fence for a key by name, which is
 * the right tool while a note's vocabulary is flat: a key appears once and the
 * first line matching it is the one. It stops being the right tool the moment
 * the same name is legal in two regions — `data.weight` and a top-level
 * `weight` are different keys, and a search finds whichever comes first.
 *
 * So this is the located form for the closed regions. It reuses
 * {@link positionOfYamlPath} rather than repeating its parse, which is what
 * keeps a finding about `data.weight` pointing at `data.weight`.
 *
 * @param {string} raw - The note's full contents, frontmatter included.
 * @param {ReadonlyArray<string|number>} keyPath - Path to the node, from the
 *   top of the frontmatter.
 * @param {object} [opts]
 * @param {boolean} [opts.key=false] - Report where the last segment is
 *   *declared* rather than where its value sits.
 * @returns {{line?: number, column?: number}} Spreadable position fields, empty
 *   when there is no fence or the path resolves to nothing — dropped rather
 *   than guessed.
 */
export function positionOfFrontmatterPath(raw, keyPath, { key = false } = {}) {
    if (typeof raw !== "string") return {};
    const fence = splitFrontmatter(raw);
    if (!fence) return {};
    const position = positionOfYamlPath(fence.yaml, keyPath, { key });
    // +1: the fence's line 1 is the file's line 2, the opening `---` being the
    // first. `positionOfYamlPath` already counts from 1 within the block.
    return position.line === undefined ? {} : { ...position, line: position.line + 1 };
}
