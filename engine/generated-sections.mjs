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
 * A note's **generated sections**: the H1 sections the build appends after
 * everything the author wrote, each under a fixed anchor.
 *
 * Two families share the one mechanism. The derived lists —
 * {@link module:engine/derived-sections} — say where a place sits, who governs
 * it, what it governs, which works concern the note and what the map from a
 * place shows. The event views — {@link module:engine/event-views} — list the
 * events concerning a note. Each section is Markdown an author could have
 * written, so the website, the Foundry journal and the book receive one text
 * and set it as they set an authored section: Foundry starts a page at the
 * heading, the website a section in its table of contents, the book a section
 * of the entry.
 *
 * Three rules hold for every section:
 *
 * - **An author's own anchor replaces it.** A note whose body declares a prose
 *   anchor with the section's slug keeps its own section and is given no
 *   generated one.
 * - **A section with nothing to show is not generated.**
 * - **Sections follow the author's text in the order of
 *   {@link GENERATED_SECTIONS}.**
 *
 * This module is a leaf: it holds the order, the join and the boundary, and
 * imports nothing, so the table expansion every surface runs can read it
 * without reaching the derivations.
 *
 * @module
 */

/**
 * Every generated section, in the order it follows the author's text: where a
 * place sits and who governs it, then what happened, then what was written
 * about it, then the map.
 *
 * @type {ReadonlyArray<Readonly<{slug: string, heading: string}>>}
 */
export const GENERATED_SECTIONS = Object.freeze(
    [
        { slug: "within", heading: "Within" },
        { slug: "governedby", heading: "Governed by" },
        { slug: "governedplaces", heading: "Governed places" },
        { slug: "chronology", heading: "Chronology" },
        { slug: "events", heading: "Events" },
        { slug: "accounts", heading: "Accounts" },
        { slug: "followed", heading: "What followed" },
        { slug: "insongandstory", heading: "In song and story" },
        { slug: "fromhere", heading: "From here" },
    ].map((section) => Object.freeze(section)),
);

/**
 * The directory, inside a package's own pathname space, that holds the
 * drawings the build makes. A generated section names a drawing as
 * `generated/<name>`, and each surface serves it from where it drew it: the
 * website inlines it, the Foundry compile stages it into the module under
 * `assets/generated/`, and the book draws it beside its Typst source. An
 * authored image is never addressed here.
 *
 * @type {string}
 */
export const GENERATED_DRAWING_DIR = "generated";

/**
 * The pathname a generated section names the map from a place by.
 *
 * @param {string} shortcode - The place.
 * @returns {string} `generated/from-<shortcode>.svg`.
 */
export function fromHereSource(shortcode) {
    return `${GENERATED_DRAWING_DIR}/${fromHereFile(shortcode)}`;
}

/**
 * The file the map from a place is drawn into, wherever a surface draws it.
 *
 * @param {string} shortcode - The place.
 * @returns {string} `from-<shortcode>.svg`.
 */
export function fromHereFile(shortcode) {
    return `from-${String(shortcode).toLowerCase()}.svg`;
}

/**
 * The drawing an image pathname names, when it names one the build makes.
 *
 * @param {string} src - An image's address, as the Markdown carries it.
 * @returns {string|null} The drawn file's name, or `null` for any other image.
 */
export function generatedDrawing(src) {
    const match = /^generated\/(from-[a-z0-9_-]+\.svg)$/.exec(String(src ?? "").trim());
    return match ? match[1] : null;
}

/**
 * Whether an authored image addresses the directory the build's drawings use.
 *
 * @param {string} src - The address, exactly as authored.
 * @returns {string} The problem, as a finding's sentence, or `""`.
 */
