/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, SHARED_DATA_FIELDS } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/** Value shapes that hold no map, so they have no inner keys to declare. */
const SCALAR_KINDS = new Set(["string", "date", "number", "boolean", "address", "shortcode"]);

/**
 * Fields whose inner keys this vocabulary does not state, each with the reason.
 *
 * Keyed `<type>.<field>`. Nothing else is exempt, and adding a field here is a
 * decision to be made in review rather than a way to make this guard pass.
 */
const EXEMPT: Record<string, string> = {
    // An occurrence's keys are closed by the event schema's own check, which
    // brings `events` under the field-declaration mechanism when it lands.
    "lore.events": "closed by the event schema",
    // An exported Foundry Scene: Foundry owns its schema and the build preserves
    // its fields, so its keys stay open, as a system block's do.
    "map.scene": "Foundry's Scene schema",
    // Regional-map geometry, whose conventions are the SoHL map authoring
    // guide's; declaring their keys is tracked as its own piece of work.
    "map.walls": "map-note geometry",
    "map.doors": "map-note geometry",
    "map.lights": "map-note geometry",
    "map.tiles": "map-note geometry",
    "map.sounds": "map-note geometry",
    "map.regions": "map-note geometry",
    "map.notes": "map-note geometry",
};

type Spec = {
    name?: string;
    kind?: string;
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
