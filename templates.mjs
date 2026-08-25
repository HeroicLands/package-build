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
 * Whether a template's user-visible text goes through localization at all.
 *
 * This is the **reverse** of {@link module:coverage}, and the two are
 * deliberate opposites. Coverage walks *key → file*: it can tell you that every
 * key the code names exists, and it is completely blind to a template that
 * names no key whatsoever. This walks *text → key*: every user-visible literal
 * in the markup must be a `{{localize}}` call rather than English sitting in
 * the file.
 *
 * The Song of Heroic Lands repository is the argument for having both. Before
 * the work that prompted this guard there were **516 hardcoded English literals
 * across 61 templates**, and translating every key in `en.json` would have left
 * every one of them in English — a fully "translated" package that renders half
 * in the translator's language and half in the author's.
 *
 * It also **compiles** every template, because the usual way to break one while
 * localizing it is to nest `{{localize …}}` inside another mustache. That is
 * legal in an HTML attribute and a parse error inside a helper's hash, where a
 * `(localize …)` subexpression is required — so the mistake ships from a
 * template that looks exactly like its working neighbour.
 *
 * Both functions are pure: source text in, findings out. Discovery, I/O and
 * reporting stay with the caller.
 *
 * @module
 */

import Handlebars from "handlebars";
import { positionOfLiteral } from "./engine/diagnostics.mjs";

/**
 * A single finding, in the fields the shared diagnostic format takes.
 *
 * `file` is absent for the same reason it is absent from a localization
 * finding: these functions are handed source text, not a path.
 *
 * @typedef {object} TemplateFinding
 * @property {number} [line] - 1-based line, omitted when it cannot be
 *   established honestly.
 * @property {number} [column] - 1-based column, omitted likewise.
 * @property {"error"|"warning"} severity - How the finding should be treated.
 * @property {string} message - What is wrong, in one sentence.
 */

/**
 * Attributes whose value the user reads.
 *
 * Every one of these renders as prose somewhere — a tooltip, a placeholder, a
 * screen reader's announcement — so English in one is as untranslated as
 * English in a heading, and far easier to miss.
 *
 * @type {readonly string[]}
 */
export const VISIBLE_ATTRIBUTES = Object.freeze([
    "title",
    "placeholder",
    "aria-label",
    "alt",
    "data-tooltip",
    "data-title",
]);

/**
 * Remove everything that is not user-visible prose.
 *
 * Handlebars expressions go first (their contents are code), then `<style>` and
 * `<script>` bodies (theirs are too). What is left is what a player reads.
 *
 * Substitutions are single spaces rather than removals so that nothing new is
 * glued together — `>{{a}}<` must not become `><`, which would read as an empty
 * text node rather than as no text node at all.
 *
 * @param {string} source - The template source.
 * @returns {string} The source with every non-prose region blanked.
 */
function stripNonProse(source) {
    return source
        .replace(/\{\{![\s\S]*?\}\}/g, " ")
        .replace(/\{\{[^}]*\}\}/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
        .replace(/<script[\s\S]*?<\/script>/g, " ");
}

/**
 * Whether a run of text is prose a player would expect in their own language.
 *
 * An HTML entity (`&infin;`, `&middot;`) is a symbol, not prose — its letters
 * are markup — so entities are dropped before looking for words. Two letters is
 * the threshold: it admits "OK" and excludes every unit, separator and numeral.
 *
 * @param {string} text - The candidate, whitespace already normalized.
 * @param {Set<string>} allowed - Literals the repository has justified.
 * @returns {boolean} Whether it should have been localized.
 */
function isProse(text, allowed) {
    return (
        /[A-Za-z]{2}/.test(text.replace(/&[a-zA-Z]+;|&#\d+;/g, " ")) &&
        !allowed.has(text)
    );
}

/**
 * Every user-visible literal a template leaves untranslated.
 *
 * @param {string} source - The template source.
 * @param {object} [options]
 * @param {Iterable<string>} [options.allow] - Literals that are deliberately
 *   not localization keys — a code sample shown as a placeholder, say. This is
 *   the escape hatch, not the rule: anything that is ordinary UI prose belongs
 *   in the localization file, and a repository states each entry with the
 *   reason it cannot be one.
 * @returns {TemplateFinding[]} The findings, in the order they appear.
 */
export function findHardcodedText(source, { allow = [] } = {}) {
    const allowed = new Set(allow);
    const stripped = stripNonProse(source);
    const found = [];

    /**
     * Locate one literal in the **source**, not in the stripped text.
     *
     * The stripped copy has had substitutions of a different length, so a match
     * index taken there cannot be carried across — the finding would name a
     * position that drifts further from the truth the more Handlebars a file
     * contains. Searching the source for the literal itself is exact, and
     * counting occurrences keeps a literal that appears twice from reporting
     * the same line twice.
     *
     * @param {string} needle - The literal exactly as the source spells it.
     * @returns {{line?: number, column?: number}} Spreadable position fields.
     */
    const seen = new Map();
    const at = (needle) => {
        const occurrence = (seen.get(needle) ?? 0) + 1;
        seen.set(needle, occurrence);
        return positionOfLiteral(source, needle, occurrence);
    };

    for (const match of stripped.matchAll(/>([^<>]+)</g)) {
        const text = match[1].replace(/\s+/g, " ").trim();
        if (!isProse(text, allowed)) continue;
        found.push({
            ...at(match[1]),
            severity: "error",
            message: `hardcoded user-visible string: ${text}`,
        });
    }

    for (const attr of VISIBLE_ATTRIBUTES) {
        // `\b` alone would match `title` inside `data-title`, reporting one
        // literal twice under two names; a hyphen is a word boundary to a
        // regular expression and part of the attribute name to HTML.
        const pattern = new RegExp(`(?<![\\w-])${attr}="([^"]*)"`, "g");
        for (const match of stripped.matchAll(pattern)) {
            const text = match[1].replace(/\s+/g, " ").trim();
            if (!isProse(text, allowed)) continue;
            found.push({
                ...at(match[0]),
                severity: "error",
                message: `hardcoded user-visible string: ${attr}="${text}"`,
            });
        }
    }

    return found;
}

/**
 * Whether the template compiles at all.
 *
 * Precompiling rather than compiling: the question is whether Handlebars can
 * *parse* the source, and precompilation answers it without needing any of the
 * helpers the template calls to exist.
 *
 * @param {string} source - The template source.
 * @returns {TemplateFinding[]} One finding when it does not parse, else none.
 */
export function findTemplateSyntaxErrors(source) {
    try {
        Handlebars.precompile(source);
        return [];
    } catch (err) {
        // Handlebars states a position three different ways depending on which
        // stage rejected the template, and populates `hash.loc` for almost
        // none of them — so the line printed in its own message is the one that
        // is usually there. Reading it back is not guesswork: it is Handlebars'
        // answer, in the only place this error carries it.
        const loc = err?.hash?.loc;
        const stated = /Parse error on line (\d+)/.exec(String(err?.message));
        const line =
            loc?.first_line ??
            err?.lineNumber ??
            (stated ? Number(stated[1]) : undefined);
        return [
            {
                ...(typeof line === "number" ? { line } : {}),
                ...((
                    typeof line === "number" &&
                    typeof loc?.first_column === "number"
                ) ?
                    { column: loc.first_column + 1 }
                :   {}),
                severity: "error",
                message: `template does not compile: ${
                    String(err).split("\n")[0]
                }`,
            },
        ];
    }
}
