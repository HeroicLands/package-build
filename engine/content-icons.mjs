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
 * Naming an interface icon in a note, without drawing it there.
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
 * book faces probed, **none** carries `✕ ✗ ✎ ☆ ⚗ ➕`; in a Libertinus
 * setting `✕` resolves to macOS LastResort, which draws a tofu box.
 *
 * **Neither obvious fix works.** Keeping the dingbats pins the book to some
 * icon-capable font forever, which is the coupling this exists to remove.
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
 * **Every finding here is a `warning`**, so nothing this module says can fail a
 * build — `reportFindings` fails on an error and not on a warning. An
 * undeclared name renders as its own literal text, which is visible on the page
 * and wrong in a way a reader will notice; that deserves to be reported and
 * does not deserve to stop a build that is otherwise correct.
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
 * The icon families a registry entry may draw from.
 *
 * **Two, because the interface uses two.** The SoHL icon legend says so in its
 * own prose: Font Awesome for most things, and Game-Icons.net *"for the arms,
 * gear, and condition glyphs that Font Awesome does not cover"* — eighteen of
 * them, `ginf-broadsword` and its kin.
 *
 * They differ in more than a class prefix, which is why this is a family rather
 * than a naming convention:
 *
 * - Font Awesome has **weights**, so an entry names a `style` and a filled and
 *   hollow pair is one icon twice. Game-Icons has none, so a `style` on such an
 *   entry names something that does not exist.
 * - They resolve to **different fonts**. A PDF has to embed both, and find each
 *   codepoint in its own table — Font Awesome's from the file it ships,
 *   Game-Icons' from the `game-icons-codepoints.json` the consumer's own
 *   `build-icon-font.mjs` writes.
 *
 * `class` is the prefix the web surfaces use. `styled` says whether a `style`
 * belongs on the entry at all, which is what lets a mistake be reported rather
 * than rendered as a class nobody defined.
 *
 * @type {Readonly<Record<string, {class: string, styled: boolean, describe: string}>>}
 */
export const ICON_FAMILIES = Object.freeze({
    fontawesome: {
        class: "fa",
        styled: true,
        describe: "Font Awesome Free",
    },
    "game-icons": {
        class: "ginf",
        styled: false,
        describe: "the Game-Icons.net webfont a package builds for itself",
    },
});

/** The family an entry that does not name one belongs to. */
export const DEFAULT_ICON_FAMILY = "fontawesome";

/**
 * The family an entry draws from, named or defaulted.
 *
 * @param {{family?: string}} entry - A registry entry.
 * @returns {string} The family name.
 */
export function familyOf(entry) {
    return entry?.family ?? DEFAULT_ICON_FAMILY;
}

/**
 * The sizes a note may ask for, and what each means on a page.
 *
 * **A closed set, because size is content here rather than styling.** The icon
 * legend exists to let a reader tell one glyph from another, and several of
 * them genuinely cannot be told apart at the size of running text — so the
 * enlargement is part of what that page *says*, not decoration applied to it.
 * That is the one case worth a size at all.
 *
 * Closed rather than free-form for the usual reason: `font-size: 2em` in a note
 * is CSS, which reaches two of the three surfaces and means nothing to the
 * third. A name means the same thing everywhere, and the multiples below are
 * Font Awesome's own, so the web class and the PDF scale cannot drift.
 *
 * @type {Readonly<Record<string, {class: string, scale: number}>>}
 */
export const ICON_SIZES = Object.freeze({
    lg: { class: "fa-lg", scale: 1.25 },
    xl: { class: "fa-xl", scale: 1.5 },
    "2x": { class: "fa-2x", scale: 2 },
    "3x": { class: "fa-3x", scale: 3 },
});

/**
 * The attribute names a note may write, and how each is validated.
 *
 * One entry today. It is a table rather than an `if (key === "size")` because
 * the next attribute — a fixed-width flag, a rotation, a title override — should
 * cost a line here and nothing else, and because an unknown key has to be
 * *reported*: silently ignoring `{sixe: 2x}` would leave the author looking at a
 * page that is not what they asked for, with nothing to say why.
 *
 * @type {Readonly<Record<string, {values: readonly string[], describe: string}>>}
 */
