/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSchemaArtifact, pathAliases } from "../engine/schema-extract.mjs";
import { SCHEMA_ARTIFACT_VERSION } from "../engine/schema-check.mjs";

/**
 * The extractor reads real files, so these fixtures are real files.
 *
 * They are deliberately written in the two house styles actually in play
 * rather than one normalised shape: `sohl` spreads a delegating builder in
 * TypeScript, `hm3` calls `Object.assign(super.defineSchema(), …)` in
 * JavaScript. The whole reason this module lives in package-build is that both
 * spellings mean the same thing, and a reader that understood only the first
 * would report the second as declaring nothing at all — the failure mode being
 * an empty schema that passes every check.
 */
let dir: string;

/** Write a file, creating the directories above it. */
function write(rel: string, body: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
}

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-extract-"));
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "fixture", version: "1.2.3" }),
        "utf8",
    );
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Extract with one Item registry, the common case for these fixtures. */
function extract(from: string, registry = "itemModels") {
    return buildSchemaArtifact({
        rootDir: dir,
        registries: [{ documentType: "Item", from, registry }],
        packageId: "fixture",
        version: "1.2.3",
    });
}

describe("buildSchemaArtifact — the hm3 shape", () => {
    beforeAll(() => {
        write(
            "hm3/models.js",
            `
const fields = foundry.data.fields;

export class BaseModel extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            notes: new fields.StringField({}),
            macros: new fields.SchemaField({
                type: new fields.StringField({}),
                command: new fields.StringField({})
            })
        };
    }
}

export class GearModel extends BaseModel {
    static defineSchema() {
        return Object.assign(super.defineSchema(), {
            weight: new fields.NumberField({}),
            protection: new fields.SchemaField({
                blunt: new fields.NumberField({})
            })
        });
    }
}

export class MiscGearModel extends GearModel {}

export class LooseModel extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {only: new fields.StringField({})};
    }
}

export const itemModels = {
    gear: GearModel,
    miscgear: MiscGearModel,
    loose: LooseModel
};
`,
        );
    });

    it("follows `Object.assign(super.defineSchema(), …)` inheritance", () => {
        const { documents } = extract("hm3/models.js");
        expect(documents.Item.gear.own).toEqual([
            "protection",
            "protection.blunt",
            "weight",
        ]);
        expect(documents.Item.gear.inherited).toEqual([
            "macros",
            "macros.command",
            "macros.type",
            "notes",
        ]);
    });

    it("treats a subclass with no defineSchema as wholly inherited", () => {
        // `class MiscGearModel extends GearModel {}` is a real and complete
        // declaration, not a gap in the data. Reading it as "declares nothing"
        // would make every field of a whole subtype look undeclared.
        const { documents } = extract("hm3/models.js");
        expect(documents.Item.miscgear.own).toEqual([]);
        expect(documents.Item.miscgear.inherited).toEqual([
            "macros",
            "macros.command",
            "macros.type",
            "notes",
            "protection",
            "protection.blunt",
            "weight",
        ]);
    });

    it("nests `fields.SchemaField` as dotted paths", () => {
        // Written as a property access here and bare in the sohl fixture
        // below. A builder may write the whole object or the leaves, so both
        // the parent and every leaf are recorded.
        const { documents } = extract("hm3/models.js");
        expect(documents.Item.gear.own).toContain("protection");
        expect(documents.Item.gear.own).toContain("protection.blunt");
    });

    it("stops at a base spelled as a property access", () => {
        // `extends foundry.abstract.TypeDataModel` is where the chain ends —
        // and it is also the shape this cannot follow, so the walk terminates
        // naturally rather than by a name check against a Foundry internal.
        const { documents } = extract("hm3/models.js");
        expect(documents.Item.loose).toEqual({
            own: ["only"],
            inherited: [],
        });
    });
});

