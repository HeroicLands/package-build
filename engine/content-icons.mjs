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
 * Naming an interface icon in a note, without drawing it there (#378).
 *
 * The user guide describes Foundry's interface, and it did so by pasting
 * Unicode lookalikes of the icons the sheets actually draw: `☆` for the improve
 * flag, `✎` for the formula editor, `◆` in the success-value table, `★★★` for
 * mastery. The system renders every one of those with **Font Awesome** — a
 * `fa-regular fa-star`, a `fa-solid fa-pen-to-square` — so the note and the
 * screen it describes were drawing different pictures, and drifting apart with
 * every sheet change.
 *
 * They are also the worst characters in the corpus to typeset. Of the eight
 * book faces probed for #377, **none** carries `✕ ✗ ✎ ☆ ⚗ ➕`; in a Libertinus
 * setting `✕` resolves to macOS LastResort, which draws a tofu box.
 *
 * **Neither obvious fix works.** Keeping the dingbats pins the book to some
 * icon-capable font forever, which is the coupling #377 exists to remove.
 * Pasting Font Awesome's own codepoints is worse: they live in the Private Use
 * Area, which is unassigned by definition, so they break search, copy-paste and
 * screen readers, and no charset check can validate them.
 *
 * So a note **names** an icon and never contains one. `:icon-star-outline:` is
 * ASCII, it is greppable, it survives a charset check, and it degrades to
 * visible literal text on any surface that has not been taught to render it —
 * which is the failure mode you want, because you can see it.
 *
 * **Why a registry rather than the Font Awesome classes.** Three surfaces need
 * three different artefacts from one name: the journals and the website want
 * `<i class="fa-solid fa-star">`, and the PDF wants a font file and a glyph.
 * Only a mapping serves both. It also means a Font Awesome major version that
 * renames an icon — `fa-trash-o` became `fa-trash-can` — costs one line here
 * rather than a sweep of the corpus, and it lets an unknown name be *reported*
 * instead of passing silently through as literal text.
 *
 * **The codepoint is deliberately not here.** A renderer that embeds Font
 * Awesome has to read the font to subset it, and the font's own `cmap` is the
 * only trustworthy source for which glyph a name resolves to. Writing the
 * codepoints out by hand would be a second copy of that table, wrong the first
 * time Font Awesome renumbers anything, and wrong silently. This module states
 * the style and the name; the renderer resolves them against the file it ships.
 *
 * **Licence.** Font Awesome Free's icons are CC BY 4.0 and its fonts SIL OFL
 * 1.1, so a distributed PDF may embed the subset it uses. Attribution belongs
 * in the book's colophon, not in every note.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

/**
 * The Font Awesome styles a registry entry may name.
 *
 * Free ships these three and no others, so a `light` or `duotone` entry would
 * name a glyph the shipped font does not contain — refused here rather than
 * discovered as a blank space in a printed book.
 *
 * @type {readonly string[]}
 */
export const ICON_STYLES = Object.freeze(["solid", "regular", "brands"]);

/**
 * The icons the user guide already depicts, under the names it should call them.
 *
 * Each entry was read off the interface it describes rather than invented: the
 * `star`/`star-outline` pair is the filled and hollow star the mastery row and
 * the improve flag draw, and `edit` is the pencil the formula editor opens
 * from. The names are what a *writer* would reach for — `delete`, not
 * `trash-can` — because the writer is the one typing them; the Font Awesome
 * spelling is this table's business, not theirs.
 *
 * @type {Readonly<Record<string, {style: string, icon: string, label: string}>>}
 */
export const DEFAULT_ICONS = Object.freeze({
    star: { style: "solid", icon: "star", label: "star" },
    "star-outline": { style: "regular", icon: "star", label: "hollow star" },
    diamond: { style: "solid", icon: "diamond", label: "diamond" },
    edit: { style: "solid", icon: "pen-to-square", label: "edit" },
    delete: { style: "solid", icon: "trash-can", label: "delete" },
    add: { style: "solid", icon: "plus", label: "add" },
    remove: { style: "solid", icon: "xmark", label: "remove" },
    "not-applicable": { style: "solid", icon: "xmark", label: "not applicable" },
    menu: { style: "solid", icon: "ellipsis-vertical", label: "actions menu" },
    expand: { style: "solid", icon: "caret-right", label: "expand" },
    shield: { style: "solid", icon: "shield-halved", label: "armour" },
    compass: { style: "solid", icon: "compass", label: "guided tour" },
    flask: { style: "solid", icon: "flask", label: "under construction" },
});

/**
 * The shape a note writes, and the one this module claims.
 *
 * The `icon-` prefix is what keeps it out of the way of an emoji shortcode: a
 * surface that also renders `:smile:` can tell the two apart without a lookup,
 * and a reader can tell what `:icon-star:` is without knowing this module
 * exists. Names are lowercase, digits and hyphens — the charset an address
 * segment already uses (#59), so nothing new has to be explained.
 *
 * Not `:name[content]`. That is remark-directive syntax, and this toolchain
 * parses with markdown-it; a directive would render as its own literal text.
 *
 * @type {RegExp}
 */
export const ICON_PATTERN = /:icon-([a-z0-9]+(?:-[a-z0-9]+)*):/g;

/**
 * Look one name up.
 *
 * @param {string} name - The name written between the colons, without `icon-`.
 * @param {Record<string, object>} [registry] - Defaults to {@link DEFAULT_ICONS}.
 * @returns {{style: string, icon: string, label: string}|null} The entry, or
 *   `null` when the registry does not declare it.
 */
export function resolveIcon(name, registry = DEFAULT_ICONS) {
    return Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
}

/** HTML-escape a value going into an attribute. */
const attr = (value) =>
    String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * The HTML the journals and the website emit — what the system already renders.
 *
 * Carries an accessible name rather than `aria-hidden`. The system's own
 * templates hide their icons because a labelled parent element speaks for them;
 * an icon dropped into a sentence has no such parent, and "the ☆ toggles it"
 * read aloud as "the toggles it" is a sentence with a hole in it.
 *
 * @param {{style: string, icon: string, label: string}} entry - A registry entry.
 * @returns {string} An `<i>` element.
 */
export function iconHtml(entry) {
    return (
        `<i class="fa-${attr(entry.style)} fa-${attr(entry.icon)}" ` +
        `role="img" aria-label="${attr(entry.label)}"></i>`
    );
}

/**
 * Every icon a string names, in the order written.
 *
 * @param {string} text - Markdown source.
 * @returns {Array<{name: string, index: number, raw: string}>} What it names.
 */
export function iconsIn(text) {
    const out = [];
    for (const m of text.matchAll(ICON_PATTERN)) {
        out.push({ name: m[1], index: m.index ?? 0, raw: m[0] });
    }
    return out;
}

/**
 * Report every icon a tree names that its registry does not declare.
 *
 * The whole point of a registry is that a typo is answerable, so this is the
 * half that makes `:icon-stra:` a finding rather than three words of literal
 * text nobody notices in a rendered page.
 *
 * @param {string} text - The file's contents.
 * @param {string} file - Path to report.
 * @param {Record<string, object>} [registry] - Defaults to {@link DEFAULT_ICONS}.
 * @returns {Array<{file: string, line: number, column: number,
 *   severity: "error", message: string}>} The unknown names.
 */
export function lintIcons(text, file, registry = DEFAULT_ICONS) {
    const findings = [];
    for (const { name, index, raw } of iconsIn(text)) {
        if (resolveIcon(name, registry)) continue;
        const before = text.slice(0, index);
        const line = before.split("\n").length;
        const column = index - (before.lastIndexOf("\n") + 1) + 1;
        // Nearest declared name, when there is an obvious one: a typo is the
        // common case and the registry is short enough to say what was meant.
        const suggestion = nearestName(name, Object.keys(registry));
        findings.push({
            file,
            line,
            column,
            severity: /** @type {const} */ ("error"),
            message:
                `\`${raw}\` names an icon the registry does not declare` +
                (suggestion ? `; did you mean \`:icon-${suggestion}:\`?` : "") +
                ` — an undeclared name renders as its own literal text`,
        });
    }
    return findings;
}

/**
 * The closest declared name within one edit, or nothing.
 *
 * Deliberately strict: a suggestion that is merely the alphabetically nearest
 * string is worse than none, because it sends the author to look at an icon
 * they never meant.
 *
 * @param {string} name - What was written.
 * @param {readonly string[]} known - The declared names.
 * @returns {string|undefined} The suggestion, when one is close enough.
 */
function nearestName(name, known) {
    let best;
    let bestScore = Infinity;
    for (const candidate of known) {
        const score = editDistance(name, candidate);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    // Two edits on a short name is already a different word.
    return bestScore <= Math.min(2, Math.floor(name.length / 3) + 1) ? best : undefined;
}

/** Levenshtein distance, on the two short strings a registry lookup compares. */
function editDistance(a, b) {
    /** @type {number[]} */
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length];
}

/**
 * Refuse a registry that names a style Font Awesome Free does not ship.
 *
 * @param {Record<string, object>} registry - A package's icon table.
 * @param {string} [where="icons"] - Where to say the fault is.
 * @returns {Array<{severity: "error", message: string}>} What is wrong with it.
 */
export function checkIconRegistry(registry, where = "icons") {
    const findings = [];
    for (const [name, entry] of Object.entries(registry ?? {})) {
        const at = `\`${where}.${name}\``;
        if (!entry || typeof entry !== "object") {
            findings.push({
                severity: /** @type {const} */ ("error"),
                message: `${at} is not an icon entry — it takes \`style\`, \`icon\` and \`label\``,
            });
            continue;
        }
        if (!ICON_STYLES.includes(entry.style)) {
            findings.push({
                severity: /** @type {const} */ ("error"),
                message:
                    `${at} names style \`${entry.style}\`, and Font Awesome Free ships ` +
                    `only ${ICON_STYLES.join(", ")} — a glyph in any other style is ` +
                    `absent from the font a book would embed`,
            });
        }
        if (typeof entry.icon !== "string" || !entry.icon) {
            findings.push({
                severity: /** @type {const} */ ("error"),
                message: `${at} declares no \`icon\`, so nothing names the glyph to draw`,
            });
        }
        if (typeof entry.label !== "string" || !entry.label) {
            findings.push({
                severity: /** @type {const} */ ("error"),
                message:
                    `${at} declares no \`label\`, and an icon with no accessible name ` +
                    `is read aloud as a gap in the sentence`,
            });
        }
    }
    return findings;
}

/**
 * Walk a content tree and report every icon name its registry does not declare.
 *
 * Its own walk rather than the charset check's, so both modules stay leaves
 * with nothing imported between them. The cost is one extra pass over the tree,
 * which is the cheaper half of a lint that already parses every note.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore.
 * @param {Record<string, object>} [opts.registry] - The package's icon table.
 * @returns {{findings: Array<{file: string, line: number, column: number,
 *   severity: "error", message: string}>, files: number}} What it found.
 */
export function lintContentIcons(contentBase, { skipDirectories = [], registry } = {}) {
    const skip = new Set(skipDirectories);
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
            if (!/\.(md|markdown)$/i.test(entry.name)) continue;
            let text;
            try {
                text = fs.readFileSync(full, "utf8");
            } catch {
                continue;
            }
            files += 1;
            findings.push(...lintIcons(text, path.relative(contentBase, full), registry));
        }
    };

    walk(contentBase);
    return { findings, files };
}

