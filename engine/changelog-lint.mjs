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
 * Lint release prose — a pending changeset, or the release section a
 * **Version Packages** branch is about to publish — against the rules a
 * changelog entry is actually held to.
 *
 * **Why this exists.** A changeset answers one question: *who notices, and
 * what do they see?* Nothing enforced that, so a pull-request description
 * pasted into one ships verbatim as a release note — commit hashes, issue
 * numbers, code fences, byte counts and "Verified" paragraphs, all of it
 * meant for a reviewer and none of it for someone deciding whether to
 * upgrade. Every rule here names one way that happens and says what to write
 * instead.
 *
 * **Where the text comes from is the caller's job.** This module lints a
 * *section* of prose — the pending-changeset body with its frontmatter fence
 * stripped, or the first `## <version>` section of a generated
 * `CHANGELOG.md` — and reports every finding at the line it actually falls on
 * in the file the caller read, via the `startLine` each entry point takes.
 *
 * **Code is found the same way a rewriter finds it** —
 * {@link module:engine/code-fences.codeRegions}, not a second fence scanner —
 * because a fenced sample, a verbatim path and a backticked literal must never
 * be misread as the violation they merely *contain*.
 *
 * @module
 */

import { codeRegions } from "./code-fences.mjs";

/** The generated scaffold `content-build`/Changesets writes, never authored prose. */
const RELEASE_HEADING_RE = /^## /;
const CHANGES_HEADING_RE = /^### (?:Major|Minor|Patch) Changes\s*$/;

/** A top-level bullet: a hyphen at column 0. Never indented — that is a nested list. */
const TOP_BULLET_RE = /^-\s+/;
/** A list item indented under something else. */
const NESTED_BULLET_RE = /^[ \t]+[-*+]\s+/;

/** A bold label opening a block at column 0: `**Compendiums**`. */
const LABEL_LINE_RE = /^\*\*([^*]+)\*\*/;

/** A commit-hash prefix: `- abc1234: …`, or a bare hex token opening the bullet. */
const COMMIT_HASH_RE = /^-\s+([0-9a-fA-F]{7,40})(?=[:\s]|$)/;

/**
 * An issue or pull-request reference: `#123`, `owner/repo#123`.
 *
 * No leading `\b` — `#` is not a word character, so a boundary assertion
 * immediately before it never matches the ordinary case of a bare `#123`
 * preceded by whitespace or punctuation.
 */
const ISSUE_REF_RE = /(?:[\w.-]+\/[\w.-]+)?#\d+\b/g;

/** A paragraph or bullet headed by a verification word, bold or plain. */
const VERIFY_HEADING_RE =
    /^(?:[-*+]\s+)?(?:\*\*|__)?(Verification|Verified|Bump|What was run|Commands)(?:\*\*|__)?(?=[\s:.]|$)/i;

/** The five scoreboard shapes a release note carries when it is really a test log. */
const SCOREBOARD_PATTERNS = [
    { re: /\bbyte-identical\b/gi, phrase: "byte-identical" },
    { re: /\b\d+\s+files?\b/gi, phrase: "an N files count" },
    { re: /\b\d+\s+tests?\s+pass(?:ed|ing)?\b/gi, phrase: "an N tests pass count" },
    { re: /\b\d+\s*→\s*\d+\b/g, phrase: "an N → M tally" },
    { re: /[+＋]\d+\s*\/\s*[−–-]\d+/g, phrase: "a +N / −M tally" },
];

/** A token that reads as code but sits outside any code span — warning only. */
const CODE_TOKEN_RE =
    /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*(?:\(\))?\b|\b[\w-]+(?:\/[\w-]+)+\.[A-Za-z]{1,8}\b|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Bullets over this many words read as a paragraph, not a release note. */
const MAX_BULLET_WORDS = 40;
/** Bullets over this many read as an itemized log, not "who notices". */
const MAX_TOP_BULLETS = 15;
/** Lines over this many read as a pull-request description. */
const MAX_SECTION_LINES = 60;

/**
 * Where a character offset in `text` falls, as a 1-based line and column.
 *
 * @param {string} text - The text the offset indexes into.
 * @param {number} index - 0-based character offset.
 * @returns {{line: number, column: number}}
 */
export function lineColOf(text, index) {
    const before = text.slice(0, Math.max(0, index));
    const nl = before.lastIndexOf("\n");
    return { line: before.split("\n").length, column: index - nl };
}