export const ICON_ATTRIBUTES = Object.freeze({
    size: {
        values: Object.freeze(Object.keys(ICON_SIZES)),
        describe: "how much larger than running text to draw the icon",
    },
});

/**
 * Read the brace of an icon token.
 *
 * Values are validated against {@link ICON_ATTRIBUTES} here rather than at the
 * point of rendering, so a mistake is one finding with a position rather than a
 * silently different page.
 *
 * @param {string} [raw] - The text between the braces, without them.
 * @returns {{attrs: Record<string, string>, problems: string[]}} What was
 *   written, and what cannot be honoured.
 */
export function parseIconAttributes(raw) {
    /** @type {Record<string, string>} */
    const attrs = {};
    const problems = [];
    if (!raw || !raw.trim()) return { attrs, problems };

    // Split on commas, not whitespace: `size: 2x` is one pair with a space in
    // it, and the space after the colon is the whole point of the spelling.
    for (const part of raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        const colon = part.indexOf(":");
        if (colon === -1) {
            problems.push(
                `\`${part}\` is not a \`key: value\` attribute — an icon takes ` +
                    `${Object.keys(ICON_ATTRIBUTES).join(", ")}`,
            );
            continue;
        }
        const key = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        const spec =
            Object.prototype.hasOwnProperty.call(ICON_ATTRIBUTES, key) ?
                ICON_ATTRIBUTES[key]
            :   undefined;
        if (!spec) {
            problems.push(
                `\`${key}\` is not an icon attribute — the ones there are: ` +
                    `${Object.keys(ICON_ATTRIBUTES).join(", ")}`,
            );
            continue;
        }
        if (!spec.values.includes(value)) {
            problems.push(
                `\`${key}: ${value}\` is not one of ${spec.values.join(", ")} — ` +
                    `${key} says ${spec.describe}`,
            );
            continue;
        }
        attrs[key] = value;
    }
    return { attrs, problems };
}

/**
 * The icons the user guide already depicts, under the names it should call them.
 *
 * Each entry is read off the interface it describes rather than invented, and
 * that is meant literally — the table was checked against the system's own
 * templates, which is how `delete` came to be `fa-trash` rather than the
 * `fa-trash-can` first written here. The sheets draw `fa-trash` twenty-five
 * times and `fa-trash-can` never, so the first spelling would have printed an
 * icon the reader has never seen on screen. A registry that is not checked
 * against the interface is just a second place to be wrong.
 *
 * The names are what a *writer* would reach for — `delete`, not `trash` —
 * because the writer is the one typing them; the Font Awesome spelling is this
 * table's business, not theirs.
 *
 * **Three entries share `xmark`, and that is the point of naming rather than
 * drawing.** A `✕` in the guide means "not applicable" in a Healing Rate
 * column, "remove this row" on a control, and "close" on a dialog's corner. One
 * glyph, three sentences, three different things for a reader who cannot see
 * it — so they are three names with three labels, and the fact that Font
 * Awesome happens to draw them identically stays in this table.
 *
 * `run` and `expand` are likewise distinct: `▶` runs an action, and its label
 * should say so. `fa-play` is what the sheets use for it.
 *
 * @type {Readonly<Record<string, {style: string, icon: string, label: string}>>}
 */
