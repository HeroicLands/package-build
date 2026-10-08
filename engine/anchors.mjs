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
 * The anchors a note declares on headings, captions, divs, poems and spans,
 * and on its events.
 *
 * **Every anchor has a kind** — one of {@link ANCHOR_KINDS} — so a position
 * that accepts an anchor can say which kinds it takes: a `follows` edge names
 * an `event`, and a wikilink a `prose` anchor. **A note has one namespace**: its event `id`s
 * sit beside its body anchors, and a slug two of them share is a finding.
 *
 * **A leaf, deliberately.** This is asked by the link checker, by the content
 * index, and by the builds that emit a link, and they cannot all import one
 * another: `helpers.mjs` is imported by the compilers, while the index imports
 * the manifest emitter, which imports them back. A reader that imports nothing
 * can be shared by all three — which is the point, because the question "what
 * anchors does this note declare?" had two answers and they disagreed on
 * `{#CalendarFormat}`.
 *
 * The suffix itself is read by {@link module:engine/heading-attributes}, which
 * {@link module:engine/journals.splitPages} also reads it through — so the index
 * cannot name an anchor the pages do not carry.
 *
 * @module
 */

import { scanAlerts } from "./content-alerts.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { scanPoetry } from "./content-poetry.mjs";
import { scanSpans } from "./content-spans.mjs";
import { codeRegions } from "./code-fences.mjs";
import { slugify } from "./content-slug.mjs";
import { scanFigures } from "./content-figures.mjs";
import { HEADING_LINE, splitHeadingAttributes } from "./heading-attributes.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * What an anchor marks. `prose` is every anchor the body declares — a heading,
 * a caption, a block, an alert, a poem or a span — and `event` is the `id` of
 * an entry in `data.events`.
 */
export const ANCHOR_KINDS = Object.freeze(["prose", "event"]);

/**
 * The identifiers a note declares on headings, captions, divs, poems and spans.
 *
 * Headings and captions may start journal pages. Div, poem and inline-span
 * anchors address locations within their containing pages.
 *
 * @param {string} body - The note's markdown body, frontmatter already removed.
 * @param {number} [bodyLine] - The 1-based file line the body starts on, from
 *   `parseMarkdownFile`. Anchors are reported at their position in the **file**,
 *   so an editor can jump straight to one; passing nothing numbers from the body.
 * @param {(address: string) => string|undefined} [resolveRole] - From a
 *   picture's address to the role its asset declares, so a figure anchor's
 *   `name` reads `Map 1` rather than `Figure 1` where it is due — see
 *   {@link module:engine/content-figures.scanFigures}.
 * @returns {Array<{slug: string, name: string, level: number, line: number,
 *   kind: string}>} In document order.
 */
export function collectAnchors(body, bodyLine = 1, resolveRole) {
    const anchors = [];
    const literal = codeRegions(body, { spans: false, poetryAsProse: false });
    let offset = 0;
    const lines = String(body ?? "").split("\n");

    for (let i = 0; i < lines.length; i++) {
        const lineOffset = offset;
        offset += lines[i].length + 1;
        if (literal.some((region) => lineOffset >= region.start && lineOffset < region.end))
            continue;

        const heading = HEADING_LINE.exec(lines[i]);
        if (!heading) continue;
        const attributes = splitHeadingAttributes(heading[2]);
        if (!attributes.id) continue;
        anchors.push({
            slug: attributes.id,
            name: attributes.text,
            level: heading[1].length,
            line: bodyLine + i,
            kind: "prose",
        });
    }
    for (const figure of scanFigures(body, { resolveRole }).figures) {
        if (!figure.id) continue;
        anchors.push({
            slug: figure.id,
            name: figure.label || figure.caption,
            level: 1,
            line: bodyLine + figure.line - 1,
            kind: "prose",
        });
    }
    const blockAnchors = (source, firstLine) => {
        const sourceLines = source.split("\n");
        for (const block of scanBlocks(source).blocks) {
            if (block.id)
                anchors.push({
                    slug: slugify(block.id),
                    name: block.title || block.id,
                    level: 0,
                    line: firstLine + block.start,
                    kind: "prose",
                });
            blockAnchors(
                sourceLines.slice(block.start + 1, block.end).join("\n"),
                firstLine + block.start + 1,
            );
        }
    };
    blockAnchors(String(body ?? ""), bodyLine);
    for (const alert of scanAlerts(body).blocks) {
        if (alert.id)
            anchors.push({
                slug: slugify(alert.id),
                name: alert.title,
                level: 0,
                line: bodyLine + alert.start,
                kind: "prose",
            });
    }
    for (const poem of scanPoetry(body).blocks) {
        if (poem.id)
            anchors.push({
                slug: slugify(poem.id),
                name: poem.id,
                level: 0,
                line: bodyLine + poem.start,
                kind: "prose",
            });
    }
    for (const span of scanSpans(body).spans) {
        if (span.id)
            anchors.push({
                slug: slugify(span.id),
                name: span.text,
                level: 0,
                line: bodyLine + span.line - 1,
                kind: "prose",
            });
    }
    return anchors.sort((a, b) => a.line - b.line);
}