/**
 * Every code region in `text`, as a set of 1-based line numbers it spans.
 *
 * Block-level only (`spans: false`): an inline code span does not remove a
 * whole line from consideration, only the characters it covers, which the
 * text-scanning rules mask separately.
 *
 * @param {string} text - The section text.
 * @returns {Set<number>} Lines that fall inside a fenced or indented block.
 */
export function codeLineSet(text) {
    const lines = new Set();
    for (const region of codeRegions(text, { spans: false })) {
        const from = lineColOf(text, region.start).line;
        const to = lineColOf(text, Math.max(region.start, region.end - 1)).line;
        for (let l = from; l <= to; l++) lines.add(l);
    }
    return lines;
}

/**
 * Is this character offset inside a code region — block or inline span?
 *
 * @param {Array<{start: number, end: number}>} regions - Sorted, from
 *   {@link module:engine/code-fences.codeRegions}.
 * @param {number} offset - A character offset into the text the regions were
 *   computed against.
 * @returns {boolean}
 */
function isMasked(regions, offset) {
    for (const region of regions) {
        if (offset < region.start) return false;
        if (offset < region.end) return true;
    }
    return false;
}

/**
 * The finding one rule reports, before its line is mapped into the caller's
 * file.
 *
 * @typedef {object} RelativeFinding
 * @property {number} line - 1-based line within the section text.
 * @property {number} [column] - 1-based column, dropped when not meaningful.
 * @property {"error"|"warning"} severity
 * @property {string} message - Prefixed `changelog-check/<class> `, so a
 *   finding names the rule it tripped as well as what to write instead.
 */

/**
 * The opening line of every fenced code block — not an indented one, which
 * reads as a sample and not as a pasted terminal transcript.
 *
 * @param {string} text - Section text.
 * @returns {RelativeFinding[]}
 */
