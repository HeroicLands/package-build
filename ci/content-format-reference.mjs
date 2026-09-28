/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatGenerated } from "../engine/format-generated.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { NOTE_VOCABULARY, SHARED_DATA_FIELDS } from "../engine/note-vocabulary.mjs";

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
    process.stdout.write(result);
}
