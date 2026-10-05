/* SPDX-License-Identifier: GPL-3.0-or-later */

/** The authored verse lines, excluding stanza separators. */
export function verseLines(body) {
    return String(body ?? "")
        .split("\n")
        .filter((line) => line.trim());
}

/**
 * The least-indented verse is level zero. Every two additional leading spaces
 * add one level; a leftover space is discarded and the level stops at eight.
 * Blank lines divide stanzas rather than contributing to the baseline.
 */
export function poetryStanzas(body) {
    const lines = String(body ?? "").split("\n");
    const verses = verseLines(body);
    if (!verses.length) return [];
    const baseline = Math.min(...verses.map((line) => /^ */.exec(line)[0].length));
    const stanzas = [];
    let stanza = [];
    for (const line of lines) {
        if (!line.trim()) {
            if (stanza.length) stanzas.push(stanza);
            stanza = [];
            continue;
        }
        const spaces = /^ */.exec(line)[0].length;
        stanza.push({
            text: line.slice(spaces).trimEnd(),
            level: Math.min(8, Math.floor((spaces - baseline) / 2)),
        });
    }
    if (stanza.length) stanzas.push(stanza);
    return stanzas;
}

/** A verse is inline Markdown even when it starts with block syntax. */
export function inlineVerse(text) {
    return String(text)
        .replace(/^(#{1,6}\s|>\s|[-+*]\s|:{1,2}\s|`{3,}|~{3,}|-{3,}\s*$)/, "\\$1")
        .replace(/^(\d+)([.)])\s/, "$1\\$2 ");
}

/**
 * Keep stanzas as Markdown paragraphs and make every verse line a hard break.
 * The surrounding renderer still sees the entire note, so links and footnote
 * definitions remain in scope. The span carries the indent for each line.
 */
export function poetryMarkdown(body) {
    return poetryStanzas(body)
        .map((stanza) =>
            stanza
                .map(
                    ({ text, level }) =>
                        `<span class="poetry-line${level ? ` i${level}` : ""}">${inlineVerse(text)}</span>`,
                )
                .join("  \n"),
        )
        .join("\n\n");
}

import { slugify } from "./content-slug.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

/** Read poetry code fences; start/end are inclusive zero-based source lines.
 * @param {string} source - Authored Markdown.
 */
export function scanPoetry(source) {
    const lines = String(source ?? "").split("\n"),
        blocks = [],
        errors = [];
    let opening = null;
    for (let i = 0; i < lines.length; i++) {
        const match = /^ *(`{3,}|~{3,})(.*)$/.exec(lines[i]);
        if (opening) {
            if (
                match &&
                match[1][0] === opening.fence[0] &&
                match[1].length >= opening.fence.length &&
                !match[2].trim()
            ) {
                if (opening.name === "poetry") {
                    const body = lines.slice(opening.start + 1, i).join("\n");
                    if (!body.trim())
                        errors.push({
                            line: opening.start + 1,
                            column: 1,
                            message: "poetry block is empty",
                        });
                    for (let n = opening.start + 1; n < i; n++) {
                        const col = lines[n].indexOf("\t");
                        if (col >= 0)
                            errors.push({
                                line: n + 1,
                                column: col + 1,
                                message: "tabs are not allowed in poetry",
                            });
                    }
                    if (
                        opening.attributes.syllables &&
                        opening.attributes.syllables.split(",").length !== verseLines(body).length
                    )
                        errors.push({
                            line: opening.start + 1,
                            column: 1,
                            message: `poetry syllables= gives ${opening.attributes.syllables.split(",").length} counts for ${verseLines(body).length} verse lines`,
                        });
                    blocks.push({ ...opening, end: i, body });
                }
                opening = null;
            }
            continue;
        }
        if (!match) continue;
        const info = match[2].trim();
        opening = {
            start: i,
            fence: match[1],
            name: info.split(/\s/)[0],
            attributes: {},
            id: "",
            classes: [],
            indent: /^ */.exec(lines[i])[0],
        };
        if (opening.name !== "poetry") continue;
        const raw = info.slice(6).trim();
        const at = { line: i + 1, column: 1 };
        if (raw && !/^\{[^}\n]*\}$/.test(raw)) {
            errors.push({ ...at, message: "poetry attributes need {…} braces" });
            continue;
        }
        const parsed = parseExtensionAttributes(raw ? raw.slice(1, -1) : "");
        opening.id = parsed.id;
        opening.classes = parsed.classes;
        opening.attributes = parsed.values;
        for (const message of [...parsed.problems, ...refusedAttributes(parsed.values)])
            errors.push({ ...at, message });
        for (const [key, value] of Object.entries(parsed.values)) {
            if (!["form", "meter", "rhyme", "syllables", "lang"].includes(key))
                errors.push({ ...at, message: `${key}= is not a poetry attribute` });
            else if (key === "syllables" && !/^[1-9]\d*(?:,[1-9]\d*)*$/.test(value))
                errors.push({
                    ...at,
                    message: "poetry syllables= needs positive comma-separated counts",
                });
            else if (key === "lang" && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value))
                errors.push({ ...at, message: "poetry lang= needs a language tag" });
        }
    }
    if (opening?.name === "poetry")
        errors.push({
            line: opening.start + 1,
            column: 1,
            message: "poetry block needs a closing code fence",
        });
    return { blocks, errors };
}

/** Replace verse fences with HTML wrappers whose body remains inline Markdown.
 * @param {string} source - Authored Markdown.
 */
export function renderPoetry(source) {
    const { blocks, errors } = scanPoetry(source),
        lines = String(source ?? "").split("\n"),
        output = [];
    let cursor = 0;
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    for (const block of blocks) {
        output.push(...lines.slice(cursor, block.start));
        const attrs = [`class="${escape(["poetry", ...block.classes].join(" "))}"`];
        if (block.id) attrs.push(`id="${escape(slugify(block.id))}"`);
        for (const [key, value] of Object.entries(block.attributes))
            if (!refusedAttributes({ [key]: value }).length)
                attrs.push(`${key === "lang" ? key : `data-${key}`}="${escape(value)}"`);
        let indent = block.indent;
        if (
            indent.length >= 4 &&
            !lines.slice(0, block.start).some((line) => /^ *(?:[-+*]|\d+[.)]) +/.test(line))
        )
            indent = "";
        output.push(
            "",
            `${indent}<div ${attrs.join(" ")}>`,
            "",
            ...poetryMarkdown(block.body)
                .split("\n")
                .map((line) => (line ? indent + line : line)),
            "",
            `${indent}</div>`,
            "",
        );
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors };
}