function checkCodeFences(text) {
    const lines = text.split("\n");
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (const region of codeRegions(text, { spans: false })) {
        const { line } = lineColOf(text, region.start);
        if (!/^[ \t]*(`{3,}|~{3,})/.test(lines[line - 1])) continue; // an indented block, not a fence
        findings.push({
            line,
            severity: "error",
            message:
                "changelog-check/code-fence a fenced code block reads like a pull-request " +
                "description, not a release note — describe what a user sees in prose",
        });
    }
    return findings;
}

/**
 * Every top-level bullet, as its own contiguous run of lines.
 *
 * A bullet's continuation — a wrapped line, a second paragraph, a nested
 * elaboration — is indented under it and belongs to it; a line back at
 * column 0 that is not itself a bullet (a bold subsection label, ordinary
 * prose) closes it.
 *
 * @param {string} text - Section text.
 * @param {Set<number>} codeLines - Lines inside a code region, from
 *   {@link codeLineSet}.
 * @returns {Array<{startLine: number, text: string}>}
 */
export function topLevelBullets(text, codeLines) {
    const lines = text.split("\n");
    /** @type {Array<{startLine: number, text: string}>} */
    const bullets = [];
    /** @type {{startLine: number, parts: string[]}|null} */
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const raw = lines[i];

        if (codeLines.has(lineNo)) {
            if (current) current.parts.push(raw);
            continue;
        }
        if (TOP_BULLET_RE.test(raw)) {
            if (current)
                bullets.push({ startLine: current.startLine, text: current.parts.join("\n") });
            current = { startLine: lineNo, parts: [raw] };
            continue;
        }
        if (/^[ \t]+\S/.test(raw) || raw.trim() === "") {
            if (current) current.parts.push(raw);
            continue;
        }
        // Column 0, not a bullet: a bold subsection label or a scaffold
        // heading closes whatever bullet was open — pushed here, or it is
        // lost rather than merely closed.
        if (current) bullets.push({ startLine: current.startLine, text: current.parts.join("\n") });
        current = null;
    }
    if (current) bullets.push({ startLine: current.startLine, text: current.parts.join("\n") });
    return bullets;
}

/**
 * Every top-level block of release prose — one rendered changeset entry, or
 * one unlabelled paragraph standing in for one.
 *
 * `@heroiclands/package-build/changelog` (`changelog.cjs`) writes a
 * changeset's whole summary as one block, verbatim, so a block here holds
 * together the same way that summary is authored: a bold label opening a
 * line at column 0 (`**Compendiums**`) starts a new block, and — unlike
 * {@link topLevelBullets}, where a bullet marker *is* the top-level
 * construct — a `-` bullet at column 0 belongs to whatever block is
 * already open, since a label's bullets sit unindented directly under it.
 * Any other column-0 line (plain prose with no label, a bullet with no
 * block open yet) starts the one "lead" block (`label: null`) a changeset
 * with no category writes — the case `changelog group` sorts first and
 * `check` never flags. Nested detail — a wrapped line, a bullet's own
 * continuation — stays indented and belongs to whatever it follows.
 * `changelog group` folds same-label blocks together; `check` warns when a
 * block's label is not in the declared vocabulary.
 *
 * @param {string} text - Section text.
 * @param {Set<number>} codeLines - Lines inside a code region, from
 *   {@link codeLineSet}.
 * @param {Set<number>} [scaffoldLines] - Generated heading lines that close
 *   whatever block is open without starting one, from
 *   {@link scaffoldLineSet} — empty for a caller that already isolated one
 *   `### <Bump> Changes` body, since no heading falls inside it.
 * @returns {Array<{startLine: number, label: string|null, text: string}>}
 */
export function topLevelBlocks(text, codeLines, scaffoldLines = new Set()) {
    const lines = text.split("\n");
    /** @type {Array<{startLine: number, label: string|null, text: string}>} */
    const blocks = [];
    /** @type {{startLine: number, label: string|null, parts: string[]}|null} */
    let current = null;
    const close = () => {
        if (current)
            blocks.push({
                startLine: current.startLine,
                label: current.label,
                text: current.parts.join("\n"),
            });
        current = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const raw = lines[i];

        if (codeLines.has(lineNo)) {
            if (current) current.parts.push(raw);
            continue;
        }
        if (scaffoldLines.has(lineNo)) {
            close();
            continue;
        }
        const atColumnZero = raw.trim() !== "" && !/^[ \t]/.test(raw);
        if (!atColumnZero) {
            if (current) current.parts.push(raw);
            continue;
        }
        const label = LABEL_LINE_RE.exec(raw)?.[1] ?? null;
        if (label !== null) {
            close();
            current = { startLine: lineNo, label, parts: [raw] };
            continue;
        }
        if (TOP_BULLET_RE.test(raw) && current) {
            current.parts.push(raw);
            continue;
        }
        close();
        current = { startLine: lineNo, label: null, parts: [raw] };
    }
    close();
    return blocks;
}

/**
 * A bullet's word count, the bullet marker and markdown decoration stripped.
 *
 * @param {string} bulletText - As {@link topLevelBullets} collects it.
 * @returns {number}
 */
function wordCount(bulletText) {
    return bulletText.replace(TOP_BULLET_RE, "").split(/\s+/).filter(Boolean).length;
}

/**
 * A commit hash opening a bullet — the artefact a changeset generator that is
 * not `@changesets/cli/changelog` writes on every entry.
 *
 * @param {string} text - Section text.
 * @param {Set<number>} codeLines
 * @param {Set<number>} scaffoldLines
 * @returns {RelativeFinding[]}
 */
function checkCommitHash(text, codeLines, scaffoldLines) {
    const lines = text.split("\n");
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        if (codeLines.has(lineNo) || scaffoldLines.has(lineNo)) continue;
        const m = COMMIT_HASH_RE.exec(lines[i]);
        if (!m) continue;
        findings.push({
            line: lineNo,
            column: lines[i].indexOf(m[1]) + 1,
            severity: "error",
            message:
                "changelog-check/commit-hash a commit hash is a commit-log artefact; the " +
                "changelog generator should not write one — set `changelog` to " +
                "`@changesets/cli/changelog`",
        });
    }
    return findings;
}

/**
 * An issue or pull-request reference, wherever it appears outside code.
 *
 * @param {string} text - Section text.
 * @param {Array<{start: number, end: number}>} maskedRegions
 * @returns {RelativeFinding[]}
 */
function checkIssueReferences(text, maskedRegions) {
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (const m of text.matchAll(ISSUE_REF_RE)) {
        if (isMasked(maskedRegions, m.index)) continue;
        const { line, column } = lineColOf(text, m.index);
        findings.push({
            line,
            column,
            severity: "error",
            message:
                `changelog-check/issue-reference "${m[0]}" is an issue or pull-request ` +
                "reference — that belongs on the pull request's own `Closes #<n>` line, " +
                "not the changelog; a released package has no tracker for its reader to open",
        });
    }
    return findings;
}

/**
 * A paragraph or bullet whose first words announce how the change was
 * verified, rather than what it does.
 *
 * @param {string} text - Section text.
 * @param {Set<number>} codeLines
 * @returns {RelativeFinding[]}
 */
function checkVerificationParagraphs(text, codeLines) {
    const lines = text.split("\n");
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        if (codeLines.has(lineNo)) continue;
        const trimmed = lines[i].replace(/^[ \t]+/, "");
        const m = VERIFY_HEADING_RE.exec(trimmed);
        if (!m) continue;
        findings.push({
            line: lineNo,
            column: lines[i].length - trimmed.length + 1,
            severity: "error",
            message:
                `changelog-check/verification-paragraph "${m[1]}" is how the change was ` +
                "checked, not what it does — say what a user sees, and move this to the " +
                "pull request's own description",
        });
    }
    return findings;
}

/**
 * A byte count, file count, pass tally or before/after count — every one a
 * verification artefact, not something a user meets.
 *
 * @param {string} text - Section text.
 * @param {Array<{start: number, end: number}>} maskedRegions
 * @returns {RelativeFinding[]}
 */
function checkScoreboardPhrases(text, maskedRegions) {
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (const { re, phrase } of SCOREBOARD_PATTERNS) {
        for (const m of text.matchAll(re)) {
            if (isMasked(maskedRegions, m.index)) continue;
            const { line, column } = lineColOf(text, m.index);
            findings.push({
                line,
                column,
                severity: "error",
                message:
                    `changelog-check/scoreboard-phrase "${m[0]}" is ${phrase} — a scoreboard ` +
                    "a reviewer wanted, not a change a user meets; describe the user-visible " +
                    "effect instead",
            });
        }
    }
    return findings;
}

/**
 * A bullet running past {@link MAX_BULLET_WORDS} words.
 *
 * @param {Array<{startLine: number, text: string}>} bullets
 * @returns {RelativeFinding[]}
 */
function checkLongBullets(bullets) {
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (const bullet of bullets) {
        const words = wordCount(bullet.text);
        if (words <= MAX_BULLET_WORDS) continue;
        findings.push({
            line: bullet.startLine,
            column: 1,
            severity: "error",
            message:
                `changelog-check/long-bullet this bullet runs to ${words} words — a ` +
                `changeset bullet is one sentence naming who notices and what they see; ` +
                "split it, or move the detail to the pull request's description",
        });
    }
    return findings;
}

/**
 * The first line of every contiguous run of nested list items.
 *
 * @param {string} text - Section text.
 * @param {Set<number>} codeLines
 * @returns {RelativeFinding[]}
 */
function checkNestedLists(text, codeLines) {
    const lines = text.split("\n");
    /** @type {RelativeFinding[]} */
    const findings = [];
    let prevNested = false;
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        if (codeLines.has(lineNo)) {
            prevNested = false;
            continue;
        }
        const isNested = NESTED_BULLET_RE.test(lines[i]);
        if (isNested && !prevNested) {
            const marker = /^[ \t]*/.exec(lines[i])[0];
            findings.push({
                line: lineNo,
                column: marker.length + 1,
                severity: "error",
                message:
                    "changelog-check/nested-list a nested list reads like a pull-request " +
                    "checklist — write one flat sentence per bullet instead",
            });
        }
        prevNested = isNested;
    }
    return findings;
}

/**
 * A `#` heading of any level inside the prose — the scaffold `## <version>`
 * and `### <Bump> Changes` lines excepted, since neither is authored.
 *
 * @param {string} text - Section text.
 * @param {Set<number>} codeLines
 * @param {Set<number>} scaffoldLines
 * @returns {RelativeFinding[]}
 */
function checkHeadings(text, codeLines, scaffoldLines) {
    const lines = text.split("\n");
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        if (codeLines.has(lineNo) || scaffoldLines.has(lineNo)) continue;
        if (!/^#{1,6}\s/.test(lines[i])) continue;
        findings.push({
            line: lineNo,
            column: 1,
            severity: "error",
            message:
                "changelog-check/heading a `#` heading inside a changelog entry outranks the " +
                "version heading above it once the entry is wrapped into a list item — use a " +
                "bold label instead",
        });
    }
    return findings;
}

/**
 * More than {@link MAX_TOP_BULLETS} top-level bullets in one section.
 *
 * @param {Array<{startLine: number, text: string}>} bullets
 * @returns {RelativeFinding[]}
 */
function checkTooManyBullets(bullets) {
    if (bullets.length <= MAX_TOP_BULLETS) return [];
    return [
        {
            line: bullets[MAX_TOP_BULLETS].startLine,
            severity: "error",
            message:
                `changelog-check/too-many-bullets ${bullets.length} top-level bullets is an ` +
                `itemized log, not a release note — one to six, so a reader sees the shape ` +
                "of the release at a glance",
        },
    ];
}

/**
 * More than {@link MAX_SECTION_LINES} lines in one section.
 *
 * @param {string} text - Section text.
 * @returns {RelativeFinding[]}
 */
function checkTooManyLines(text) {
    const lines = text.split("\n");
    if (lines.length <= MAX_SECTION_LINES) return [];
    return [
        {
            line: MAX_SECTION_LINES + 1,
            severity: "error",
            message:
                `changelog-check/too-many-lines ${lines.length} lines in one release section ` +
                "reads like a pull-request description — trim to what a user meets",
        },
    ];
}

/**
 * A token that reads as code — `camelCase()`, `a/path.ext`, `SCREAMING_SNAKE`
 * — outside any code span. A warning: a user-facing note sometimes needs one
 * (`Compendium.hm3.items.Item.<id>`), but rarely.
 *
 * @param {string} text - Section text.
 * @param {Array<{start: number, end: number}>} maskedRegions
 * @returns {RelativeFinding[]}
 */
function checkCodeLikeTokens(text, maskedRegions) {
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (const m of text.matchAll(CODE_TOKEN_RE)) {
        if (isMasked(maskedRegions, m.index)) continue;
        const { line, column } = lineColOf(text, m.index);
        findings.push({
            line,
            column,
            severity: "warning",
            message:
                `changelog-check/code-like-token "${m[0]}" looks like code outside a code ` +
                "span — wrap it in backticks if it is a literal a user would type",
        });
    }
    return findings;
}

/**
 * A block's bold label absent from the declared `changelog.labels`
 * vocabulary — the drift `**Character data**` beside `**Characters**`
 * produces, invisible until something reads the declared list against what a
 * changeset actually wrote. A warning, not an error: an undeclared label
 * still ships and still groups (`changelog group` files it last), so nothing
 * here blocks a release — it only says the vocabulary and the prose have
 * drifted apart.
 *
 * @param {Array<{startLine: number, label: string|null}>} blocks - From
 *   {@link topLevelBlocks}.
 * @param {readonly string[]|null|undefined} labels - `changelog.labels`, or
 *   `null`/`undefined` when the repository declares none, in which case
 *   nothing is checked — there is no vocabulary for a label to drift from.
 * @returns {RelativeFinding[]}
 */
function checkUnknownLabels(blocks, labels) {
    if (!labels) return [];
    /** @type {RelativeFinding[]} */
    const findings = [];
    for (const block of blocks) {
        if (block.label === null || labels.includes(block.label)) continue;
        findings.push({
            line: block.startLine,
            column: 3, // right after the opening `**`
            severity: "warning",
            message:
                `changelog-check/unknown-label "${block.label}" is not declared in ` +
                "`changelog.labels` (declared: " +
                `${labels.join(", ")}) — add it there, or correct the label`,
        });
    }
    return findings;
}

/**
 * The 1-based lines a caller drops from the heading rule because they are the
 * generated scaffold, never authored prose: the section's own `## <version>`
 * opening and any `### <Bump> Changes` line.
 *
 * @param {string} text - Section text.
 * @returns {Set<number>}
 */
function scaffoldLineSet(text) {
    const lines = text.split("\n");
    const set = new Set();
    if (RELEASE_HEADING_RE.test(lines[0] ?? "")) set.add(1);
    for (let i = 0; i < lines.length; i++) {
        if (CHANGES_HEADING_RE.test(lines[i])) set.add(i + 1);
    }
    return set;
}

/**
 * Run every rule over one section of release prose.
 *
 * @param {string} text - The section, already isolated by the caller.
 * @param {object} [opts]
 * @param {readonly string[]|null} [opts.labels] - `changelog.labels`, for
 *   {@link checkUnknownLabels}. `null`/absent checks nothing.
 * @returns {RelativeFinding[]} Findings with line numbers relative to `text`.
 */
function lintSection(text, { labels = null } = {}) {
    const codeLines = codeLineSet(text);
    const maskedRegions = codeRegions(text, { spans: true });
    const scaffoldLines = scaffoldLineSet(text);
    const bullets = topLevelBullets(text, codeLines);
    const blocks = topLevelBlocks(text, codeLines, scaffoldLines);

    return [
        ...checkCommitHash(text, codeLines, scaffoldLines),
        ...checkIssueReferences(text, maskedRegions),
        ...checkCodeFences(text),
        ...checkVerificationParagraphs(text, codeLines),
        ...checkScoreboardPhrases(text, maskedRegions),
        ...checkLongBullets(bullets),
        ...checkNestedLists(text, codeLines),
        ...checkHeadings(text, codeLines, scaffoldLines),
        ...checkTooManyBullets(bullets),
        ...checkTooManyLines(text),
        ...checkCodeLikeTokens(text, maskedRegions),
        ...checkUnknownLabels(blocks, labels),
    ].sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
}

/**
 * A pending changeset's frontmatter fence, stripped.
 *
 * @param {string} text - The changeset file's full contents.
 * @returns {{body: string, startLine: number}} The body, and the 1-based line
 *   in the original file its first line falls on.
 */
function stripFrontmatter(text) {
    const lines = text.split("\n");
    if (lines[0] !== "---") return { body: text, startLine: 1 };
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---") {
            end = i;
            break;
        }
    }
    if (end === -1) return { body: text, startLine: 1 };
    return { body: lines.slice(end + 1).join("\n"), startLine: end + 2 };
}

