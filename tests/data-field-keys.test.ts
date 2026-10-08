/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseContentFormat } from "../engine/content-format.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, SHARED_DATA_FIELDS } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { AFFILIATION_STANDINGS } from "../sohl/affiliation-standings.mjs";

/** Value shapes that hold no map, so they have no inner keys to declare. */
const SCALAR_KINDS = new Set([
    "string",
    "date",
    "number",
    "integer",
    "boolean",
    "address",
    "shortcode",
]);

/**
 * Fields whose inner keys this vocabulary does not state, each with the reason.
 *
 * Keyed `<type>.<field>`. Nothing else is exempt, and adding a field here is a
 * decision to be made in review rather than a way to make this guard pass.
 */
const EXEMPT: Record<string, string> = {
    // An exported Foundry Scene: Foundry owns its schema and the build preserves
    // its fields, so its keys stay open, as a system block's do.
    "map.scene": "Foundry's Scene schema",
};

type Spec = {
    name?: string;
    kind?: string;
    keyKind?: string;
    entryKind?: string;
    fields?: readonly Spec[];
    entries?: Spec;
    values?: Spec;
};

/**
 * Why a declaration fails to state what its value holds, or `undefined` when
 * it states all of it.
 *
 * A value holding maps — a map, a list of maps, or a map whose values are maps —
 * states their keys, at every depth. A container of scalars states what each
 * entry is. A declaration with no kind makes no claim at all, and is refused.
 */
function unstated(spec: Spec, path: string): string | undefined {
    const children = (): string | undefined => {
        for (const inner of spec.fields ?? []) {
            const why = unstated(inner, `${path}.${inner.name}`);
            if (why) return why;
        }
        if (spec.entries) return unstated(spec.entries, `${path}[]`);
        if (spec.values) return unstated(spec.values, `${path}.<key>`);
        return undefined;
    };
    if (SCALAR_KINDS.has(spec.kind ?? "")) return undefined;
    switch (spec.kind) {
        case "string-or-list":
        case "list":
            if (!spec.entryKind && !spec.entries) return `${path}: a list declaring no entries`;
            return children();
        case "map":
            if (!spec.fields && !spec.values) return `${path}: a map declaring no keys or values`;
            return children();
        case "scalar-or-map":
            if (!spec.entryKind && !spec.fields && !spec.values)
                return `${path}: a map form declaring no keys or values`;
            return children();
        case "list-or-map":
            if (!spec.entryKind && !spec.entries)
                return `${path}: a list form declaring no entries`;
            if (!spec.values) return `${path}: a map form declaring no values`;
            return children();
        default:
            return `${path}: no kind, so nothing says what it holds`;
    }
}

/** Every declared `data:` field, as `[<type>.<field>, declaration]`. */
function everyField(): Array<[string, Spec]> {
    const out: Array<[string, Spec]> = [];
    for (const field of SHARED_DATA_FIELDS) out.push([`*.${field.name}`, field]);
    for (const [type, entry] of Object.entries(NOTE_VOCABULARY))
        for (const field of entry.data) out.push([`${type}.${field.name}`, field]);
    return out;
}

describe("every data field states its inner keys", () => {
    it("declares what every container field holds, at every depth", () => {
        const missing = everyField()
            .filter(([key]) => !Object.hasOwn(EXEMPT, key))
            .map(([key, spec]) => unstated(spec, key))
            .filter(Boolean);
        expect(missing).toEqual([]);
    });

    it("exempts only fields that still exist", () => {
        const declared = new Set(everyField().map(([key]) => key));
        expect(Object.keys(EXEMPT).filter((key) => !declared.has(key))).toEqual([]);
    });

    it("declares no social block on a being", () => {
        expect(NOTE_VOCABULARY.being.data.map((field: Spec) => field.name)).not.toContain("social");
    });
});

/** Lint one note written out as raw frontmatter. */
function lint(type: string, raw: string, fm: Record<string, unknown>) {
    return lintNote({ file: "assets/content/Note.md", type, raw, fm: { type, ...fm } } as any, {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    });
}

/** A YAML fence from its lines, as a note's raw text. */
const fence = (...lines: string[]) => ["---", ...lines, "---", ""].join("\n");

