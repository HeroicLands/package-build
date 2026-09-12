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
 * The charset authored content is held to, so a book can choose its face (#377).
 *
 * The packs and the website render in whatever font the reader's browser or
 * Foundry supplies, and a glyph nobody has is somebody else's problem. **A book
 * is not that.** A PDF embeds the faces it sets, so every character in the
 * corpus is a claim on the book's typeface — and the claim is silent, which is
 * what makes it expensive.
 *
 * **Typst does not warn about a missing glyph.** It falls back to whatever
 * system font happens to carry one and exits 0. A single page asking for
 * Libertinus Serif was observed to embed six fonts — Libertinus, Geneva, Arial,
 * STSong, SF NS, and macOS LastResort, which draws a literal tofu box — with no
 * diagnostic of any kind. So a rules table can set in three unrelated faces and
 * the build still reports success. Nothing downstream will catch that; it has
 * to be caught where the character is written.
 *
 * **The tiers are measured, not chosen.** Eight candidate book faces were
 * probed over every non-ASCII character in the five content trees — Charis SIL,
 * Libertinus Serif, EB Garamond, Georgia, Palatino, Times New Roman, Hoefler
 * Text and Iowan Old Style — by setting one codepoint per page and reading back
 * which font each page actually embedded. What survives below is what enough of
 * them carry:
 *
 * - **Letters and typography: 8 of 8.** Punctuation is the safest thing in the
 *   corpus, which is worth saying because it looks exotic and is not: the em
 *   dash alone runs to 24,622 occurrences.
 * - **Latin Extended Additional: 7 of 8.** Only Hoefler Text lacks the
 *   dot-unders the transliterated notes are built on, and one face is a price
 *   worth paying for `Ādānaśreṇī`.
 * - **IPA Extensions: 5 of 8.** Considered for the allowlist and *rejected* —
 *   requiring it would have cost font freedom rather than bought it, which is
 *   the opposite of this module's purpose.
 *
 * **What is banned is banned by category, not by glyph**, because the next
 * emoji nobody has thought of yet should fail on arrival rather than after it
 * ships. The invisible characters are listed even though the corpus contains
 * none of them: a zero-width space or a bidi override is the one class of
 * defect a proofreader cannot see, and the moment to refuse it is before it
 * arrives.
 *
 * **Two rules an allowlist cannot express** ride along here:
 *
 * - Content must be **NFC**. Canonically-equivalent spellings are different
 *   strings to every byte comparison, and DuckDB's `=` is one — so a book leaf
 *   filtering `name.full = 'Fývria'` typed in NFC selects nothing from a note
 *   stored decomposed, and reports nothing, because a clause that matches *some*
 *   rows looks like a clause that worked.
 * - Diagram characters are permitted **inside a fenced code block only**, where
 *   the mono face sets them. Verified against DejaVu Sans Mono, which Typst
 *   embeds: it carries the box-drawing, geometric and arrow repertoire that no
 *   candidate serif reliably has.
 *
 * **Every finding here is a `warning`, and that is deliberate.** `reportFindings`
 * fails a run on an error and not on a warning, so nothing this module says can
 * break a build.
 *
 * A character outside the charset does not make a note wrong. It compiles to
 * the same document, publishes the same page, and reads correctly everywhere
 * except a book that does not exist yet — so failing a consumer's build over it
 * would stop work that is already correct in order to serve a renderer that is
 * still being written. The trees this shipped against had 112 findings between
 * them on the day it landed, all of them real and none of them urgent.
 *
 * The NFC rule is the one with a claim to being an error, since a decomposed
 * name is silently invisible to an exact-match filter. It is a warning too,
 * because a lint that fails a build for one of its rules and not the others is
 * a lint nobody can predict.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Tier 1 — the letters, and the two whitespace characters a file is made of.
 *
 * The Latin-1 range is split around `U+00D7` and `U+00F7` deliberately: `×` and
 * `÷` sit inside the letter block but are operators, and they are admitted
 * below in Tier 3 on their own merits rather than smuggled in as letters.
 *
 * @param {number} cp - A Unicode code point.
 * @returns {boolean} Whether Tier 1 admits it.
 */
export function isLetterTier(cp) {
    return (
        cp === 0x09 ||
        cp === 0x0a ||
        (cp >= 0x20 && cp <= 0x7e) || // ASCII printable
        (cp >= 0xc0 && cp <= 0xd6) || // Latin-1 letters, excluding ×
        (cp >= 0xd8 && cp <= 0xf6) || //   ... and excluding ÷
        (cp >= 0xf8 && cp <= 0xff) ||
        (cp >= 0x100 && cp <= 0x17f) || // Latin Extended-A
        (cp >= 0x180 && cp <= 0x24f) || // Latin Extended-B
        (cp >= 0x1e00 && cp <= 0x1eff) // Latin Extended Additional
    );
}

/**
 * Tier 2 — typography, enumerated one codepoint at a time.
 *
 * **Not the General Punctuation block.** `U+2000`–`U+206F` carries `U+200B`
 * ZERO WIDTH SPACE, the `U+200E`/`U+200F` direction marks, the `U+2028`/`U+2029`
 * separators, the `U+202A`–`U+202E` bidi overrides and `U+2060` WORD JOINER —
 * precisely the invisibles this charset exists to refuse. Admitting the block
 * to reach the em dash would admit all of them, so the ten that are wanted are
 * named and the block is not.
 *
 * @type {ReadonlySet<number>}
 */
export const TYPOGRAPHY = Object.freeze(
    new Set([
        0x2013, // – en dash
        0x2014, // — em dash
        0x2018, // ' left single quote
        0x2019, // ' right single quote / apostrophe
        0x201c, // " left double quote
        0x201d, // " right double quote
        0x2026, // … ellipsis
        0x00b7, // · middle dot
        0x00a7, // § section sign
        0x00b4, // ´ acute accent, as a character discussed in prose
    ]),
);

/**
 * Tier 3 — the notation the rules and price tables are written in.
 *
 * Every one of these is carried by seven or eight of the eight probed faces, so
 * the tier costs nothing in font freedom. It is a separate tier from the
 * typography above only because it is a separate argument: these earn their
 * place by being *needed* — a Shock threshold reads `≥ 10`, a wall is `10′ ×
 * 11′` — where the typography earns it by being unavoidable.
 *
 * @type {ReadonlySet<number>}
 */
export const NOTATION = Object.freeze(
    new Set([
        // Operators: − × ÷ ± °
        0x2212, 0x00d7, 0x00f7, 0x00b1, 0x00b0,
        // Relations: ≤ ≥ ≈ ∞
        0x2264, 0x2265, 0x2248, 0x221e,
        // Fractions and superscripts: ¼ ½ ¾ ² ³ ¹ ⁰ ⁴
        0x00bc, 0x00bd, 0x00be, 0x00b2, 0x00b3, 0x00b9, 0x2070, 0x2074,
        // Currency, legal marks and the prime pair: £ © ® ′ ″
        0x00a3, 0x00a9, 0x00ae, 0x2032, 0x2033,
    ]),
);

/**
 * Whether the charset admits a code point anywhere in a note.
 *
 * @param {number} cp - A Unicode code point.
 * @returns {boolean} Whether it is allowed outside a code fence.
 */
export function isAllowedCodePoint(cp) {
    return isLetterTier(cp) || TYPOGRAPHY.has(cp) || NOTATION.has(cp);
}

/**
 * Whether a code point is diagram furniture, admitted inside a fence only.
 *
 * A fenced block is set in the mono face, and the mono face is not the book
 * face — so the question "does the text font have this" is the wrong question
 * to ask about a character in an ASCII-art org chart. All three ranges were
 * confirmed present in DejaVu Sans Mono, the mono face Typst embeds.
 *
 * @param {number} cp - A Unicode code point.
 * @returns {boolean} Whether a fence may carry it.
 */
export function isDiagramCodePoint(cp) {
    return (
        (cp >= 0x2500 && cp <= 0x257f) || // box drawing
        (cp >= 0x25a0 && cp <= 0x25ff) || // geometric shapes
        (cp >= 0x2190 && cp <= 0x21ff) //   arrows
    );
}

/**
 * Why a given code point is refused, in the words a diagnostic should use.
 *
 * Ordered most specific first, so `U+FE0F` is reported as a variation selector
 * rather than as an unnamed character in a high plane. A range with no entry
 * falls through to a generic message: the list explains the categories the
 * corpus actually grew, and inventing prose for every unassigned block would be
 * guessing at a reason.
 *
 * @type {ReadonlyArray<{from: number, to: number, why: string}>}
 */
const REFUSALS = Object.freeze([
    { from: 0x0300, to: 0x036f, why: "a combining mark; write the precomposed letter instead" },
    {
        from: 0x0250,
        to: 0x02af,
        why: "IPA, which three of eight candidate book faces lack — describe the sound instead",
    },
    {
        from: 0x02b0,
        to: 0x02ff,
        why: "a spacing modifier or tone letter, carried by two of eight candidate book faces",
    },
    { from: 0x0370, to: 0x03ff, why: "Greek; spell the sound out rather than citing the letter" },
    {
        from: 0xa720,
        to: 0xa7ff,
        why: "Latin Extended-D, carried by one of eight candidate book faces",
    },
    {
        from: 0x2500,
        to: 0x257f,
        why: "box drawing, which is allowed inside a fenced code block and nowhere else",
    },
    {
        from: 0x25a0,
        to: 0x25ff,
        why: "a geometric shape, which is allowed inside a fenced code block and nowhere else",
    },
    { from: 0x2190, to: 0x21ff, why: "an arrow; write `>` for a menu path or a derivation" },
    {
        from: 0x2700,
        to: 0x27bf,
        why: "a dingbat, which no candidate book face carries — use the icon role",
    },
    {
        from: 0x2600,
        to: 0x26ff,
        why: "a miscellaneous symbol, which no candidate book face carries — use the icon role",
    },
    { from: 0x1f000, to: 0x1faff, why: "an emoji, which no book face sets — use the icon role" },
    { from: 0xfe00, to: 0xfe0f, why: "an invisible variation selector" },
    { from: 0xff00, to: 0xffef, why: "a fullwidth form; write the ASCII character" },
    {
        from: 0x2000,
        to: 0x206f,
        why: "an unlisted General Punctuation character, several of which are invisible",
    },
]);

/** Invisible characters named individually, because their reason is their name. */
const INVISIBLES = Object.freeze(
    new Map([
        [0x00a0, "a no-break space"],
        [0x00ad, "a soft hyphen"],
        [0xfeff, "a byte order mark"],
        [0x000d, "a carriage return; this tree uses LF line endings"],
    ]),
);

/**
 * The reason a code point is refused.
 *
 * @param {number} cp - A Unicode code point.
 * @returns {string} A clause naming what it is and what to do instead.
 */
export function refusalFor(cp) {
    const named = INVISIBLES.get(cp);
    if (named) return named;
    for (const { from, to, why } of REFUSALS) if (cp >= from && cp <= to) return why;
    return "outside the content charset";
}

/** `U+XXXX`, in the spelling every Unicode reference uses. */
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Every non-NFC run in a string, with the composed form it should have been.
 *
 * Reported as **runs** rather than as bare combining marks, because `y` plus
 * `U+0301` is one authoring mistake and pointing at the accent alone would name
 * the half the author did not type.
 *
 * @param {string} text - File contents.
 * @returns {Array<{sequence: string, composed: string, index: number}>} Each
 *   offending run, in the order it appears.
 */
export function decomposedRuns(text) {
    const out = [];
    for (const m of text.matchAll(/(\P{M})(\p{M}+)/gu)) {
        const sequence = m[0];
        const composed = sequence.normalize("NFC");
        if (composed === sequence) continue;
        out.push({ sequence, composed, index: m.index ?? 0 });
    }
    return out;
}

/**
 * Check one file's text against the charset and the normalization rule.
 *
 * Findings are **deduplicated per character per line**: a 60-cell table of
 * `━` is one mistake made once, and sixty findings would bury the other
 * fifty-nine things wrong with the tree.
 *
 * @param {string} text - The file's contents.
 * @param {string} file - Path to report, relative to the tree.
 * @returns {Array<{file: string, line: number, column: number,
 *   severity: "warning", message: string}>} What is wrong, in file order.
 */
export function checkText(text, file) {
    const findings = [];
    const runs = decomposedRuns(text);

    // A decomposed letter is one mistake. Its combining mark would otherwise be
    // refused by the charset *and* reported as a normalization error, which
    // tells the author twice and offers two different fixes for one edit. The
    // normalization finding wins because it names the precomposed replacement,
    // so the offsets its runs cover are struck from the character scan. A
    // combining mark that composes to nothing is in no run, and is still
    // refused below on its own account.
    const composedAway = new Set();
    for (const run of runs) {
        for (let k = 0; k < run.sequence.length; k++) composedAway.add(run.index + k);
    }

    const lines = text.split("\n");
    let inFence = false;
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = offset;
        offset += line.length + 1; // the newline `split` removed

        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }

        const reportedOnThisLine = new Set();
        let column = 0;
        let within = 0;
        for (const ch of line) {
            column += 1;
            const at = lineStart + within;
            within += ch.length;
            const cp = ch.codePointAt(0) ?? 0;
            if (isAllowedCodePoint(cp)) continue;
            if (composedAway.has(at)) continue;
            // Inside a fence the mono face sets the text, so the diagram
            // repertoire is judged against that font rather than the book's.
            if (inFence && isDiagramCodePoint(cp)) continue;
            if (reportedOnThisLine.has(cp)) continue;
            reportedOnThisLine.add(cp);

            findings.push({
                file,
                line: i + 1,
                column,
                severity: /** @type {const} */ ("warning"),
                message: `\`${ch}\` ${hex(cp)} is ${refusalFor(cp)}`,
            });
        }
    }

    // Normalization is a property of the whole file, so it is checked once
    // rather than per line — but reported at the run, which is where the fix is.
    for (const run of runs) {
        const before = text.slice(0, run.index);
        const line = before.split("\n").length;
        const column = run.index - (before.lastIndexOf("\n") + 1) + 1;
        const points = [...run.sequence].map((c) => hex(c.codePointAt(0) ?? 0)).join(" ");
        findings.push({
            file,
            line,
            column,
            severity: /** @type {const} */ ("warning"),
            message:
                `\`${run.sequence}\` is written decomposed as ${points}; write the ` +
                `precomposed \`${run.composed}\` (${[...run.composed]
                    .map((c) => hex(c.codePointAt(0) ?? 0))
                    .join(" ")}) — the two are the same letter and different strings, ` +
                `so an exact-match filter finds one and not the other`,
        });
    }

    return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Walk a content tree and check every authored file in it.
 *
 * Dot-directories are skipped: `.obsidian` carries editor state, and a plugin
 * manifest's CRLF line endings are not this tree's prose. That is not a
 * theoretical exclusion — it was the first thing a run over `sohl-thalorna`
 * reported before the skip existed.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore
 *   in addition to the dot-directories always skipped.
 * @param {readonly string[]} [opts.extensions] - File extensions to read.
 * @returns {{findings: Array<{file: string, line: number, column: number,
 *   severity: "warning", message: string}>, files: number}} The findings, and how
 *   many files produced them.
 */
export function lintContentCharset(contentBase, { skipDirectories = [], extensions } = {}) {
    const exts = new Set(extensions ?? [".md", ".markdown", ".yaml", ".yml", ".json"]);
    const skip = new Set(skipDirectories);
    /** @type {Array<{file: string, line: number, column: number, severity: "warning", message: string}>} */
    const findings = [];
    let files = 0;

    /** @param {string} dir - Directory to descend into. */
    const walk = (dir) => {
        /** @type {import("node:fs").Dirent[]} */
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!exts.has(path.extname(entry.name).toLowerCase())) continue;
            let text;
            try {
                text = fs.readFileSync(full, "utf8");
            } catch {
                continue;
            }
            files += 1;
            findings.push(...checkText(text, path.relative(contentBase, full)));
        }
    };

    walk(contentBase);
    return { findings, files };
}
