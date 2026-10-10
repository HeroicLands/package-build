/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, subTypes } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * Where `data.culture` may be written, derived from the vocabulary at run time.
 *
 * The types are named; their subtypes are read from the vocabulary, so a
 * subtype added to any of them is covered by every assertion here without an
 * edit. The rules the assertions hold the vocabulary to:
 *
 * - `place`, `affiliation`, `being` and every `lore` subtype but `culture`
 *   take an optional culture, which must name a `lore` note of `subType: culture`;
 * - a `lore` note of `subType: culture` is the culture, and refuses the field;
 * - a `doc` of `subType: settingguide` requires it; every other `doc` subtype
 *   refuses it.
 */
const CULTURE_TYPES = ["place", "affiliation", "lore", "being", "doc"] as const;
const REQUIRED_ON = { doc: "settingguide" } as const;
const REFUSED_ON = { lore: ["culture"] } as Record<string, string[]>;

const file = "assets/content/Notes/Example.md";
const CULTURE = "lore-vedyariclt";
const NOT_A_CULTURE = "lore-vedyarilaw";

/** What each Address in these cases resolves to. */
const TARGETS: Record<string, { type: string; subType: string }> = {
    [CULTURE]: { type: "lore", subType: "culture" },
    [NOT_A_CULTURE]: { type: "lore", subType: "law" },
};

type Note = {
    file: string;
    raw: string;
    type: string;
    fm: { type: string; subType?: string; data?: Record<string, unknown> };
};

/** A note written exactly as its `raw` says, with `data.culture` only when given. */
function note(type: string, subType: string | undefined, culture?: string): Note {
    const lines = ["---", `type: ${type}`];
    if (subType) lines.push(`subType: ${subType}`);
    if (culture !== undefined) lines.push("data:", `    culture: ${culture}`);
    lines.push("---", "");
    const fm: Note["fm"] = { type };
    if (subType) fm.subType = subType;
    if (culture !== undefined) fm.data = { culture };
    return { file, raw: lines.join("\n"), type, fm };
}

/** The 1-based line and column of the culture key, and of its value. */
function cultureAt(raw: string) {
    const lines = raw.split("\n");
    const index = lines.findIndex((line) => /^\s+culture:/.test(line));
    const keyColumn = lines[index].search(/\S/) + 1;
    return {
        line: index + 1,
        keyColumn,
        valueColumn: keyColumn + "culture: ".length,
    };
}

function subTypeLine(raw: string) {
    return raw.split("\n").findIndex((line) => line.startsWith("subType:")) + 1;
}

function lint(subject: Note, vocabulary: object) {
    const index = {
        notes: [subject],
        contentPackage: "thalorna",
        types: new Set(Object.keys(vocabulary)),
        packages: new Set(["thalorna"]),
        addressHit: (address: string) => {
            const target = TARGETS[address.replace(/^thalorna-note-/, "")];
            return target && { fm: target };
        },
    };
    return lintFrontmatter(index as any, { schemas: NOTE_SCHEMAS, vocabulary: vocabulary as any })
        .findings as Array<{
        file?: string;
        line?: number;
        column?: number;
        severity: string;
        message: string;
    }>;
}

/** Every subtype of a type, or a single unnamed one where it declares none. */
function subTypesOf(type: string, vocabulary: object): Array<string | undefined> {
    const declared = subTypes(type, vocabulary as any);
    return declared && declared.length > 0 ? [...declared] : [undefined];
}

/**
 * Each rule the vocabulary breaks, as a sentence naming the case. An empty list
 * is a vocabulary that holds every rule.
 */