describe("buildSchemaArtifact — the sohl shape", () => {
    beforeAll(() => {
        write(
            "sohl/tsconfig-target/base.ts",
            `
export class ItemBase {
    static override defineSchema() {
        return defineBaseSchema();
    }
}

function defineBaseSchema() {
    return {
        notes: new StringField({}),
        charges: new SchemaField({value: new NumberField({})})
    };
}
`,
        );
        write(
            "sohl/config.ts",
            `
import {ItemBase} from "@models/base";

export class WeaponData extends ItemBase {
    static override defineSchema() {
        return {
            ...ItemBase.defineSchema(),
            ...defineWeaponCommon(),
            damage: new NumberField({})
        };
    }
}

function defineWeaponCommon() {
    return {shared: new StringField({})};
}

export const ITEM_DM_DEF = {
    weapon: WeaponData
} satisfies ItemDMMap;
`,
        );
        fs.writeFileSync(
            path.join(dir, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: {
                    paths: { "@models/*": ["sohl/tsconfig-target/*"] },
                },
            }),
            "utf8",
        );
    });

    it("follows spreads, delegation and tsconfig path aliases", () => {
        const { documents } = extract("sohl/config.ts", "ITEM_DM_DEF");
        expect(documents.Item.weapon.own).toEqual(["damage"]);
        // `charges` and `charges.value` arrive through an aliased import and a
        // delegating `defineSchema()`; `shared` through a local spread, which
        // is the parent's contribution wherever it is written.
        expect(documents.Item.weapon.inherited).toEqual([
            "charges",
            "charges.value",
            "notes",
            "shared",
        ]);
    });

    it("reads through a `satisfies` wrapper on the registry", () => {
        const { documents } = extract("sohl/config.ts", "ITEM_DM_DEF");
        expect(Object.keys(documents.Item)).toEqual(["weapon"]);
    });
});

describe("buildSchemaArtifact — reporting", () => {
    it("stamps the artifact version this package reads", () => {
        // Imported from `schema-check.mjs` rather than restated. A producer
        // hardcoding the consumer's constant is exactly the drift that made
        // one shared extractor worth having.
        const artifact = extract("hm3/models.js");
        expect(artifact.version).toBe(SCHEMA_ARTIFACT_VERSION);
        expect(artifact.system).toBe("fixture");
        expect(artifact.systemVersion).toBe("1.2.3");
    });

    it("refuses a registry that maps nothing", () => {
        // An empty read would publish a schema that silently covers no
        // subtype, and every check against it would pass by vacuity.
        write("empty.js", `export const itemModels = {};`);
        expect(() => extract("empty.js")).toThrow(/silently covers nothing/);
    });

    it("refuses a registry file that does not exist", () => {
        expect(() => extract("nope.js")).toThrow(/does not exist/);
    });

    it("names a class it cannot locate", () => {
        write("missing.js", `export const itemModels = {a: Absent};`);
        expect(() => extract("missing.js")).toThrow(
            /Absent is registered in .* but its declaration cannot be found/s,
        );
    });

    it("names a class whose defineSchema it cannot follow", () => {
        write(
            "opaque.js",
            `
export class Opaque extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return buildItSomehow(loadedAtRuntime);
    }
}
export const itemModels = {a: Opaque};
`,
        );
        expect(() => extract("opaque.js")).toThrow(/cannot follow/);
    });

    it("subtracts inherited fields a subtype also declares itself", () => {
        // The two answer different questions — a builder must not emit what
        // nothing declares anywhere, but is not expected to fill inherited
        // machinery — so a field redeclared by the subtype belongs to `own`
        // alone and must not appear twice.
        write(
            "override.js",
            `
export class Base extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {shared: new StringField({}), only: new StringField({})};
    }
}
export class Child extends Base {
    static defineSchema() {
        return Object.assign(super.defineSchema(), {shared: new NumberField({})});
    }
}
export const itemModels = {child: Child};
`,
        );
        const { documents } = extract("override.js");
        expect(documents.Item.child.own).toEqual(["shared"]);
        expect(documents.Item.child.inherited).toEqual(["only"]);
    });
});

