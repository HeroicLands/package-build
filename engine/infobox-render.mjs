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
 * **Rendering the declared infobox** — the two surfaces this package draws
 * itself, HTML for a Foundry Journal Page and Typst for the book.
 *
 * The website is the third surface and is not here: its boxes travel in the
 * page's front matter and the site theme draws them, which is what makes the
 * theme one generic renderer instead of a partial per note type.
 *
 * **Neither renderer knows a field name.** Both switch on a section's `layout`
 * and a row's `kind`, which is the whole of what keeps the field list from
 * leaking back into a template.
 *
 * **A section is the unit that flows.** In Typst each section is a
 * `block(breakable: false)` inside a `block(breakable: true)` panel, so a long
 * box crosses a column or page boundary between its sections and never through
 * a stat grid. In HTML the box is a `<details>` disclosure, default **open** —
 * native, accessible, no JavaScript, and what lets a being's note box and its
 * system boxes stack as three summary lines rather than three panels burying
 * the prose.
 *
 * @module
 */

import { sectionHolds } from "./infobox.mjs";
import { escapeTypst, escapeTypstString } from "./pdf-render.mjs";

/**
 * How many cells an attribute grid packs into a row.
 *
 * Six is what the book prototype settled on: a full set of fourteen scores
 * fills two rows and two cells of a third at the column measure the book sets,
 * and a wider row crowds the labels into their values.
 *
 * @type {number}
 */
const GRID_COLUMNS = 6;

/** HTML text, with the five characters that would otherwise be markup escaped. */
function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * The default HTML for one link value: an anchor when the medium supplied a
 * URL, and the text alone otherwise.
 *
 * An unresolved reference keeps its words. A page that names something the
 * index has not heard of is better than a page silently missing a row.
 *
 * @param {object} value - A `link` value.
 * @returns {string} HTML.
 */
export function linkToHtml(value) {
    const text = escapeHtml(value?.text);
    return value?.url ? `<a href="${escapeHtml(value.url)}">${text}</a>` : text;
}

/**
 * One link value as a Foundry document reference.
 *
 * A compendium journal links **inside** Foundry: a website URL on a panel a
 * player reads at the table sends them out of the game, and a UUID resolves to
 * the document whether or not the world has imported it. Foundry's enricher
 * reads the reference out of the page's own HTML, so no markup is needed
 * around it.
 *
 * @param {object} value - A `link` value.
 * @returns {string} A `@UUID` reference, or the text where there is none.
 */
export function linkToUuid(value) {
    const text = escapeHtml(value?.text);
    return value?.uuid ? `@UUID[${escapeHtml(value.uuid)}]{${text}}` : text;
}

/**
 * One row's value as HTML.
 *
 * @param {object} row - The row.
 * @param {(value: object) => string} link - How this medium draws a link.
 * @returns {string} HTML.
 */
function valueToHtml(row, link) {
    switch (row.kind) {
        case "link":
            return link(row.value);
        case "links":
            return (row.value ?? []).map((value) => link(value)).join(", ");
        case "list":
            return (row.value ?? []).map((entry) => escapeHtml(entry)).join(", ");
        case "number":
            return escapeHtml(row.value);
        default:
            return escapeHtml(row.value);
    }
}

/**
 * One entry of a `runin` group or a `list` section as HTML.
 *
 * @param {object} entry - The entry.
 * @param {(value: object) => string} link - How this medium draws a link.
 * @returns {string} HTML.
 */
function entryToHtml(entry, link) {
    return entry?.url || entry?.address ? link(entry) : escapeHtml(entry?.text);
}

/**
 * One section as HTML.
 *
 * @param {object} section - The section.
 * @param {(value: object) => string} link - How this medium draws a link.
 * @returns {string} HTML.
 */
function sectionToHtml(section, link) {
    const out = [`<section class="infobox-section infobox-${section.layout}">`];
    if (section.label)
        out.push(`<h4 class="infobox-section-title">${escapeHtml(section.label)}</h4>`);

    if (section.layout === "rows") {
        out.push('<dl class="infobox-rows">');
        for (const row of section.rows ?? []) {
            out.push(`<dt>${escapeHtml(row.label)}</dt><dd>${valueToHtml(row, link)}</dd>`);
        }
        out.push("</dl>");
    } else if (section.layout === "grid") {
        out.push('<ul class="infobox-cells">');
        for (const cell of section.cells ?? []) {
            out.push(
                `<li><span class="infobox-cell-label">${escapeHtml(cell.label)}</span>` +
                    `<span class="infobox-cell-value">${escapeHtml(cell.value)}</span></li>`,
            );
        }
        out.push("</ul>");
    } else if (section.layout === "runin") {
        for (const group of section.groups ?? []) {
            const entries = (group.entries ?? [])
                .map((entry) => entryToHtml(entry, link))
                .join(", ");
            const label = group.label ? `<strong>${escapeHtml(group.label)}:</strong> ` : "";
            out.push(`<p class="infobox-runin">${label}${entries}</p>`);
        }
    } else {
        out.push('<ul class="infobox-list">');
        for (const entry of section.entries ?? []) {
            out.push(`<li>${entryToHtml(entry, link)}</li>`);
        }
        out.push("</ul>");
    }

    out.push("</section>");
    return out.join("");
}