export const DEFAULT_ICONS = Object.freeze({
    affiliation: { style: "solid", icon: "certificate", label: "affiliation" },
    star: { style: "solid", icon: "star", label: "star" },
    "star-outline": { style: "regular", icon: "star", label: "hollow star" },
    // The Success Value scale. `fa-diamond` is Font Awesome's playing-card
    // suit and ships in solid only, so it can spell no hollow half of a
    // filled/hollow pair; `fa-gem` is a gemstone, has both weights, and is what
    // a quality scale actually means. `diamond` stays as an alias of it so a
    // note that already says `:icon-diamond:` keeps working.
    gem: { style: "solid", icon: "gem", label: "value gem" },
    "gem-outline": { style: "regular", icon: "gem", label: "unearned value gem" },
    diamond: { style: "solid", icon: "gem", label: "value gem" },
    edit: { style: "solid", icon: "pen-to-square", label: "edit" },
    delete: { style: "solid", icon: "trash", label: "delete" },
    add: { style: "solid", icon: "plus", label: "add" },
    remove: { style: "solid", icon: "xmark", label: "remove" },
    "not-applicable": { style: "solid", icon: "xmark", label: "not applicable" },
    close: { style: "solid", icon: "xmark", label: "close" },
    menu: { style: "solid", icon: "ellipsis-vertical", label: "actions menu" },
    run: { style: "solid", icon: "play", label: "run this action" },
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
 * segment already uses, so nothing new has to be explained.
 *
 * Not `:name[content]`. That is remark-directive syntax, and this toolchain
 * parses with markdown-it; a directive would render as its own literal text.
 *
 * An optional trailing brace carries **attributes**:
 *
 *     :icon-affiliation:{size: 2x}
 *
 * `key: value` pairs, comma-separated, in the shape `markdown-it-attrs` and
 * remark-directive already use — so it is a convention a reader may recognise
 * rather than one this module invented. Attributes rather than a bare value
 * because `size` is merely the first one anybody needed: a fixed-width flag, a
 * rotation, a title override are the same shape of thing, and a syntax that
 * could only ever express size would have to be replaced to gain any of them.
 *
 * One inline rule consumes the token **and** its brace, so there is no state in
 * which the icon resolves and the brace is left stranded on the page. An
 * unhandled token degrades whole, exactly as the bare form does.
 *
 * @type {RegExp}
 */
export const ICON_PATTERN = /:icon-([a-z0-9]+(?:-[a-z0-9]+)*):(?:\{([^}]*)\})?/g;

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
export function iconHtml(entry, attrs = {}) {
    const family = ICON_FAMILIES[familyOf(entry)] ?? ICON_FAMILIES[DEFAULT_ICON_FAMILY];
    const prefix = family.class;

    // A styled family spells the weight and the name as two classes; an
    // unstyled one has a single class and no weight to spell.
    const classes =
        family.styled ?
            [`${prefix}-${attr(entry.style)}`, `${prefix}-${attr(entry.icon)}`]
        :   [`${prefix}-${attr(entry.icon)}`];

    // The size classes are Font Awesome's, and the Game-Icons stylesheet this
    // toolchain's consumers generate mirrors its box metrics deliberately, so
    // they apply to both families.
    const sized = attrs.size ? ICON_SIZES[attrs.size] : undefined;
    if (sized) classes.push(sized.class);

    return `<i class="${classes.join(" ")}" role="img" aria-label="${attr(entry.label)}"></i>`;
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
        const { attrs, problems } = parseIconAttributes(m[2]);
        out.push({ name: m[1], index: m.index ?? 0, raw: m[0], attrs, problems });
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
 *   severity: "warning", message: string}>} The unknown names.
 */