describe("a declared whole number or closed word is checked at the value", () => {
    const calendar = (key: string, entry: Record<string, unknown>, line: string) => ({
        raw: fence("type: lore", "subType: calendar", "data:", `    ${key}:`, line),
        fm: { subType: "calendar", data: { [key]: [entry] } },
    });

    for (const [key, entry, line, field, column] of [
        [
            "months",
            { name: "Ilvin", days: 30.5 },
            "        - { name: Ilvin, days: 30.5 }",
            "days",
            32,
        ],
        [
            "seasons",
            { name: "Spring", start: 1.5 },
            "        - { name: Spring, start: 1.5 }",
            "start",
            34,
        ],
        [
            "namedDays",
            { name: "Feast", day: 2.5 },
            "        - { name: Feast, day: 2.5 }",
            "day",
            31,
        ],
        [
            "eras",
            { shortcode: "ar", name: "AR", start: 1.5 },
            "        - { shortcode: ar, name: AR, start: 1.5 }",
            "start",
            45,
        ],
    ] as const) {
        it(`refuses a fractional ${key}[].${field} once, at the value`, () => {
            const { raw, fm } = calendar(key, entry, line);
            const about = lint("lore", raw, fm).filter(
                (f: any) =>
                    f.message.includes(`data.${key}`) ||
                    /season|named day|era start/.test(f.message),
            );
            expect(about).toEqual([
                expect.objectContaining({
                    line: 6,
                    column,
                    severity: "error",
                    message: expect.stringMatching(
                        new RegExp(
                            `^\`data\\.${key}\\[0\\]\\.${field}\` should be .*whole number.*but reads`,
                        ),
                    ),
                }),
            ]);
        });
    }

    it("refuses an affiliation's relation outside the standings, at the value", () => {
        const raw = fence(
            "type: affiliation",
            "data:",
            "    relations: { test-note-affiliation-foes: nemsis }",
        );
        const findings = lint("affiliation", raw, {
            data: { relations: { "test-note-affiliation-foes": "nemsis" } },
        });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 4,
                column: 46,
                severity: "error",
                message:
                    "`data.relations.test-note-affiliation-foes` should be `aligned` or `unaligned` or " +
                    '`rival` or `nemesis`, but reads "nemsis". Did you mean "nemesis"?',
            }),
        );
    });

    it("accepts every standing as a relation", () => {
        for (const standing of AFFILIATION_STANDINGS) {
            const raw = fence(
                "type: affiliation",
                "data:",
                `    relations: { test-note-affiliation-foes: ${standing} }`,
            );
            const findings = lint("affiliation", raw, {
                data: { relations: { "test-note-affiliation-foes": standing } },
            });
            expect(
                findings.filter((f: any) => f.message.includes("relations")),
                standing,
            ).toEqual([]);
        }
    });

    it("refuses a fixup type other than address, at the value", () => {
        const raw = fence(
            "type: map",
            "subType: battlemap",
            "data:",
            "    fixup:",
            "        - { path: '.notes[0].texture.src', type: path, value: icon-book }",
        );
        const findings = lint("map", raw, {
            subType: "battlemap",
            data: { fixup: [{ path: ".notes[0].texture.src", type: "path", value: "icon-book" }] },
        });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 6,
                column: 50,
                message: '`data.fixup[0].type` should be `address`, but reads "path"',
            }),
        );
    });
});