export function generatedDirectoryProblem(src) {
    const s = String(src ?? "").trim();
    if (s === GENERATED_DRAWING_DIR || s.startsWith(`${GENERATED_DRAWING_DIR}/`)) {
        return (
            `\`${s}\` is under \`${GENERATED_DRAWING_DIR}/\`, which holds the drawings ` +
            "the build makes for its generated sections — address an authored image " +
            "anywhere else in the package"
        );
    }
    return "";
}

/**
 * Whether a note's own body declares a prose anchor with this slug.
 *
 * @param {object} record - The note's index record, whose `anchors` were read
 *   from the authored body.
 * @param {string} slug - The section's anchor.
 * @returns {boolean} Whether the author has written the section.
 */
export function authoredSection(record, slug) {
    return (record?.anchors ?? []).some(
        (anchor) => anchor?.kind === "prose" && anchor.slug === slug,
    );
}

/**
 * The heading line of one generated section, with its anchor.
 *
 * @param {string} slug - One of {@link GENERATED_SECTIONS}.
 * @returns {string} `# <Heading> {#<slug>}`.
 */
export function sectionHeading(slug) {
    const section = GENERATED_SECTIONS.find((one) => one.slug === slug);
    if (!section) throw new Error(`no generated section is named "${slug}"`);
    return `# ${section.heading} {#${section.slug}}`;
}

/**
 * One note's sections, joined in {@link GENERATED_SECTIONS} order.
 *
 * @param {Iterable<Map<string, string>|undefined>} parts - Each a map of slug
 *   to that section's Markdown, heading included.
 * @returns {string} The sections, or `""` when there are none.
 */
export function joinSections(parts) {
    const bySlug = new Map();
    for (const part of parts) for (const [slug, text] of part ?? []) bySlug.set(slug, text);
    return GENERATED_SECTIONS.filter((section) => bySlug.has(section.slug))
        .map((section) => bySlug.get(section.slug).replace(/\s+$/, "") + "\n")
        .join("\n");
}

/**
 * A note's body with its generated sections after it — the one way the two
 * are joined, so the pass that answers their fences and every pass that
 * expands them read the same text.
 *
 * @param {string} body - The authored body.
 * @param {string|undefined} sections - Its sections, from {@link joinSections}.
 * @returns {string} The body the surfaces receive.
 */
export function appendGeneratedSections(body, sections) {
    if (!sections) return body;
    return `${String(body ?? "").replace(/\s+$/, "")}\n\n${sections}`;
}

/**
 * The line a surface inserts where a note's generated sections begin, when it
 * treats them differently from the author's text. Private-use characters, so
 * no pass between the expansion and the split reads it as markup, and no
 * output carries it: {@link splitGenerated} removes it.
 *
 * @type {string}
 */
export const GENERATED_BOUNDARY = "generated-sections";

/**
 * Mark where a note's generated sections begin.
 *
 * @param {string} markdown - The expanded body.
 * @param {number|undefined} from - The 0-based line the sections start on,
 *   from {@link module:engine/content-tables.expandContentTables}.
 * @returns {string} The body, with {@link GENERATED_BOUNDARY} on its own line
 *   before the sections; unchanged where there are none.
 */
export function markGenerated(markdown, from) {
    if (from === undefined || from < 0) return markdown;
    const lines = String(markdown).split("\n");
    if (from > lines.length) return markdown;
    lines.splice(from, 0, GENERATED_BOUNDARY);
    return lines.join("\n");
}

/**
 * Split a body at its {@link GENERATED_BOUNDARY}.
 *
 * @param {string} markdown - A body {@link markGenerated} marked.
 * @returns {{authored: string, generated: string}} The author's text, and the
 *   generated sections after it — `""` when there are none.
 */
export function splitGenerated(markdown) {
    const lines = String(markdown ?? "").split("\n");
    const at = lines.indexOf(GENERATED_BOUNDARY);
    if (at < 0) return { authored: String(markdown ?? ""), generated: "" };
    return {
        authored: lines.slice(0, at).join("\n"),
        generated: lines.slice(at + 1).join("\n"),
    };
}
