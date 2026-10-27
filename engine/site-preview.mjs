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

/** Buffer-only HTML preview shared by editors and external renderers. @module */

import { sharedContentRules } from "./content-styles.mjs";
import { readMatter } from "./note-matter.mjs";
import { scanFigures } from "./content-figures.mjs";
import { createRenderer, inertHtml } from "./content-render.mjs";
import { PREVIEW_HELPERS, colored, wikiSource } from "./preview-source.mjs";
import { dataFields } from "./note-vocabulary.mjs";
import { applyComputedBeingAge } from "./being-age.mjs";
import { DEFAULT_CURRENT_DATE, normalizeCurrentDate } from "./current-date.mjs";
import { scanRuns } from "./content-scripts.mjs";

export { PREVIEW_HELPERS };

const escape = (value) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

/** A small profile from authored fields; references never acquire resolved data. */
function localInfobox(fm, md) {
    const fields = dataFields(fm.type) ?? [];
    const rows = [];
    const present = (value) => (typeof value === "string" ? value : JSON.stringify(value));
    for (const [name, value] of Object.entries(fm.data ?? {})) {
        if (["seeAlso", "related", "pack", "packFolder"].includes(name)) continue;
        if (name === "age" && (value === null || value === undefined || value === "")) continue;
        const field = fields.find((field) => field.name === name);
        const source = present(value);
        let html;
        if (
            typeof value === "string" &&
            /^!?\[\[/.test(value) &&
            (/^!/.test(value) || ["portrait", "banner", "icon", "token", "image"].includes(name))
        )
            html = wikiSource(value);
        else if (
            field?.kind === "address" ||
            field?.entryKind === "address" ||
            field?.ref ||
            field?.accepts ||
            ["born", "died", "calendar", "map", "events"].includes(name)
        )
            html = colored("dependent", source);
        else html = md.renderInline(source ?? "");
        rows.push(`<dt>${escape(name)}</dt><dd>${html}</dd>`);
    }
    if (!rows.length) return "";
    return `<aside class="hl-preview-infobox"><dl>${rows.join("")}</dl></aside>`;
}

/**
 * Render one complete buffer.
 *
 * Without `index` the buffer is rendered with no configuration, content index,
 * filesystem or database: wikilinks, spans and expressions show as highlighted
 * authored source. With `index` the buffer is expanded as the website expands
 * a page and rendered as every target renders it, so links, embeds, marked
 * text, icons and figure numbers read as they will on the page; only what a
 * buffer cannot answer, such as a query, stays highlighted source.
 *
 * @param {string} text - Markdown, optionally beginning with YAML frontmatter.
 * @param {{dark?: boolean, infobox?: boolean, file?: string, currentDate?: string,
 *   index?: import("./preview-index.mjs").PreviewIndex}} [options] - Explicit palette, profile visibility, diagnostic filename, neutral current date (default "720.1") and the content index, from {@link module:engine/preview-index.previewIndex}.
 * @returns {{ok: boolean, html: string, frontmatter: object, findings: object[]}} HTML and metadata with locally calculable ages; unavailable ages remain absent or null. Error findings set `ok` to false while retaining the HTML.
 */
export function renderPreview(
    text,
    { dark = false, infobox = true, file = "", currentDate = DEFAULT_CURRENT_DATE, index } = {},
) {
    const date = normalizeCurrentDate(currentDate);
    const findings = [];
    let bodyLine = 1;
    let frontmatter = {},
        body = String(text ?? "");
    try {
        const parsed = readMatter(body);
        frontmatter =
            parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ?
                structuredClone(parsed.data)
            :   {};
        bodyLine = body.slice(0, body.length - parsed.content.length).split("\n").length;
        body = parsed.content;
    } catch (error) {
        findings.push({ file, severity: "warning", message: String(error.message) });
    }
    applyComputedBeingAge(frontmatter, date);
    if (String(frontmatter.type ?? "").toLowerCase() === "being") {
        frontmatter.data ??= {};
        if (
            typeof frontmatter.data === "object" &&
            !Array.isArray(frontmatter.data) &&
            !Object.hasOwn(frontmatter.data, "age")
        )
            frontmatter.data.age = null;
    }
    // A tag the author wrote reads as text; the stages below write the only HTML.
    const authored = inertHtml(body);
    const indexed = Boolean(index);
    const scan = scanFigures(authored);
    const renderer = createRenderer("preview", {
        source: !indexed,
        sourceContext: {
            fm: frontmatter,
            file,
            figures: new Map(scan.figures.filter((f) => f.id).map((f) => [f.id, f])),
        },
        icons: index?.icons,
        images: index && { lookupAsset: index.lookupAsset },
    });
    let markdown = authored;
    let figures = scan.figures;
    if (indexed) {
        for (const error of scanRuns(body, index.runs).errors)
            findings.push({
                file,
                severity: "error",
                ...error,
                line: error.file && error.file !== file ? error.line : bodyLine + error.line - 1,
            });
        const expanded = index.expand(authored, { fm: frontmatter, file });
        markdown = expanded.markdown;
        figures = expanded.figures;
    }
    const content = renderer.render(markdown, {
        runs: index?.runs,
        figures,
        resolveSrc: index?.resolveSrc,
    });
    const profile = infobox ? localInfobox(frontmatter, renderer.md) : "";
    return {
        ok: !findings.some((finding) => finding.severity === "error"),
        html: `<div class="hl-preview hl-preview-${dark ? "dark" : "light"}">${profile}<main class="hl-preview-main">${content}</main></div>`,
        frontmatter,
        findings,
    };
}

/**
 * Opt in to reading only the project's currentDate setting; never called by renderPreview.
 * @param {string} root - Directory from which to find the nearest package configuration.
 * @returns {Promise<string>} Validated neutral date, or the shared default when no setting is present.
 */
export async function readPreviewCurrentDate(root) {
    const reader = await import("./preview-current-date.mjs");
    return reader.readPreviewCurrentDate(root);
}

/** Both explicit palettes, scoped to the preview container. */
export function previewStyles() {
    return `
.hl-preview.hl-preview-light { --hl-bg:#ffffff; --hl-panel:#f6f8fa; --hl-fg:#24292f; --hl-blue:#0969da; --hl-purple:#6c3fd1; --hl-green:#1a7f37; --hl-grey:#57606a; --hl-note:#0969da; --hl-note-bg:#f6faff; --hl-tip:#1a7f37; --hl-tip-bg:#f4fbf5; --hl-important:#6c3fd1; --hl-important-bg:#faf7ff; --hl-warning:#9a6700; --hl-warning-bg:#fffaf0; color-scheme:light; }
.hl-preview.hl-preview-dark { --hl-bg:#0d1117; --hl-panel:#161b22; --hl-fg:#e6edf3; --hl-blue:#58a6ff; --hl-purple:#c4b0ff; --hl-green:#7ee787; --hl-grey:#8b949e; --hl-note:#58a6ff; --hl-note-bg:#101a28; --hl-tip:#7ee787; --hl-tip-bg:#102018; --hl-important:#c4b0ff; --hl-important-bg:#1c172a; --hl-warning:#d29922; --hl-warning-bg:#241d10; color-scheme:dark; }
.hl-preview { background:var(--hl-bg); color:var(--hl-fg); padding:1rem; overflow-wrap:anywhere; }
.hl-preview .hl-preview-main { color:var(--hl-fg); background:var(--hl-bg); }
.hl-preview a, .hl-preview .hl-preview-bracket { color:var(--hl-blue)!important; opacity:1!important; }
.hl-preview .hl-preview-address { color:var(--hl-purple)!important; opacity:1!important; }
.hl-preview .hl-preview-label { color:var(--hl-fg)!important; font-weight:700!important; opacity:1!important; }
.hl-preview .hl-preview-dependent { color:var(--hl-green)!important; opacity:1!important; }
.hl-preview .hl-preview-attribute, .hl-preview .hl-preview-fence, .hl-preview .hl-preview-fence code { color:var(--hl-grey)!important; font-weight:400!important; opacity:1!important; }
.hl-preview pre, .hl-preview code, .hl-preview .hl-preview-infobox { background:var(--hl-panel); }
.hl-preview pre { padding:1rem; white-space:pre-wrap; }
.hl-preview .hl-preview-infobox { padding:1rem; color:var(--hl-fg); }
@media (min-width:48rem) { .hl-preview:has(> .hl-preview-infobox) { display:grid; grid-template-columns:minmax(0,1fr) minmax(14rem,20rem); gap:1.5rem; align-items:start; } .hl-preview > .hl-preview-infobox { grid-column:2; grid-row:1; } .hl-preview > .hl-preview-main { grid-column:1; grid-row:1; } }
.hl-preview dt { font-weight:700; }
.hl-preview dd { font-weight:400; }
.hl-preview .dictionary { --indent:150px; --gap:.75em; margin:0; display:block; }
.hl-preview .dictionary > div { padding-left:var(--indent); text-indent:calc(-1 * var(--indent)); margin-bottom:.5em; }
.hl-preview .dictionary > div > dt { display:inline-block; min-width:calc(var(--indent) - var(--gap)); margin-right:var(--gap); font-weight:bold; white-space:nowrap; text-indent:0; text-align:left; }
.hl-preview .dictionary > div > dd { display:inline; margin:0; font-weight:normal; }
.hl-preview .dictionary > div > dd > :is(p, ul, ol, dl, blockquote, pre, table, div) { text-indent:0; }
.hl-preview .dictionary > div > dd > p:first-child { display:inline; }
@media (max-width:600px) { .hl-preview .dictionary { --indent:100px; } }
.hl-preview .hl-preview-span, .hl-preview .hl-preview-span .hl-preview-attribute, .hl-preview .hl-preview-span .hl-preview-bracket { font-weight:700!important; }
.hl-preview .hl-preview-secret { cursor:help; }
.hl-preview .hl-preview-secret:not(:hover):not(:focus):not(:focus-within) .hl-preview-secret-content { color:transparent!important; background-color:var(--hl-fg)!important; text-shadow:none!important; }
.hl-preview .hl-preview-secret:not(:hover):not(:focus):not(:focus-within) .hl-preview-secret-content * { color:transparent!important; -webkit-text-fill-color:transparent!important; visibility:hidden!important; text-shadow:none!important; text-decoration-color:transparent!important; }
.hl-preview .hl-preview-secret:focus { outline:2px solid var(--hl-blue); outline-offset:2px; }
.hl-preview .hl-preview-infobox dd { margin:0 0 .5rem; white-space:pre-wrap; }
.hl-preview .hl-preview-align-center { text-align:center; }
.hl-preview .hl-preview-align-right { text-align:right; }
.hl-preview .hl-preview-align-left { text-align:left; }
.hl-preview th, .hl-preview td { background:var(--hl-bg); color:var(--hl-fg); padding:.3rem .6rem; border:1px solid var(--hl-grey); }
.hl-preview .alert { border:0; border-left:4px solid var(--hl-accent); background:var(--hl-alert-bg); color:var(--hl-fg); padding:1rem; border-radius:.375rem; margin:1rem 0; }
.hl-preview .alert-note { --hl-accent:var(--hl-note); --hl-alert-bg:var(--hl-note-bg); }
.hl-preview .alert-tip { --hl-accent:var(--hl-tip); --hl-alert-bg:var(--hl-tip-bg); }
.hl-preview .alert-important { --hl-accent:var(--hl-important); --hl-alert-bg:var(--hl-important-bg); }
.hl-preview .alert-warning { --hl-accent:var(--hl-warning); --hl-alert-bg:var(--hl-warning-bg); }
.hl-preview .alert .alert-title { color:var(--hl-accent); font-weight:700; opacity:1; }
.hl-preview .alert .alert-icon { width:1em; height:1em; margin-right:.5em; vertical-align:-.1em; color:var(--hl-accent); fill:currentColor; }
${sharedContentRules(".hl-preview")}
`;
}