/**
 * Every box as HTML, in the order given.
 *
 * @param {readonly object[]} boxes - From `buildInfoboxes`.
 * @param {object} [options] - Options.
 * @param {(value: object) => string} [options.link] - How this medium draws a
 *   link. Defaults to an anchor on the value's `url`.
 * @returns {string} HTML, empty when there is nothing to draw.
 */
export function infoboxesToHtml(boxes, { link = linkToHtml } = {}) {
    const out = [];
    for (const box of boxes ?? []) {
        if (box.kind !== "system" && !box.sections?.some((s) => sectionHasContent(s))) continue;
        out.push(`<details class="infobox infobox-${escapeHtml(box.id)}" open>`);
        out.push(`<summary>${escapeHtml(box.title)}</summary>`);
        if (box.statement) {
            out.push(`<p class="infobox-statement">${escapeHtml(box.statement)}</p>`);
        } else {
            for (const section of box.sections ?? []) {
                if (sectionHasContent(section)) out.push(sectionToHtml(section, link));
            }
        }
        out.push("</details>");
    }
    return out.join("\n");
}

/**
 * Whether a section holds anything at all.
 *
 * A section with nothing in it is not drawn: rule 4 says an absent field is
 * absent, and a heading over nothing is the em-dash placeholder in another
 * form. The declaration answers it — {@link module:engine/infobox.sectionHolds}
 * — because the same question decides whether a system box carries a statement
 * instead of sections, and two answers to it would come apart.
 *
 * @param {object} section - The section.
 * @returns {boolean} Whether to draw it.
 */
export function sectionHasContent(section) {
    return sectionHolds(section);
}

/**
 * One link value as Typst.
 *
 * An internal destination — a note the book also prints — is a label
 * reference, so the link works on paper as a cross-reference and in a PDF
 * viewer as a jump. Everything else is set as its own words.
 *
 * @param {object} value - A `link` value.
 * @param {Map<string, string>} links - Address slug → the book's anchor.
 * @param {(anchor: string) => string} labelFor - The anchor's Typst label.
 * @returns {string} Typst markup.
 */
export function linkToTypst(value, links, labelFor) {
    const text = escapeTypst(value?.text ?? "");
    const anchor = value?.address ? links?.get(value.address) : undefined;
    if (anchor) return `#link(<${labelFor(anchor)}>)[${text}]`;
    if (value?.url) return `#link("${escapeTypstString(value.url)}")[${text}]`;
    return text;
}

/**
 * One row's value as Typst.
 *
 * @param {object} row - The row.
 * @param {(value: object) => string} link - How the book draws a link.
 * @returns {string} Typst markup.
 */
function valueToTypst(row, link) {
    switch (row.kind) {
        case "link":
            return link(row.value);
        case "links":
            return (row.value ?? []).map((value) => link(value)).join(", ");
        case "list":
            return (row.value ?? []).map((entry) => escapeTypst(entry)).join(", ");
        default:
            return escapeTypst(row.value);
    }
}

/**
 * One section as Typst, whole and unbreakable.
 *
 * `lead` rides **inside** the block rather than above it. A panel breaks
 * between its sections, and a title sitting outside the first one is a break
 * the panel is allowed to take — which leaves the heading and a rule stranded
 * at the foot of a page with nothing under them.
 *
 * @param {object} section - The section.
 * @param {(value: object) => string} link - How the book draws a link.
 * @param {string} [lead] - Markup to carry at the head of this section.
 * @returns {string} Typst markup.
 */