describe("buildSchemaArtifact — a schema builder in another file", () => {
    beforeAll(() => {
        write(
            "xfile/shared.ts",
            `
export function defineSharedSchema() {
    return {
        shortcode: new StringField({}),
        actionDefs: new ArrayField(new SchemaField({title: new StringField({})}))
    };
}
`,
        );
        write(
            "xfile/models.ts",
            `
import {defineSharedSchema} from "./shared";

export class ThingData {
    static defineSchema() {
        return {
            ...defineSharedSchema(),
            ...defineLocalCommon(),
            own: new StringField({})
        };
    }
}

function defineLocalCommon() {
    return {local: new StringField({})};
}

export const itemModels = {thing: ThingData};
`,
        );
    });

    it("follows a spread of an imported schema function", () => {
        // The regression this was written for: the shared base schema is
        // spread *by name* from the file that exports it, and resolving only
        // same-file functions dropped it entirely and in silence. Every SoHL
        // subtype lost `shortcode` and `actionDefs`, so content correctly
        // authoring `system.shortcode` was reported as undeclared — the check
        // accusing the content of the reader's own blind spot.
        const { documents } = extract("xfile/models.ts");
        expect(documents.Item.thing.own).toEqual(["own"]);
        expect(documents.Item.thing.inherited).toEqual([
            "actionDefs",
            "local",
            "shortcode",
        ]);
    });

    it("still prefers a same-file definition over an import", () => {
        // `defineLocalCommon` is declared in the importing file; the import
        // lookup must not shadow it.
        const { documents } = extract("xfile/models.ts");
        expect(documents.Item.thing.inherited).toContain("local");
    });
});

describe("buildSchemaArtifact — a field whose name is computed", () => {
    beforeAll(() => {
        write(
            "computed/models.ts",
            `
function phaseFields(name) {
    return {
        [\`\${name}Date\`]: new StringField({})
    };
}

export class PhasedData {
    static defineSchema() {
        return {
            ...phaseFields("onset"),
            plain: new StringField({})
        };
    }
}

export const itemModels = {phased: PhasedData};
`,
        );
    });

    it("refuses rather than publishing the source text as a field name", () => {
        // Handing back `[`${name}Date`]` would put a field in the schema that
        // no builder could ever emit: absent for checking while looking
        // present, and permanently reported as unemitted. The schema is a
        // contract other repositories read, so a contract this cannot state is
        // worth stopping for.
        expect(() => extract("computed/models.ts")).toThrow(
            /computed name.*does not evaluate/s,
        );
    });

    it("names the file and the key it could not resolve", () => {
        expect(() => extract("computed/models.ts")).toThrow(/models\.ts/);
        expect(() => extract("computed/models.ts")).toThrow(/\$\{name\}Date/);
    });
});

describe("pathAliases", () => {
    it("is empty when the repository has no tsconfig.json", () => {
        // A JavaScript repository has no aliases to resolve, which is not an
        // error. Treating a missing tsconfig as fatal would mean hm3 could
        // never publish a schema at all.
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), "no-tsconfig-"));
        try {
            expect(pathAliases(bare)).toEqual([]);
        } finally {
            fs.rmSync(bare, { recursive: true, force: true });
        }
    });

    it("orders aliases longest prefix first", () => {
        const aliased = fs.mkdtempSync(path.join(os.tmpdir(), "aliases-"));
        try {
            fs.writeFileSync(
                path.join(aliased, "tsconfig.json"),
                JSON.stringify({
                    compilerOptions: {
                        paths: {
                            "@models/*": ["models/*"],
                            "@models/core/*": ["core/*"],
                        },
                    },
                }),
                "utf8",
            );
            // Longest first, so `@models/core/x` does not resolve through
            // `@models/` and land in the wrong directory.
            expect(pathAliases(aliased).map(([p]) => p)).toEqual([
                "@models/core/",
                "@models/",
            ]);
        } finally {
            fs.rmSync(aliased, { recursive: true, force: true });
        }
    });
});