describe("an undeclared inner key is a finding at its own position", () => {
    it("refuses a key one level in", () => {
        const raw = [
            "---",
            "type: being",
            "data:",
            "    harnworld:",
            "        realm: Kaldor",
            "        relm: Kaldor",
            "---",
            "",
        ].join("\n");
        const findings = lint("being", raw, {
            data: { harnworld: { realm: "Kaldor", relm: "Kaldor" } },
        });
        expect(findings).toContainEqual(
            expect.objectContaining({
                file: "assets/content/Note.md",
                line: 6,
                column: 9,
                severity: "error",
                message: expect.stringMatching(/"relm" is not a key of `data\.harnworld`.*realm/),
            }),
        );
    });

    it("refuses a key two levels in, inside a list entry of a keyed map", () => {
        const raw = [
            "---",
            "type: affiliation",
            "data:",
            "    governance:",
            "        offices:",
            "            Chancellor:",
            "                description: Keeps the seal.",
            "                holders:",
            "                    - being: being-aran",
            "                      stat: 720.1",
            "---",
            "",
        ].join("\n");
        const findings = lint("affiliation", raw, {
            data: {
                governance: {
                    offices: {
                        Chancellor: {
                            description: "Keeps the seal.",
                            holders: [{ being: "being-aran", stat: "720.1" }],
                        },
                    },
                },
            },
        });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 10,
                column: 23,
                severity: "error",
                message: expect.stringMatching(
                    /"stat" is not a key of `data\.governance\.offices\.Chancellor\.holders\[0\]`.*Did you mean "start"/,
                ),
            }),
        );
    });

    it("closes a dotted declaration's container", () => {
        const raw = [
            "---",
            "type: being",
            "data:",
            "    appearance:",
            "        eye_colour: grey",
            "---",
            "",
        ].join("\n");
        const findings = lint("being", raw, { data: { appearance: { eye_colour: "grey" } } });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 5,
                column: 9,
                message: expect.stringMatching(
                    /"eye_colour" is not a key of `data\.appearance`.*Did you mean "eye_color"/,
                ),
            }),
        );
    });

    it("states a required inner key's absence on the entry, and a wrong kind on the value", () => {
        const raw = [
            "---",
            "type: place",
            "data:",
            "    routes:",
            "        - to: south",
            "          bearing: S",
            "          mode: land",
            "          terrain: forest",
            "---",
            "",
        ].join("\n");
        const findings = lint("place", raw, {
            data: { routes: [{ to: "south", bearing: "S", mode: "land", terrain: "forest" }] },
        });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 5,
                message: expect.stringMatching(/`data\.routes\[0\]` must state `days`/),
            }),
        );
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 8,
                column: 20,
                message: expect.stringMatching(/`data\.routes\[0\]\.terrain` should be/),
            }),
        );
    });

    it("refuses map geometry under data, where the compiler reads none", () => {
        const raw = [
            "---",
            "type: map",
            "subType: regionalmap",
            "data:",
            "    walls: {}",
            "---",
            "",
        ].join("\n");
        const findings = lint("map", raw, { subType: "regionalmap", data: { walls: {} } });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 5,
                column: 5,
                severity: "error",
                message: expect.stringContaining(
                    '"walls" is not a `data:` property declared by map',
                ),
            }),
        );
    });

    it("refuses a being's social block as an undeclared key", () => {
        const raw = [
            "---",
            "type: being",
            "data:",
            "    social:",
            "        class: noble",
            "---",
            "",
        ].join("\n");
        const findings = lint("being", raw, { data: { social: { class: "noble" } } });
        expect(findings).toContainEqual(
            expect.objectContaining({
                line: 4,
                column: 5,
                message: expect.stringContaining(
                    '"social" is not a `data:` property declared by being',
                ),
            }),
        );
    });
});

/**
 * What the format reference writes in the row of a field whose inner keys this
 * vocabulary does not declare — one of {@link EXEMPT} — before saying what the
 * keys are instead and what is checked. A reader finds every such field by
 * searching for it, and the guard below finds them the same way.
 */
const OPEN_MARKER = "**Keys not declared here:**";

/** The heading of the one place the reference says what checks the system blocks. */
const SYSTEM_BLOCK_HEADING = "#### What checks a system block";

const REFERENCE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../docs/reference/format-details.md",
);

/**
 * The placeholder a reference row writes for a keyed map's key: `<Address>`,
 * `<Shortcode>`, or `<name>` for a key that is a name the note chooses.
 */
function placeholder(spec: Spec): string {
    if (spec.keyKind === "address") return "<Address>";
    if (spec.keyKind === "shortcode") return "<Shortcode>";
    return "<name>";
}

/**
 * Every inner key a declaration states, at every depth, as the path a
 * reference row writes it under `data:` — `routes[].terrain`,
 * `affiliations.<Address>.rank`, `governance.offices.<name>.holders[].being`.
 */
function innerKeyPaths(spec: Spec, at: string): string[] {
    return innerKeys(spec, at).map(([path]) => path);
}

/** As {@link innerKeyPaths}, each with the declaration it names. */
function innerKeys(spec: Spec, at: string): Array<[string, Spec]> {
    const out: Array<[string, Spec]> = [];
    for (const inner of spec.fields ?? []) {
        out.push([`${at}.${inner.name}`, inner], ...innerKeys(inner, `${at}.${inner.name}`));
    }
    if (spec.entries) out.push(...innerKeys(spec.entries, `${at}[]`));
    if (spec.values) out.push(...innerKeys(spec.values, `${at}.${placeholder(spec)}`));
    return out;
}

/**
 * Every path a reference row may document, with its declaration, by table:
 * `*` for the shared table, a type name for its own, and `events` for the
 * Events section's tables, whose paths start from one entry. A keyed map's
 * value is a path too — `governance.offices.<name>` — because a row may say
 * what one value is.
 */
