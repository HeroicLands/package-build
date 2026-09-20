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
 * is rendered from them rather than transcribed.
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

import path from "node:path";
import matter from "gray-matter";

import { authoredFields, runtimeOnlyFields } from "./field-spec.mjs";
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
            // Three different answers, and the third is not a value. A
            // required field has no default because omitting it fails the
            // build; an `omitWhenAbsent` field has none because omitting it
            // omits the *key*, leaving the data model to answer. Rendering
            // both as the em dash a missing default already prints would put
            // two opposite behaviours in one cell.
            field.required ? "—"
            : field.omitWhenAbsent ? "_omitted_"
            : renderDefault(field.default),
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
 * rather than left in the source.
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
 * The fields of one type that a note may **never** write.
 *
 * A type's table lists what an author writes, and says nothing about the rest
 * of its schema — which is right for a constant or a derived value, since
 * nothing happens if a note writes the path anyway. A runtime-only field is
 * different in the way that matters to a reader: it is a real part of the
 * document, it is spelled beside fields they *do* write — `onsetDate` sits next
 * to `onsetDurationFormula` — and authoring it fails the build. Leaving it
 * unmentioned means an author meets the rule as an error rather than as
 * documentation.
 *
 * Rendered from each field's own reason, for the same purpose
 * {@link sharedExemptions} renders `topLevelMeans` for: the declaration already
 * states it, and a page restating it in other words is a second copy to keep
 * true.
 *
 * @param {readonly object[]} fields - The type's declaration.
 * @returns {string[]} Markdown lines, empty when the type declares none.
 */
function runtimeState(fields) {
    const runtime = runtimeOnlyFields(/** @type {never} */ (fields));
    if (!runtime.length) return [];
    return [
        "**Never authored.** These fields are part of the document and are " +
            "written during play, so a note that declares one fails the build. " +
            "Left out of the compiled document entirely, they carry the data " +
            "model's own initial value until play writes them.",
        "",
        ...runtime.map((field) => `- \`${field.to}\` — ${cell(field.runtimeOnly)}`),
        "",
    ];
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
        // `contentPackage`, and declaring the field is a build error —
        // this example is the smallest note that compiles.
        //
        // No `id:` either, for the same reason it is not shown optional-first:
        // a note's document `_id` derives from its canonical address, and the
        // authored field is the escape hatch for keeping a
        // document's identity across a shortcode rename, not part of the
        // envelope. This block is the one an author copies as a template, so
        // showing the field taught every note in the tree to write it.
        "sohl:",
        "  templatePriority: null",
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
            `takes the default shown; a **required** field has none — omitting ` +
            `it fails the build rather than guessing — and one shown as ` +
            `_omitted_ has none either, because leaving it out leaves the key ` +
            `out of the compiled document, so the data model's own initial ` +
            `value stands.`,
        "",
    );

    for (const type of documented) {
        lines.push(
            `## ${type}`,
            "",
            ...fieldTable(declared[type]),
            "",
            ...sharedExemptions(declared[type]),
            ...runtimeState(declared[type]),
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

/**
 * @param {unknown} value - Anything.
 * @returns {boolean} Whether it is a mapping a field may be read out of.
 */
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `overlay` onto `base`. Plain objects merge key-by-key;
 * everything else (arrays, primitives, `null`) replaces. Inputs are not
 * mutated.
 *
 * @param {any} base - The generated envelope.
 * @param {any} overlay - The consumer's declared `frontmatter`.
 * @returns {any} The merged value.
 */
function deepMerge(base, overlay) {
    if (overlay === undefined) return base;
    if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
    const out = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
}

/**
 * Whether a destination file sits under a content tree.
 *
 * The one question that decides whether `docs item-fields` writes a note
 * envelope: `assets/content/` walks every file under it for its `type:`, so a
 * generated page filed there needs one to publish at all, while a page filed
 * anywhere else — a repository's own `docs/` — is read by nobody but Hugo's
 * `--check` guard and the reader following a link, neither of which wants
 * frontmatter.
 *
 * @param {string} destination - Absolute path of the file being written.
 * @param {string} contentRoot - Absolute path of the content tree root
 *   (`config.paths.content`).
 * @returns {boolean} Whether `destination` resolves inside `contentRoot`.
 */
export function isUnderContentTree(destination, contentRoot) {
    const relative = path.relative(contentRoot, destination);
    return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

/**
 * A note's `shortcode`, derived from the basename of its destination file.
 *
 * Lowercase alphanumerics only — the address charset every other shortcode in
 * the tree is held to — so `item-frontmatter.md` derives `itemfrontmatter`
 * rather than carrying a hyphen no address segment permits.
 *
 * @param {string} destination - Where the note is written.
 * @returns {string} The derived shortcode.
 */
export function shortcodeFromBasename(destination) {
    return path
        .basename(destination, path.extname(destination))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/**
 * The note envelope `docs item-fields` writes when its page lives in the
 * content tree.
 *
 * The universal keys every note in the format carries: `type: doc`,
 * `subType: reference` — this page is out-of-world lookup material, the same
 * genre as every other generated reference — a `shortcode`, `name.full` from
 * the page's title, and `pack: none`, since the page publishes to the website
 * and compiles into no compendium document. A consumer's own
 * `docs.itemFields.frontmatter` is deep-merged over it, so it may add keys or
 * override any of the derived ones, `shortcode` included.
 *
 * @param {object} options
 * @param {string} options.title - The page's H1, and `name.full`'s default.
 * @param {string} options.shortcode - The derived shortcode, from
 *   {@link shortcodeFromBasename}.
 * @param {Record<string, unknown>} [options.frontmatter] - The consumer's
 *   declared `docs.itemFields.frontmatter`.
 * @returns {Record<string, unknown>} The envelope, ready for `matter.stringify`.
 */
export function itemFieldsEnvelope({ title, shortcode, frontmatter }) {
    return deepMerge(
        {
            type: "doc",
            subType: "reference",
            shortcode,
            name: { full: title },
            pack: "none",
        },
        frontmatter,
    );
}

/**
 * Wrap the rendered item-fields page in the note envelope, when its
 * destination is under the content tree.
 *
 * `--check` compares the **whole** file this returns, envelope included — a
 * page committed with its old envelope by hand, or with none at all, is
 * exactly the staleness the guard exists to catch.
 *
 * @param {string} body - The page {@link renderItemFieldReference} rendered.
 * @param {object} options
 * @param {string} options.title - The page's H1, threaded through to
 *   `name.full`.
 * @param {string} options.destination - Absolute path the page is written to.
 * @param {string} options.contentRoot - Absolute path of the content tree
 *   root (`config.paths.content`).
 * @param {Record<string, unknown>} [options.frontmatter] - The consumer's
 *   declared `docs.itemFields.frontmatter`.
 * @returns {string} `body`, unchanged when `destination` is outside the
 *   content tree; otherwise `body` with the note envelope stringified above it.
 */
export function renderItemFieldsPage(body, { title, destination, contentRoot, frontmatter }) {
    if (!isUnderContentTree(destination, contentRoot)) return body;
    const envelope = itemFieldsEnvelope({
        title,
        shortcode: shortcodeFromBasename(destination),
        frontmatter,
    });
    const page = matter.stringify(body, envelope);
    // `matter.stringify` closes the frontmatter fence directly onto the
    // body's first line; Prettier's markdown printer requires a blank line
    // between them, so a page written without one fails a consumer's
    // `lint:format` the moment it is committed. Insert it here rather than
    // let the generator and the formatter rewrite the file back and forth.
    return page.replace(/^(---\n[\s\S]*?\n---\n)/, "$1\n");
}
