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
 * Resolve named inline font glyphs from a package's icon registry.
 *
 * A note writes `:icon warning:` or `:icon warning:{size=2x}`. Registry keys
 * use lowercase letters, digits and hyphens. The package supplies the font,
 * stylesheet, glyph name and accessible label. Unknown names remain literal
 * and produce a warning; malformed syntax and attributes produce errors.
 *
 * The registry stores glyph names rather than font codepoints. Print reads the
 * font file's character map, while HTML uses the declared style classes.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { parseExtensionAttributes } from "./extension-attributes.mjs";

/**
 * A **family** is an icon font, and a consumer declares the ones it ships.
 *
 * Nothing here names Font Awesome, or Game-Icons, or any other font. A registry
 * entry is a promise that a glyph will render, and only the package that ships
 * the font can keep it: the Game-Icons webfont is built by a consumer from its
 * own templates, and even Font Awesome — which Foundry supplies in-app — is
 * present on neither the knowledgebase nor the page of a book unless somebody
 * puts it there. A toolchain that shipped a table would be promising on a
 * consumer's behalf.
 *
 * The vocabulary is the consumer's for a second reason, independent of fonts. A
 * name like `victory-star-tester` is one game system's concept; another system
 * compiled by this same toolchain has different icons meaning different things.
 * What is shared is the *mechanism* — the syntax, the resolution, the checks —
 * and that is what lives here.
 *
 * A family declares:
 *
 * - `class` — the prefix its stylesheet uses (`fa`, `ginf`, `bi`).
 * - `styles` — the weights it ships, in the spelling its classes use. An empty
 *   list means the font has none, and then a `style` on an entry names
 *   something that does not exist and is reported rather than rendered.
 * - `describe` — one line, so a finding can say which font it means.
 *
 * @typedef {object} IconFamily
 * @property {string} class - The stylesheet's class prefix.
 * @property {readonly string[]} styles - The weights it ships; empty for none.
 * @property {string} describe - One line, for a finding.
 */

/**
 * A resolved registry: the families a package ships, and the icons it names.
 *
 * `defaultFamily` is what an entry that names none belongs to. It is optional,
 * and where a package declares exactly one family that one is it — so a
 * single-font package writes no `family` anywhere.
 *
 * @typedef {object} IconRegistry
 * @property {Readonly<Record<string, IconFamily>>} families
 * @property {string|undefined} defaultFamily
 * @property {Readonly<Record<string, object>>} icons
 */

/**
 * The registry a package that declares none gets: nothing at all.
 *
 * Empty rather than a starter set, because a starter set is a promise about
 * fonts this package does not ship. A tree with no `icons:` configured names no
 * icons, and `:icon star:` in one of its notes renders as its own literal text
 * and is reported — which is the visible failure, not a silent one.
 *
 * @type {IconRegistry}
 */
export const EMPTY_ICON_REGISTRY = Object.freeze({
    families: Object.freeze({}),
    defaultFamily: undefined,
    icons: Object.freeze({}),
});

/**
 * The family an entry draws from, named or defaulted.
 *
 * @param {{family?: string}} entry - A registry entry.
 * @param {IconRegistry} [registry] - The registry it came from.
 * @returns {string|undefined} The family name, or nothing when neither the
 *   entry nor the registry says.
 */
export function familyOf(entry, registry = EMPTY_ICON_REGISTRY) {
    if (entry?.family) return entry.family;
    if (registry?.defaultFamily) return registry.defaultFamily;
    // One declared family is unambiguous, so a single-font package writes no
    // `family` on any entry and states no default either.
    const names = Object.keys(registry?.families ?? {});
    return names.length === 1 ? names[0] : undefined;
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

    const parsed = parseExtensionAttributes(raw);
    problems.push(...parsed.problems);
    if (parsed.id) problems.push("an icon does not accept an id");
    if (parsed.classes.length) problems.push("an icon does not accept classes");
    for (const [key, value] of Object.entries(parsed.values)) {
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
                `\`${key}=${value}\` is not one of ${spec.values.join(", ")} — ` +
                    `${key} says ${spec.describe}`,
            );
            continue;
        }
        attrs[key] = value;
    }
    return { attrs, problems };
}

/**
 * The shape a note writes, and the one this module claims.
 *
 * The `icon` keyword distinguishes inline glyphs from asset Addresses and
 * other colon-based shorthand. Names use lowercase letters, digits and
 * hyphens, and each name resolves in the package's declared icon registry.
 *
 * An optional brace carries attributes, for example:
 *
 *     :icon affiliation:{size=2x}
 *
 * Attributes are whitespace-separated `key=value` pairs. The closed `size`
 * values are declared in {@link ICON_SIZES}.
 *
 * One inline rule consumes the token **and** its brace, so there is no state in
 * which the icon resolves and the brace is left stranded on the page. An
 * unhandled token degrades whole, exactly as the bare form does.
 *
 * @type {RegExp}
 */