/**
 * The first `## <version>` section of a `CHANGELOG.md`.
 *
 * @param {string} text - The changelog's full contents.
 * @returns {{body: string, startLine: number}|null} `null` when no `## `
 *   heading is present at all.
 */
function extractReleaseSection(text) {
    const lines = text.split("\n");
    const start = lines.findIndex((line) => RELEASE_HEADING_RE.test(line));
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (RELEASE_HEADING_RE.test(lines[i])) {
            end = i;
            break;
        }
    }
    return { body: lines.slice(start, end).join("\n"), startLine: start + 1 };
}

/**
 * Lint one pending changeset (`.changeset/*.md`).
 *
 * @param {string} text - The file's full contents, frontmatter included.
 * @param {object} [opts]
 * @param {readonly string[]|null} [opts.labels] - `changelog.labels`, in
 *   display order, or `null`/absent when the repository declares none —
 *   {@link checkUnknownLabels} checks nothing in that case.
 * @returns {{findings: Array<{line: number, column?: number,
 *   severity: "error"|"warning", message: string}>}}
 */
export function lintChangesetText(text, { labels = null } = {}) {
    const { body, startLine } = stripFrontmatter(text);
    const findings = lintSection(body, { labels }).map((f) => ({
        ...f,
        line: f.line + startLine - 1,
    }));
    return { findings };
}

