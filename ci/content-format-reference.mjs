/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatGenerated } from "../engine/format-generated.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import {
    BEING_ARCHETYPES,
    NOTE_TOP_LEVEL_FIELDS,
    NOTE_VOCABULARY,
    SHARED_DATA_FIELDS,
} from "../engine/note-vocabulary.mjs";
import { EXPRESSION_HELPERS } from "../engine/markdown-expressions.mjs";
import { PAGE_LIST_ATTRIBUTES } from "../engine/page-lists.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "docs/reference/note-types.md");
const contract = loadContentFormat();
const cell = (value) =>
    String(value ?? "")
        .replaceAll("|", "\\|")
        .replaceAll("\n", " ");
const fields = (list) =>
    list.map(
        (field) =>
            `| \`data.${cell(field.name)}\` | ${cell(field.shape ?? field.kind ?? "value")} | ${cell(field.describe)} |`,
    );
const rows = [
    "---",
    "shortcode: referencenotetypes",
    'name: { full: "Note types and fields" }',
    "type: doc",
    "subType: reference",
    "---",
    "",
    "# Note types and fields",
    "",
    "Choose a note's `type` for the subject it describes. Use `subType` when its type declares a more specific genre. Field rules are declared in `engine/note-vocabulary.mjs`; mapping claims and closed vocabularies are recorded in `engine/content-format.yaml`. This page is checked against both declarations.",
    "",
    "The [first-note guide](../authoring/first-note.md) teaches the shape of a note. [Frontmatter](../authoring/frontmatter.md) explains shared and system-specific values. The [detailed reference](format-details.md) gives the full behavior and examples.",
    "",
    "## Top-level keys",
    "",
    "These are the only keys a note writes at its top level, in the order the formatter puts them. A key absent from this table is a lint error at its own line: the region is closed, so the key reaches no document and no page. Facts about the subject belong under `data`, and values for one game system belong inside that system's block.",
    "",
    "| Key | Meaning |",
    "| --- | --- |",
    ...NOTE_TOP_LEVEL_FIELDS.map(
        (field) => `| \`${cell(field.name)}\` | ${cell(field.describe)} |`,
    ),
    "",
    "## Shared `data` fields",
    "",
    "These fields are accepted by every note type. A field's value can still be irrelevant to a particular output; the build reports that where it can.",
    "",
    "| Field | Shape | Meaning |",
    "| --- | --- | --- |",
    ...fields(SHARED_DATA_FIELDS),
    "",
    "## Type-specific fields",
    "",
];
for (const [type, spec] of contract.types) {
    const declared = NOTE_VOCABULARY[type];
    if (!declared) throw new Error(`No vocabulary for ${type}`);
    rows.push(`### ${type}`, "");
    rows.push(
        `**Subtypes:** ${
            declared.subTypes === null ? "Open vocabulary"
            : spec.subTypes.length ? spec.subTypes.map((value) => `\`${value}\``).join(", ")
            : "None"
        }.`,
        "",
    );
    if (type === "lore") {
        rows.push(
            "Lore records in-world knowledge. A `culture` describes a people; a `custom` describes how they practice a rite, observance, or usage. A `material` describes a physical constituent and its qualities, which may vary by region. See the [lore subtype definitions](format-details.md#type-lore) for the complete vocabulary.",
            "",
        );
    }
    rows.push("| Field | Shape | Meaning |", "| --- | --- | --- |");
    rows.push(
        ...(declared.data?.length ?
            fields(declared.data)
        :   ["| — | — | No type-specific `data` fields. |"]),
    );
    rows.push("");
    const claims = contract.claims.filter((claim) => !claim.shared && claim.noteType === type);
    if (claims.length) {
        rows.push("**System mappings**", "", "| Source | System | Target |", "| --- | --- | --- |");
        rows.push(
            ...claims.map(
                (claim) =>
                    `| \`${cell(claim.source)}\` | ${cell(claim.system)} | \`${cell(claim.target)}\` |`,
            ),
        );
        rows.push("");
    }
}
rows.push("## Shared system mappings", "", "| Source | System | Target |", "| --- | --- | --- |");
rows.push(
    ...contract.claims
        .filter((claim) => claim.shared)
        .map(
            (claim) =>
                `| \`${cell(claim.source)}\` | ${cell(claim.system)} | \`${cell(claim.target)}\` |`,
        ),
);
rows.push("");
const result = await formatGenerated(`${rows.join("\n")}\n`, output);
if (process.argv.includes("--check")) {
    if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== result) {
        console.error(
            `${path.relative(root, output)}: error: run node ci/content-format-reference.mjs to refresh the note-type reference`,
        );
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(output, result);
}

// The two tables `docs/authoring/links-and-markup.md` generates: every helper
// an expression may call, and every attribute a page-list fence takes. Both are
// written from the one list the engine reads, so neither document can fall
// behind a new entry. Replaced in one pass and written once, so a `--check` run
// names the file rather than one of the tables in it.
const markupPath = path.join(root, "docs/authoring/links-and-markup.md");
const markup = fs.readFileSync(markupPath, "utf8");
const GENERATED_TABLES = [
    {
        marker: "expression-helpers",
        rows: [
            "| Helper | Parameters | What it gives you |",
            "| ------ | ---------- | ----------------- |",
            ...Object.entries(EXPRESSION_HELPERS).map(
                ([name, { params, summary }]) =>
                    `| \`${cell(name)}\` | \`${cell(params)}\` | ${cell(summary)} |`,
            ),
        ],
    },
    {
        marker: "page-list-attributes",
        rows: [
            "| Attribute | Value | Default | What it does |",
            "| --------- | ----- | ------- | ------------ |",
            ...Object.entries(PAGE_LIST_ATTRIBUTES).map(
                ([name, { value, default: fallback, summary }]) =>
                    `| \`${name}\` | ${cell(value)} | ${cell(fallback)} | ${cell(summary)} |`,
            ),
        ],
    },
];
let markupBody = markup;
for (const { marker, rows } of GENERATED_TABLES) {
    const region = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`);
    if (!region.test(markupBody)) {
        throw new Error(`The ${marker} reference requires its generation markers`);
    }
    markupBody = markupBody.replace(
        region,
        `<!-- ${marker}:start -->\n\n${rows.join("\n")}\n\n<!-- ${marker}:end -->`,
    );
}
const updatedMarkup = await formatGenerated(markupBody, markupPath);
if (process.argv.includes("--check")) {
    if (markup !== updatedMarkup) {
        console.error(
            "docs/authoring/links-and-markup.md: error: run node ci/content-format-reference.mjs to refresh its generated tables",
        );
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(markupPath, updatedMarkup);
}

const detailsPath = path.join(root, "docs/reference/format-details.md");
const details = fs.readFileSync(detailsPath, "utf8");
if (!/<!-- archetypes:start -->[\s\S]*?<!-- archetypes:end -->/.test(details)) {
    throw new Error("The archetype reference requires its generation markers");
}
const archetypes = Object.entries(BEING_ARCHETYPES)
    .map(([name, meaning]) => `- ${name}: ${meaning}`)
    .join("\n");
const updatedDetails = await formatGenerated(
    details.replace(
        /<!-- archetypes:start -->[\s\S]*?<!-- archetypes:end -->/,
        `<!-- archetypes:start -->\n${archetypes}\n<!-- archetypes:end -->`,
    ),
    detailsPath,
);
if (process.argv.includes("--check")) {
    if (details !== updatedDetails) {
        console.error(
            "docs/reference/format-details.md: error: run node ci/content-format-reference.mjs to refresh the archetype reference",
        );
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(detailsPath, updatedDetails);
}