function violations(vocabulary: object): string[] {
    const broken: string[] = [];
    const json = (value: unknown) => JSON.stringify(value);

    for (const type of CULTURE_TYPES) {
        for (const subType of subTypesOf(type, vocabulary)) {
            const label = `${type}${subType ? ` subType ${subType}` : ""}`;
            const required = REQUIRED_ON[type as keyof typeof REQUIRED_ON] === subType;
            const refused =
                (REFUSED_ON[type] ?? []).includes(subType ?? "") || (type === "doc" && !required);

            const bare = lint(note(type, subType), vocabulary);
            const valid = note(type, subType, CULTURE);
            const wrong = note(type, subType, NOT_A_CULTURE);
            const at = cultureAt(valid.raw);

            if (required) {
                const missing = bare.filter((finding) => /culture/.test(finding.message));
                const formatted = missing.map((finding) => formatDiagnostic(finding));
                const expected = `${file}:${subTypeLine(valid.raw)}:1: error: `;
                if (missing.length !== 1 || !formatted[0].startsWith(expected))
                    broken.push(
                        `${label}: without data.culture should give one finding starting ` +
                            `${json(expected)}, gave ${json(formatted)}`,
                    );
                const withCulture = lint(valid, vocabulary);
                if (withCulture.length !== 0)
                    broken.push(
                        `${label}: with a culture should lint clean, gave ${json(withCulture)}`,
                    );
            } else if (refused) {
                const findings = lint(valid, vocabulary);
                const atKey = findings.filter(
                    (finding) =>
                        finding.severity === "error" &&
                        finding.line === at.line &&
                        finding.column === at.keyColumn &&
                        formatDiagnostic(finding).startsWith(
                            `${file}:${at.line}:${at.keyColumn}: error: `,
                        ),
                );
                if (atKey.length !== 1)
                    broken.push(
                        `${label}: data.culture should be refused at ${at.line}:${at.keyColumn}, ` +
                            `gave ${json(findings)}`,
                    );
                if (
                    type === "lore" &&
                    !atKey.some((finding) => /is itself the culture/.test(finding.message))
                )
                    broken.push(
                        `${label}: the refusal should say the note is itself the culture, ` +
                            `gave ${json(atKey.map((finding) => finding.message))}`,
                    );
            } else {
                // Compared by message: a finding another check places at the
                // `data:` line moves when the fixture gains one.
                const said = (findings: Array<{ message: string }>) =>
                    json(findings.map((finding) => finding.message));
                const withCulture = lint(valid, vocabulary);
                if (said(withCulture) !== said(bare))
                    broken.push(
                        `${label}: a valid culture should add no finding; without it ` +
                            `${said(bare)}, with it ${said(withCulture)}`,
                    );
            }

            if (!refused) {
                const findings = lint(wrong, vocabulary);
                const atValue = findings.filter(
                    (finding) =>
                        finding.severity === "error" &&
                        finding.line === at.line &&
                        finding.column === at.valueColumn &&
                        /subType is not culture/.test(finding.message),
                );
                if (atValue.length !== 1)
                    broken.push(
                        `${label}: a culture naming non-culture lore should be an error at ` +
                            `${at.line}:${at.valueColumn}, gave ${json(findings)}`,
                    );
            }
        }
    }
    return broken;
}

/** The vocabulary with `data.culture` taken off one type. */
function without(type: string) {
    const entry = (NOTE_VOCABULARY as Record<string, any>)[type];
    return {
        ...NOTE_VOCABULARY,
        [type]: {
            ...entry,
            data: entry.data.filter((field: { name: string }) => field.name !== "culture"),
        },
    };
}

describe("data.culture across the vocabulary", () => {
    it("is declared on every type that takes it, as one lore Address", () => {
        for (const type of CULTURE_TYPES) {
            const field = (NOTE_VOCABULARY as Record<string, any>)[type].data.find(
                (entry: { name: string }) => entry.name === "culture",
            );
            expect(field, type).toMatchObject({ kind: "address", ref: "lore", accepts: ["lore"] });
            expect(field.required, type).toBeFalsy();
        }
    });

    it("is optional, required or refused on each subtype as the rules say", () => {
        expect(violations(NOTE_VOCABULARY)).toEqual([]);
    });

    it.each(CULTURE_TYPES)("breaks when %s stops declaring it", (type) => {
        expect(violations(without(type))).not.toEqual([]);
    });
});