export function lintIcons(text, file, registry = DEFAULT_ICONS) {
    const findings = [];
    for (const { name, index, raw, problems } of iconsIn(text)) {
        const before = text.slice(0, index);
        const line = before.split("\n").length;
        const column = index - (before.lastIndexOf("\n") + 1) + 1;
        const at = { file, line, column, severity: /** @type {const} */ ("warning") };

        if (!resolveIcon(name, registry)) {
            // Nearest declared name, when there is an obvious one: a typo is the
            // common case and the registry is short enough to say what was meant.
            const suggestion = nearestName(name, Object.keys(registry));
            findings.push({
                ...at,
                message:
                    `\`${raw}\` names an icon the registry does not declare` +
                    (suggestion ? `; did you mean \`:icon-${suggestion}:\`?` : "") +
                    ` — an undeclared name renders as its own literal text`,
            });
            // The name is the bigger fault; reporting its attributes as well
            // would be two findings for one token the author has to rewrite.
            continue;
        }

        // A bad attribute on a good name is its own finding: the icon renders,
        // and renders differently from what was asked for, which is the case
        // nobody notices without being told.
        for (const problem of problems) {
            findings.push({ ...at, message: `\`${raw}\`: ${problem}` });
        }
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
 * @returns {Array<{severity: "warning", message: string}>} What is wrong with it.
 */
export function checkIconRegistry(registry, where = "icons") {
    const findings = [];
    for (const [name, entry] of Object.entries(registry ?? {})) {
        const at = `\`${where}.${name}\``;
        if (!entry || typeof entry !== "object") {
            findings.push({
                severity: /** @type {const} */ ("warning"),
                message: `${at} is not an icon entry — it takes \`style\`, \`icon\` and \`label\``,
            });
            continue;
        }
        const familyName = familyOf(entry);
        const family = ICON_FAMILIES[familyName];
        if (!family) {
            findings.push({
                severity: /** @type {const} */ ("warning"),
                message:
                    `${at} names family \`${familyName}\`, and the families there ` +
                    `are: ${Object.keys(ICON_FAMILIES).join(", ")}`,
            });
            continue;
        }

        if (family.styled && !ICON_STYLES.includes(entry.style)) {
            findings.push({
                severity: /** @type {const} */ ("warning"),
                message:
                    `${at} names style \`${entry.style}\`, and Font Awesome Free ships ` +
                    `only ${ICON_STYLES.join(", ")} — a glyph in any other style is ` +
                    `absent from the font a book would embed`,
            });
        }

        // A style on an unstyled family is not a harmless extra key: it says
        // the author expected a weight, and the family has none, so what they
        // get is not what they asked for.
        if (!family.styled && entry.style !== undefined) {
            findings.push({
                severity: /** @type {const} */ ("warning"),
                message:
                    `${at} names style \`${entry.style}\`, and ${family.describe} has ` +
                    `no weights — the style is ignored, so a filled and hollow pair ` +
                    `cannot be spelled this way`,
            });
        }
        if (typeof entry.icon !== "string" || !entry.icon) {
            findings.push({
                severity: /** @type {const} */ ("warning"),
                message: `${at} declares no \`icon\`, so nothing names the glyph to draw`,
            });
        }
        if (typeof entry.label !== "string" || !entry.label) {
            findings.push({
                severity: /** @type {const} */ ("warning"),
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
 *   severity: "warning", message: string}>, files: number}} What it found.
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
 * **A function is accepted as well as a table**, and resolved per render. The
 * shared markdown-it instance is a module-level constant, so it is built before
 * any configuration is read; a getter lets it draw the package's own registry
 * without the module load order deciding whether that registry exists yet.
 *
 * @param {Record<string, object>|(() => Record<string, object>)} [registry] -
 *   The table, or something that returns it. Defaults to {@link DEFAULT_ICONS}.
 * @returns {(md: object) => void} A markdown-it plugin.
 */
export function iconPlugin(registry = DEFAULT_ICONS) {
    const tableOf = () =>
        typeof registry === "function" ? (registry() ?? DEFAULT_ICONS) : registry;
    return (md) => {
        /** @type {any} */ (md).inline.ruler.before("emphasis", "heroiclands_icon", iconRule);
        /** @type {any} */ (md).renderer.rules.heroiclands_icon = (tokens, idx) =>
            iconHtml(tokens[idx].meta.entry, tokens[idx].meta.attrs);

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
            const re = /^:icon-([a-z0-9]+(?:-[a-z0-9]+)*):(?:\{([^}]*)\})?/;
            const m = re.exec(state.src.slice(start));
            if (!m) return false;

            const entry = resolveIcon(m[1], tableOf());
            // Not ours to consume: leaving the source untouched is what makes an
            // unrecognised name visible on the page instead of vanishing.
            if (!entry) return false;

            // An attribute that cannot be honoured is reported by the lint, not
            // enforced here: refusing to render would hide a good icon over a
            // bad size, and the page is the place the author is looking.
            const { attrs } = parseIconAttributes(m[2]);

            if (!silent) {
                const token = state.push("heroiclands_icon", "", 0);
                token.meta = { name: m[1], entry, attrs };
                token.markup = m[0];
            }
            state.pos += m[0].length;
            return true;
        }
    };
}