export const ICON_PATTERN = /:icon ([a-z0-9]+(?:-[a-z0-9]+)*):(?:\{([^}]*)\})?/g;
const OBSOLETE_ICON_PATTERN = /:icon-([a-z0-9]+(?:-[a-z0-9]+)*):(?:\{([^}]*)\})?/g;

/**
 * Look one name up.
 *
 * @param {string} name - The name written between the colons, without `icon `.
 * @param {IconRegistry} [registry] - The package's registry.
 * @returns {object|null} The entry, or `null` when the registry does not
 *   declare it.
 */
export function resolveIcon(name, registry = EMPTY_ICON_REGISTRY) {
    const icons = registry?.icons ?? {};
    return Object.prototype.hasOwnProperty.call(icons, name) ? icons[name] : null;
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
 * @param {object} entry - A registry entry.
 * @param {Record<string, string>} [attrs] - The token's attributes.
 * @param {IconRegistry} [registry] - The registry the entry came from, which is
 *   what says how its family spells a class.
 * @returns {string} An `<i>` element.
 */
export function iconHtml(entry, attrs = {}, registry = EMPTY_ICON_REGISTRY) {
    const family = registry?.families?.[familyOf(entry, registry)];
    // A family nothing declares is reported by `checkIconRegistry`, not
    // invented here: guessing a prefix would put a class on the page that no
    // stylesheet defines, which looks like a missing glyph rather than a
    // configuration mistake.
    if (!family) return "";
    const prefix = family.class;
    const styles = family.styles ?? [];

    // A family with weights spells the weight and the name as two classes; one
    // without has a single class and no weight to spell.
    const classes =
        styles.length ?
            [`${prefix}-${attr(entry.style)}`, `${prefix}-${attr(entry.icon)}`]
        :   [`${prefix}-${attr(entry.icon)}`];

    // Fixed width, where the glyph needs it. This is the table's to say, not a
    // note's: whether an ellipsis is too narrow to sit in a column of controls
    // is a fact about that glyph, and the same everywhere it is drawn. A note
    // names the meaning and the table owns how it is set.
    if (styles.length && entry.fixedWidth) classes.push(`${prefix}-fw`);

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
 * half that makes `:icon stra:` a finding rather than three words of literal
 * text nobody notices in a rendered page.
 *
 * @param {string} text - The file's contents.
 * @param {string} file - Path to report.
 * @param {IconRegistry} [registry] - The package's registry.
 * @returns {Array<{file: string, line: number, column: number,
 *   severity: "warning"|"error", message: string}>} The findings.
 */
export function lintIcons(text, file, registry = EMPTY_ICON_REGISTRY) {
    const findings = [];
    for (const match of text.matchAll(OBSOLETE_ICON_PATTERN)) {
        const index = match.index ?? 0;
        const before = text.slice(0, index);
        findings.push({
            file,
            line: before.split("\n").length,
            column: index - (before.lastIndexOf("\n") + 1) + 1,
            severity: "error",
            message: `\`${match[0]}\` needs the form \`:icon ${match[1]}:\``,
        });
    }
    for (const { name, index, raw, problems } of iconsIn(text)) {
        const before = text.slice(0, index);
        const line = before.split("\n").length;
        const column = index - (before.lastIndexOf("\n") + 1) + 1;
        const at = { file, line, column, severity: /** @type {const} */ ("warning") };

        if (!resolveIcon(name, registry)) {
            // Nearest declared name, when there is an obvious one: a typo is the
            // common case and the registry is short enough to say what was meant.
            const suggestion = nearestName(name, Object.keys(registry?.icons ?? {}));
            findings.push({
                ...at,
                message:
                    `\`${raw}\` names an icon the registry does not declare` +
                    (suggestion ? `; did you mean \`:icon ${suggestion}:\`?` : "") +
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
            findings.push({ ...at, severity: "error", message: `\`${raw}\`: ${problem}` });
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
 * What is wrong with a package's declared registry.
 *
 * Both halves are checked, because either alone is unusable: an icon naming a
 * family nothing declares has no class prefix, and a family nothing names is a
 * font declared for no reason.
 *
 * A **style** is checked against the family's own `styles`, not against a list
 * here. Font Awesome Free ships three weights and another font ships none or
 * five, and only the declaration knows which — so a `duotone` entry is refused
 * because the family that entry belongs to does not list `duotone`, which is a
 * statement the consumer made about the font it actually ships.
 *
 * @param {{families?: object, icons?: object}} registry - A package's declared
 *   registry, before it is resolved.
 * @param {string} [where="icons"] - Where to say the fault is.
 * @returns {Array<{severity: "warning", message: string}>} What is wrong with it.
 */
export function checkIconRegistry(registry, where = "icons") {
    const findings = [];
    const warn = (message) =>
        findings.push({ severity: /** @type {const} */ ("warning"), message });

    const families = registry?.families ?? {};
    const icons = registry?.icons ?? {};

    for (const [name, family] of Object.entries(families)) {
        const at = `\`${where}.families.${name}\``;
        if (!family || typeof family !== "object") {
            warn(`${at} is not a family — it takes \`class\`, \`styles\` and \`describe\``);
            continue;
        }
        if (typeof family.class !== "string" || !family.class) {
            warn(`${at} declares no \`class\`, so nothing says how its glyphs are spelled`);
        }
        if (family.styles !== undefined && !Array.isArray(family.styles)) {
            warn(
                `${at} declares \`styles\` that is not a list — write \`[]\` for a font with no weights`,
            );
        }
        if (typeof family.describe !== "string" || !family.describe) {
            warn(`${at} declares no \`describe\`, so a finding cannot say which font it means`);
        }
    }

    for (const [name, entry] of Object.entries(icons)) {
        const at = `\`${where}.icons.${name}\``;
        if (!entry || typeof entry !== "object") {
            warn(`${at} is not an icon entry — it takes \`icon\` and \`label\``);
            continue;
        }

        const familyName = familyOf(entry, { families, defaultFamily: registry?.defaultFamily });
        if (!familyName) {
            warn(
                `${at} names no family and the registry declares ${Object.keys(families).length} of ` +
                    `them, so nothing says which font draws it — name one on the entry, or ` +
                    `declare a \`defaultFamily\``,
            );
            continue;
        }
        const family = families[familyName];
        if (!family) {
            const declared = Object.keys(families);
            warn(
                `${at} names family \`${familyName}\`, and the families this package ` +
                    `declares are: ${declared.length ? declared.join(", ") : "none"}`,
            );
            continue;
        }

        const styles = Array.isArray(family.styles) ? family.styles : [];
        if (styles.length && !styles.includes(entry.style)) {
            warn(
                `${at} names style \`${entry.style}\`, and ${family.describe} ships ` +
                    `only ${styles.join(", ")} — a glyph in any other style is absent ` +
                    `from the font a book would embed`,
            );
        }

        // A style on a font with no weights is not a harmless extra key: it
        // says the author expected a weight, and what they get is not what
        // they asked for.
        if (!styles.length && entry.style !== undefined) {
            warn(
                `${at} names style \`${entry.style}\`, and ${family.describe} has no ` +
                    `weights — the style is ignored, so a filled and hollow pair cannot ` +
                    `be spelled this way`,
            );
        }

        // The same rule `style` gets: a font with no weights ships no `-fw`
        // class either, so asking for one asks for a width it cannot give.
        if (!styles.length && entry.fixedWidth !== undefined) {
            warn(
                `${at} asks for fixed width, and ${family.describe} ships no such ` +
                    `class — the request is ignored, so a glyph that needs the width ` +
                    `will not get it`,
            );
        }

        if (typeof entry.icon !== "string" || !entry.icon) {
            warn(`${at} declares no \`icon\`, so nothing names the glyph to draw`);
        }
        if (typeof entry.label !== "string" || !entry.label) {
            warn(
                `${at} declares no \`label\`, and an icon with no accessible name is ` +
                    `read aloud as a gap in the sentence`,
            );
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
 * A finding names its file **relative to the working directory**, which is
 * where a reader is standing and what `formatDiagnostic` emits. The content
 * root is where the walk starts, not what a path is measured from.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore.
 * @param {IconRegistry} [opts.registry] - The package's registry.
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
            findings.push(...lintIcons(text, path.relative(process.cwd(), full), registry));
        }
    };

    walk(contentBase);
    return { findings, files };
}

/**
 * A markdown-it plugin rendering `:icon name:` inline.
 *
 * An unknown name is left **exactly as written** rather than dropped. The name
 * is reported by {@link lintIcons}, and a rendered page that still shows
 * `:icon stra:` is how the author finds it without reading a log.
 *
 * **A function is accepted as well as a table**, and resolved per render. The
 * shared markdown-it instance is a module-level constant, so it is built before
 * any configuration is read; a getter lets it draw the package's own registry
 * without the module load order deciding whether that registry exists yet.
 *
 * @param {Record<string, object>|(() => Record<string, object>)} [registry] -
 *   The registry, or something that returns it.
 * @returns {(md: object) => void} A markdown-it plugin.
 */
export function iconPlugin(registry = EMPTY_ICON_REGISTRY) {
    const tableOf = () =>
        typeof registry === "function" ? (registry() ?? EMPTY_ICON_REGISTRY) : registry;
    return (md) => {
        /** @type {any} */ (md).inline.ruler.before("emphasis", "heroiclands_icon", iconRule);
        /** @type {any} */ (md).renderer.rules.heroiclands_icon = (tokens, idx) =>
            iconHtml(tokens[idx].meta.entry, tokens[idx].meta.attrs, tableOf());

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
            const re = /^:icon ([a-z0-9]+(?:-[a-z0-9]+)*):(?:\{([^}]*)\})?/;
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