/** Collisions involving a div, verse or inline-span anchor.
 * Heading and caption collisions are diagnosed by their existing scanners.
 * @param {string} body - Authored Markdown.
 * @returns {Array<{line: number, column: number, message: string}>} Located collisions.
 */
export function markupAnchorFindings(body) {
    const groups = new Map();
    for (const anchor of collectAnchors(body)) {
        const slug = slugify(anchor.slug);
        if (!groups.has(slug)) groups.set(slug, []);
        groups.get(slug).push(anchor);
    }
    const errors = [];
    for (const [slug, anchors] of groups) {
        if (anchors.length < 2 || !anchors.some((anchor) => anchor.level === 0)) continue;
        for (const anchor of anchors.slice(1))
            errors.push({
                line: anchor.line,
                column: 1,
                message: `duplicate markup anchor "${slug}"`,
            });
    }
    return errors;
}

/**
 * The anchors a note's events declare: one per `data.events` entry carrying
 * an `id`, at the line its `id` is written on.
 *
 * The `id` is taken as written — {@link module:engine/note-events} holds it to
 * the address-segment charset — and named by the note's own name for the event
 * when one is given, else by its summary.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {string} [raw] - The note's full text, for the line; without it the
 *   line is omitted rather than guessed.
 * @returns {Array<{slug: string, name: string, level: number, line?: number,
 *   kind: "event"}>} In entry order.
 */
export function eventAnchors(fm, raw) {
    const events = fm?.data?.events;
    if (!Array.isArray(events)) return [];
    const out = [];
    events.forEach((entry, position) => {
        if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id)
            return;
        const named =
            Array.isArray(entry.names) ? entry.names.find((n) => n?.name)?.name : undefined;
        const { line } =
            raw ? positionOfFrontmatterPath(raw, ["data", "events", position, "id"]) : {};
        out.push({
            slug: entry.id,
            name: String(named ?? entry.summary ?? entry.id),
            level: 0,
            ...(line ? { line } : {}),
            kind: "event",
        });
    });
    return out;
}

/**
 * Event `id`s that repeat one of the note's body anchors.
 *
 * A note's anchors are one namespace, so `place-ironfells#sack` names one
 * thing whether `sack` is a heading or an event. Two body anchors that collide
 * are reported by the scanners that read them, and two events sharing an `id`
 * by the event check; this reports the remaining case, an event against a body
 * anchor, at the event's `id`.
 *
 * @param {{file: string, fm: object, raw?: string, body?: string}} note - The
 *   note, as the link index hands it over.
 * @returns {object[]} Findings, each at the colliding `id`.
 */
export function noteAnchorFindings(note) {
    const events = eventAnchors(note.fm, note.raw);
    if (!events.length) return [];
    const body =
        typeof note.body === "string" ?
            note.body
        :   String(note.raw ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "");
    const taken = new Map();
    for (const anchor of collectAnchors(body)) {
        const slug = slugify(anchor.slug);
        if (!taken.has(slug)) taken.set(slug, anchor);
    }
    const findings = [];
    const entries = note.fm.data.events;
    for (const event of events) {
        const other = taken.get(slugify(event.slug));
        if (!other) continue;
        const position = entries.findIndex((entry) => entry?.id === event.slug);
        findings.push({
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "events", position, "id"]),
            severity: "error",
            message:
                `\`data.events.${position}.id\` ${event.slug} is already a prose anchor ` +
                "in this note — a note's anchors are one namespace, so an event's `id` " +
                "differs from every heading, caption and block slug",
        });
    }
    return findings;
}