function sectionToTypst(section, link, lead = "") {
    const body = lead ? [lead] : [];
    if (section.label) body.push(`#infobox-head[${escapeTypst(section.label)}]`);

    if (section.layout === "rows") {
        for (const row of section.rows ?? []) {
            body.push(`#infobox-row[${escapeTypst(row.label)}][${valueToTypst(row, link)}]`);
        }
    } else if (section.layout === "grid") {
        const cells = section.cells ?? [];
        const drawn = cells
            .map((cell) => `infobox-cell[${escapeTypst(cell.label)}][${escapeTypst(cell.value)}]`)
            .join(", ");
        // A `grid` draws its strokes through cells that hold nothing, so a
        // part-filled last row would trail rules across empty space. The
        // separator is therefore drawn only up to the last cell that holds
        // something, and the row is padded out so the columns stay even.
        const padding = (GRID_COLUMNS - (cells.length % GRID_COLUMNS)) % GRID_COLUMNS;
        const filler = Array.from({ length: padding }, () => "[]").join(", ");
        body.push(
            `#grid(columns: (1fr,)*${GRID_COLUMNS}, row-gutter: 0.34em, inset: (x: 1.5pt), ` +
                `stroke: (x, y) => if x > 0 and (y*${GRID_COLUMNS} + x) < ${cells.length} ` +
                `{ (left: 0.4pt + infobox-hairline) }, ` +
                `${drawn}${padding ? `, ${filler}` : ""})`,
        );
    } else if (section.layout === "runin") {
        for (const group of section.groups ?? []) {
            const entries = (group.entries ?? [])
                .map((entry) =>
                    entry?.url || entry?.address ? link(entry) : escapeTypst(entry?.text),
                )
                .join(", ");
            body.push(`#infobox-runin("${escapeTypstString(group.label ?? "")}")[${entries}]`);
        }
    } else {
        for (const entry of section.entries ?? []) {
            const text = entry?.url || entry?.address ? link(entry) : escapeTypst(entry?.text);
            body.push(`#infobox-runin("")[${text}]`);
        }
    }

    return `#block(breakable: false)[\n${body.join("\n")}\n]`;
}

/**
 * Every box as one Typst panel each, breaking between sections.
 *
 * The panel is `breakable: true` and each section inside it is
 * `breakable: false`, which is what puts a break between `ATTRIBUTES` and
 * `SKILLS` on a richly-statted character and never inside either.
 *
 * @param {readonly object[]} boxes - From `buildInfoboxes`.
 * @param {object} [options] - Options.
 * @param {(value: object) => string} [options.link] - How the book draws a link.
 * @returns {string} Typst markup, empty when there is nothing to draw.
 */
export function infoboxesToTypst(boxes, { link = (value) => escapeTypst(value?.text ?? "") } = {}) {
    const out = [];
    for (const box of boxes ?? []) {
        const drawn = (box.sections ?? []).filter((section) => sectionHasContent(section));
        if (box.kind !== "system" && !drawn.length) continue;
        const title = `#infobox-title[${escapeTypst(box.title)}]`;
        const body = [];
        if (box.statement) {
            body.push(
                `#block(breakable: false)[\n${title}\n` +
                    `#infobox-statement[${escapeTypst(box.statement)}]\n]`,
            );
        } else if (!drawn.length) {
            body.push(`#block(breakable: false)[\n${title}\n]`);
        } else {
            drawn.forEach((section, at) => {
                body.push(sectionToTypst(section, link, at === 0 ? title : ""));
            });
        }
        out.push(`#infobox-panel[\n${body.join("\n")}\n]`);
    }
    return out.join("\n");
}

/**
 * The Typst definitions an infobox panel is drawn with.
 *
 * Emitted once at the head of the book rather than inlined per entry: 2,500
 * entries each carrying their own rules is a megabyte of repetition, and the
 * one place a reader changes the panel's appearance should be one place.
 *
 * @returns {string} Typst markup.
 */
export function infoboxTypstPreamble() {
    return [
        '#let infobox-rule = rgb("#7c3b1e")',
        '#let infobox-faint = rgb("#6b6357")',
        '#let infobox-hairline = rgb("#c9bfa8")',
        "#let infobox-panel(body) = block(width: 100%, breakable: true, " +
            "inset: (x: 9pt, y: 8pt), below: 0.8em, " +
            "stroke: (top: 1.4pt + infobox-rule, bottom: 1.4pt + infobox-rule))[" +
            "#set par(first-line-indent: 0em, justify: false, leading: 0.40em)\n#body]",
        '#let infobox-title(t) = { text(size: 9pt, weight: "bold", tracking: 1.3pt, ' +
            "fill: infobox-rule)[#upper(t)]; v(0.20em) }",
        '#let infobox-head(t) = { v(0.40em); text(size: 7.6pt, weight: "bold", ' +
            "tracking: 1.3pt, fill: infobox-rule)[#upper(t)]; v(0.16em) }",
        "#let infobox-row(k, v) = grid(columns: (2.05cm, 1fr), column-gutter: 4pt, " +
            "text(size: 7pt, tracking: 0.5pt, fill: infobox-faint)[#upper(k)], text(size: 8pt)[#v])",
        "#let infobox-cell(lab, val) = align(center)[" +
            "#text(size: 7pt, tracking: 0.6pt, fill: infobox-faint)[#lab]#h(2.5pt)" +
            '#text(size: 8.6pt, weight: "bold")[#val]]',
        "#let infobox-runin(lab, body) = block(below: 0.28em, breakable: false)[" +
            "#set par(justify: false, first-line-indent: 0em, hanging-indent: 0.5cm, leading: 0.40em)\n" +
            '#text(size: 7.8pt)[#if lab != "" [ #text(weight: "bold")[#lab: ] ]#body]]',
        '#let infobox-statement(t) = text(size: 8pt, style: "italic", fill: infobox-faint)[#t]',
    ].join("\n");
}
