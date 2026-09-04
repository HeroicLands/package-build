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
 * The authoring reference, generated from the declared item fields.
 *
 * **Generated because a hand-written one would be wrong within a release.** The
 * overwhelming majority of a content repository's compiled documents are items
 * — 1,230 of SoHL's 1,362 when this was written — and a table spanning a dozen
 * types, each with a shape, a default and a requiredness, is exactly the kind of
 * prose that drifts silently from the code it describes. The declarations
 * (`fields` on each `itemBuilders` entry) already *are* that table, so the page
 * is rendered from them rather than transcribed (#22).
 *
 * **It ships here, not in the consumer.** Any repository can define an item
 * type of its own, so "what frontmatter does this type accept?" is a question
 * every consuming repository has. Rendering from the resolved configuration
 * means each one documents *its own* registry with the same command, rather
 * than SoHL owning a generator the others cannot run.
 *
 * Package-agnostic: it knows the declaration vocabulary, and nothing about any
 * particular type. The types themselves come from configuration.
 *
 * @module
 */

import { authoredFields } from "./field-spec.mjs";
import { loadPackConfig } from "./pack-config.mjs";

/**
 * Render a value the way an author would write it in YAML frontmatter.
 *
 * @param {any} value - The default a field declares.
 * @returns {string} An inline-code cell, or an em dash when there is no
 *   default to show.
 */
function renderDefault(value) {
    if (value === undefined) return "—";
    if (value === null) return "`null`";
    if (typeof value === "string") return value === "" ? '`""`' : `\`${value}\``;
    if (Array.isArray(value)) return value.length === 0 ? "`[]`" : `\`${JSON.stringify(value)}\``;
    if (typeof value === "object") {
        const json = JSON.stringify(value);
        return json === "{}" ? "`{}`" : `\`${json}\``;
    }
    return `\`${String(value)}\``;
}

/** Escape the pipe that would otherwise end a markdown table cell. */
function cell(text) {
    return String(text).replace(/\|/g, "\\|");
}

/**
 * A markdown table with every column padded to its widest cell.
 *
 * **Padded so the generated page is stable under Prettier.** A consumer commits
 * this page and formats its repository; Prettier aligns markdown table columns,
 * so an unpadded table is rewritten the moment the formatter runs — and the
 * `--check` guard then reports the page stale on every clean checkout, with the
 * formatter and the generator each undoing the other.
 *
 * Plain `.length` rather than a display-width measure, because that is what
 * Prettier's alignment comes to for this content: every cell is Latin text,
 * backticks and the odd em dash, each of which counts one. A cell holding a
 * wide character would need the measure Prettier uses; there are none, and
 * `tests/field-reference.test.ts` fails if the rendered page ever stops
 * agreeing with Prettier.
 *
 * @param {string[][]} rows - The header row, then the body.
 * @returns {string[]} Markdown lines.
 */
function padTable(rows) {
    const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
    const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
    const [header, ...body] = rows;
    return [line(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...body.map(line)];
}

/**
 * The field table for one type.
 *
 * @param {readonly object[]} fields - The type's declaration.
 * @returns {string[]} Markdown lines.
 */
function fieldTable(fields) {
    const authored = authoredFields(fields);
    if (!authored.length) {
        return ["This type reads no `sohl:` fields of its own."];
    }
    const rows = [
        ["Field", "Shape", "Required", "Default", "Description"],
        ...authored.map((field) => [
            `\`${field.name}\``,
            cell(field.shape ?? "as authored"),
            field.required ? "**yes**" : "no",
            field.required ? "—" : renderDefault(field.default),
            cell(field.describe ?? ""),
        ]),
    ];
    return padTable(rows);
}

/**
 * The fields of one type that are **not** filled from the note's top level.
 *
 * A field ordinarily falls back to the top-level property spelled like its
 * name, so an author who writes `weight: 3` at the top of a note reasonably
 * expects it to reach the document. Where that spelling means something else at
 * the note level the fallback is off, and an author has no way to tell from the
 * table — the field is there, the value is written, and the document ships the
 * default. So the reason each such field declares is rendered beside its table
 * rather than left in the source (#218).
 *
 * Below the table, not inside it: the reason is a sentence or two, and
 * {@link padTable} pads every column to its widest cell, so a cell holding it
 * would stretch the whole type's table past legibility.
 *
 * @param {readonly object[]} fields - The type's declaration.
 * @returns {string[]} Markdown lines, empty when the type exempts nothing.
 */
function sharedExemptions(fields) {
    const exempt = authoredFields(fields).filter((field) => field.topLevelMeans);
    if (!exempt.length) return [];
    return exempt.flatMap((field) => [
        `**\`${field.name}\` is not read from the note's top level.** There it means ` +
            `${field.topLevelMeans}`,
        "",
    ]);
}

/**
 * A minimal note for one type: the frontmatter envelope every note carries,
 * plus exactly the `sohl:` fields the type requires.
 *
 * Minimal is the point — an example carrying every optional field would teach
 * that they are expected, and would itself need maintaining. What is shown is
 * the smallest note that compiles.
 *
 * @param {string} type - The item type.
 * @param {readonly object[]} fields - Its declaration.
 * @returns {string[]} Markdown lines, a fenced YAML block.
 */
function workedExample(type, fields) {
    const required = authoredFields(fields).filter((field) => field.required);
    const lines = [
        // `markdown`, not `yaml`: the block is a whole note — frontmatter *and*
        // the prose beneath it — so labelling it YAML was wrong about the
        // content. It also made the page unstable, because Prettier formats a
        // fenced block in the language it declares, and reformatting this one as
        // YAML dropped the blank line after the frontmatter.
        "```markdown",
        "---",
        "name:",
        `  full: An Example ${type}`,
        `type: ${type}`,
        "shortcode: xmpl",
        // No `package:`. A note's package is the repository's configured
        // `contentPackage`, and declaring the field is a build error (#56) —
        // this example is the smallest note that compiles.
        "id: <16-character id>",
        "sohl:",
        "  archetype: null",
    ];
    for (const field of required) {
        lines.push(`  ${field.name}: <${field.shape ?? "value"}>`);
    }
    lines.push("---", "", "The prose here compiles into the item's documentation.", "```");
    return lines;
}

/**
 * Render the per-type item frontmatter reference.
 *
 * @param {object} [options] - Rendering options.
 * @param {string} [options.title] - The page's H1.
 * @param {string[]} [options.preamble] - Lines placed after the H1, before the
 *   first type. Written by the consumer, since only it knows what its page
 *   should link to.
 * @param {string} [options.generatedBy] - What a reader should re-run to
 *   regenerate the page, named in the do-not-edit banner.
 * @param {object} [options.config] - Resolved configuration. Defaults to the
 *   consumer's own.
 * @returns {string} The complete markdown page.
 */
export function renderItemFieldReference({
    title = "Item Note Frontmatter",
    preamble = [],
    generatedBy = "the content-build field reference generator",
    config = loadPackConfig(),
} = {}) {
    const declared = config.itemFields ?? {};
    const types = [...config.itemTypes].sort();
    const documented = types.filter((type) => declared[type]?.length);
    const undocumented = types.filter((type) => !declared[type]?.length);

    const lines = [
        `# ${title}`,
        "",
        `<!-- AUTO-GENERATED FILE — do not edit by hand.`,
        `     Generated by ${generatedBy}.`,
        `     Every field comes from the \`fields\` declaration on that type's`,
        `     \`itemBuilders\` entry, which is also what builds the document. -->`,
        "",
        ...preamble,
    ];
    if (preamble.length) lines.push("");

    lines.push(
        `${documented.length} of the ${types.length} item types this ` +
            `repository compiles declare their frontmatter below. Every field ` +
            `is written under a note's \`sohl:\` block; a dotted name such as ` +
            `\`impact.die\` is a nested key. A field a note does not carry ` +
            `takes the default shown, and a **required** field has none — ` +
            `omitting it fails the build rather than guessing.`,
        "",
    );

    for (const type of documented) {
        lines.push(
            `## ${type}`,
            "",
            ...fieldTable(declared[type]),
            "",
            ...sharedExemptions(declared[type]),
            ...workedExample(type, declared[type]),
            "",
        );
    }

    if (undocumented.length) {
        lines.push(
            "## Types that declare no fields",
            "",
            "These compile, but their `itemBuilders` entry declares no " +
                "`fields`, so nothing here can say what they accept:",
            "",
            ...undocumented.map((type) => `- \`${type}\``),
            "",
        );
    }

    // Trailing blank lines trimmed, so a caller adding its own newline gets
    // exactly one. Sections push a separating "" after themselves, which leaves
    // one at the end; Prettier strips it, and a page that disagrees with the
    // formatter by one character is rewritten on the consumer's next format run
    // and then reported stale by `--check` forever after.
    return lines.join("\n").replace(/\n+$/, "");
}