/**
 * A markdown-it plugin rendering `:icon-name:` inline.
 *
 * An unknown name is left **exactly as written** rather than dropped. The name
 * is reported by {@link lintIcons}, and a rendered page that still shows
 * `:icon-stra:` is how the author finds it without reading a log.
 *
 * @param {Record<string, object>} [registry] - Defaults to {@link DEFAULT_ICONS}.
 * @returns {(md: object) => void} A markdown-it plugin.
 */
export function iconPlugin(registry = DEFAULT_ICONS) {
    return (md) => {
        /** @type {any} */ (md).inline.ruler.before("emphasis", "heroiclands_icon", iconRule);
        /** @type {any} */ (md).renderer.rules.heroiclands_icon = (tokens, idx) =>
            iconHtml(tokens[idx].meta.entry);

        /**
         * @param {any} state - markdown-it inline state.
         * @param {boolean} silent - Validation pass, which emits no token.
         * @returns {boolean} Whether the rule consumed anything.
         */
        function iconRule(state, silent) {
            const start = state.pos;
            if (state.src.charCodeAt(start) !== 0x3a /* : */) return false;
            // Anchored at the cursor, so the scan is O(token) rather than a
            // search of the remaining source at every colon in the paragraph.
            const re = /^:icon-([a-z0-9]+(?:-[a-z0-9]+)*):/;
            const m = re.exec(state.src.slice(start));
            if (!m) return false;

            const entry = resolveIcon(m[1], registry);
            // Not ours to consume: leaving the source untouched is what makes an
            // unrecognised name visible on the page instead of vanishing.
            if (!entry) return false;

            if (!silent) {
                const token = state.push("heroiclands_icon", "", 0);
                token.meta = { name: m[1], entry };
                token.markup = m[0];
            }
            state.pos += m[0].length;
            return true;
        }
    };
}