/**
 * Lint the first `## <version>` release section of a `CHANGELOG.md`.
 *
 * @param {string} text - The changelog's full contents.
 * @param {object} [opts]
 * @param {readonly string[]|null} [opts.labels] - `changelog.labels`, in
 *   display order, or `null`/absent when the repository declares none —
 *   {@link checkUnknownLabels} checks nothing in that case.
 * @returns {{findings: Array<{line?: number, column?: number,
 *   severity: "error"|"warning", message: string}>}}
 */
export function lintReleaseText(text, { labels = null } = {}) {
    const section = extractReleaseSection(text);
    if (!section) {
        return {
            findings: [
                {
                    severity: "error",
                    message: "changelog-check/no-release-section no `## <version>` heading found",
                },
            ],
        };
    }
    const findings = lintSection(section.body, { labels }).map((f) => ({
        ...f,
        line: f.line + section.startLine - 1,
    }));
    return { findings };
}

/**
 * The first `## <version>` release section of a changelog, as raw character
 * offsets rather than {@link extractReleaseSection}'s line-joined copy.
 *
 * `extractReleaseSection` rebuilds its `body` by joining a slice of
 * `text.split("\n")`, which is fine for reporting a line number but drops
 * the exact byte the next `## ` heading sits after — a caller rewriting the
 * file in place, such as `changelog group`, needs `text.slice(start, end)`
 * to be the section verbatim, so it can splice a replacement back in without
 * guessing at the whitespace on either side.
 *
 * @param {string} text - The changelog's full contents.
 * @returns {{start: number, end: number}|null} `null` when no `## ` heading
 *   is present. `text.slice(start, end)` is the section, byte-exact,
 *   including whatever separates it from the next `## ` heading or the end
 *   of the file.
 */
export function releaseSectionRange(text) {
    const matches = [...text.matchAll(/^## /gm)];
    if (matches.length === 0) return null;
    const start = matches[0].index;
    const end = matches.length > 1 ? matches[1].index : text.length;
    return { start, end };
}