function documentable(): Map<string, Map<string, Spec>> {
    const tables = new Map<string, Map<string, Spec>>();
    const table = (name: string) => tables.get(name) ?? tables.set(name, new Map()).get(name)!;
    const valuePaths = (spec: Spec, at: string): Array<[string, Spec]> => {
        const out: Array<[string, Spec]> = [];
        if (spec.values) out.push([`${at}.${placeholder(spec)}`, spec.values]);
        for (const inner of spec.fields ?? [])
            out.push(...valuePaths(inner, `${at}.${inner.name}`));
        if (spec.entries) out.push(...valuePaths(spec.entries, `${at}[]`));
        if (spec.values) out.push(...valuePaths(spec.values, `${at}.${placeholder(spec)}`));
        return out;
    };
    for (const [key, spec] of everyField()) {
        const type = key.slice(0, key.indexOf("."));
        const name = key.slice(key.indexOf(".") + 1);
        table(type).set(name, spec);
        for (const [path, inner] of [...innerKeys(spec, name), ...valuePaths(spec, name)]) {
            if (path.startsWith("events[]."))
                table("events").set(path.slice("events[].".length), inner);
            else table(type).set(path, inner);
        }
    }
    return tables;
}

describe("the format reference documents every data field", () => {
    const text = fs.readFileSync(REFERENCE, "utf8");
    const reference = parseContentFormat(text, { file: REFERENCE });
    const rowsOf = (key: string) => {
        const [type] = key.split(".");
        return type === "*" ? reference.sharedDataRows : reference.types.get(type)?.dataRows;
    };

    it("tabulates every field and every inner key, each with its shape", () => {
        const missing: string[] = [];
        for (const [key, spec] of everyField()) {
            const rows = rowsOf(key);
            const name = key.slice(key.indexOf(".") + 1);
            for (const documented of [name, ...innerKeyPaths(spec, name)]) {
                // An event's keys are documented once, in the Events section's
                // tables, by their path from one entry.
                const row =
                    documented.startsWith("events[].") ?
                        reference.eventRows?.get(documented.slice("events[].".length))
                    :   rows?.get(documented);
                if (!row) missing.push(`${key.split(".")[0]}: \`${documented}\` has no row`);
                else if (!row.shape.trim())
                    missing.push(`${key.split(".")[0]}: \`${documented}\` states no shape`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("says so wherever a field's keys are not declared here, and nowhere else", () => {
        const wrong: string[] = [];
        for (const [key] of everyField()) {
            const name = key.slice(key.indexOf(".") + 1);
            const marked = rowsOf(key)?.get(name)?.text.includes(OPEN_MARKER) ?? false;
            const exempt = Object.hasOwn(EXEMPT, key);
            if (exempt && !marked) wrong.push(`${key}: exempt, and its row does not say so`);
            if (!exempt && marked) wrong.push(`${key}: marked open, and its keys are declared`);
        }
        expect(wrong).toEqual([]);
    });

    it("documents no field or inner key the vocabulary does not declare", () => {
        const declared = documentable();
        const stray: string[] = [];
        const check = (table: string, rows: Map<string, { line: number }> | undefined) => {
            for (const [path, row] of rows ?? [])
                if (!declared.get(table)?.has(path))
                    stray.push(`${table}: \`${path}\` at line ${row.line} is not declared`);
        };
        check("*", reference.sharedDataRows);
        check("events", reference.eventRows);
        for (const [type, spec] of reference.types) check(type, spec.dataRows);
        expect(stray).toEqual([]);
    });

    it("documents a key as an integer exactly where it is declared as one", () => {
        const declared = documentable();
        const wrong: string[] = [];
        const check = (table: string, rows: Map<string, { shape: string }> | undefined) => {
            for (const [path, row] of rows ?? []) {
                const spec = declared.get(table)?.get(path);
                if (!spec) continue;
                const documented = row.shape.includes("`integer`");
                const integer = spec.kind === "integer";
                if (documented && !integer)
                    wrong.push(
                        `${table}: \`${path}\` is documented as an integer, declared ${spec.kind}`,
                    );
                if (integer && !documented && !/whole number/.test(row.shape))
                    wrong.push(
                        `${table}: \`${path}\` is declared an integer, documented ${row.shape}`,
                    );
            }
        };
        check("*", reference.sharedDataRows);
        check("events", reference.eventRows);
        for (const [type, spec] of reference.types) check(type, spec.dataRows);
        expect(wrong).toEqual([]);
    });

    it("says in one place what checks a system block", () => {
        expect(text.split("\n").filter((line) => line === SYSTEM_BLOCK_HEADING)).toHaveLength(1);
    });
});
