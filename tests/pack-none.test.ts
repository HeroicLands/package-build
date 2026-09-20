/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `pack: none` — a note that publishes and compiles into no document.
 *
 * The universal `pack` key names which compendium receives a note's document,
 * and `none` is one more value it accepts: the note is walked, indexed,
 * published and linkable, and every pack compiler passes over it without a
 * finding. It is accepted only on a type whose sole document is the
 * JournalEntry its prose becomes, because on any other type it would drop a
 * document the type exists to produce — and that refusal names the document.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "loglevel";

import { defineConfig } from "../content-config.mjs";
import { createPackRouter, declaresNoPack, NO_PACK } from "../engine/pack-router.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { JOURNAL_TYPES, packForType } from "../engine/ids.mjs";
import { itemTypes } from "../engine/item-registry.mjs";
import { noteTypesFor } from "../engine/document-subtypes.mjs";
import { documentClassesFor, unclaimedNoteFindings } from "../engine/note-claims.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { emitContentIndex, indexRecordsFor } from "../engine/content-index.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                               */
/* ---------------------------------------------------------------------- */

/** A complete configuration with the given packs, rooted anywhere. */
function baseConfig({ packs, rootDir = os.tmpdir(), systems, site, publish }: any) {
    const named = [...new Set(packs.map((p: any) => p.system).filter(Boolean))] as string[];
    const declared =
        systems ??
        Object.fromEntries(named.map((id) => [id, { compatibility: { verified: "1.0.0" } }]));
    return defineConfig({
        compatibility: { minimum: "14.359", verified: "14.359" },
        rootDir,
        contentPackage: contentPackage(),
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: { lastModifiedBy: "sohltestbuild0000" },
        ...(Object.keys(declared).length ? { systems: declared } : {}),
        packs,
        ...(site ? { site } : {}),
        ...(publish ? { publish } : {}),
    } as any);
}

/** A throwaway repository root holding the given notes. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-packnone-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets", "templates"), { recursive: true });
    fs.mkdirSync(path.join(root, "build", "cache", "metadata"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "assets", "templates", "system.template.json"),
        JSON.stringify({ id: "sohl", compatibility: { minimum: "14" } }),
    );
    for (const [file, text] of Object.entries(notes)) {
        const abs = path.join(root, "assets", "content", file);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text);
    }
    return root;
}

/** A `doc` note. */
function doc(name: string, shortcode: string, extra = "", body = `Prose for ${name}.`): string {
    return `---
name:
  full: ${name}
shortcode: ${shortcode}
type: doc
subType: reference
${extra}
---

${body}
`;
}

/** A skill note, complete enough to compile. */
function skill(name: string, shortcode: string, extra = ""): string {
    return `---
name:
  full: ${name}
shortcode: ${shortcode}
type: skill
${extra}
sohl:
  templatePriority: null
  subType: physical
  skillBaseFormula: "sb(attr.str)"
  combatCategory: none
  parentSkillCode: ""
  initSkillMult: 0
  masteryLevelBase: null
  improveFlag: false
---

Prose for ${name}.
`;
}

/** Every compiled document name in a pack's JSON directory. */
function packNames(root: string, pack: string): string[] {
    const dir = path.join(root, "build", "packs-json", pack);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && !f.startsWith("folder_"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).name)
        .sort();
}

/** Every compiled document in a pack's JSON directory, by name. */
function packDocs(root: string, pack: string): Record<string, any> {
    const dir = path.join(root, "build", "packs-json", pack);
    const out: Record<string, any> = {};
    if (!fs.existsSync(dir)) return out;
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json") || file.startsWith("folder_")) continue;
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[parsed.name] = parsed;
    }
    return out;
}

/** Run a compile, capturing every diagnostic it prints. */
async function compile(root: string, packs: any[]) {
    const messages: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => messages.push(args.join(" "));
    try {
        const errors = await generatePacksJson({ config: baseConfig({ rootDir: root, packs }) });
        return { errors, messages };
    } finally {
        console.error = original;
    }
}

const ONE_OF_EACH = [
    { name: "items", type: "Item" },
    { name: "journals", type: "JournalEntry" },
];

const roots: string[] = [];
beforeAll(() => log.setLevel("silent"));
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    log.setLevel("warn");
});

/* ---------------------------------------------------------------------- */
/*  The router                                                             */
/* ---------------------------------------------------------------------- */

describe("createPackRouter — `pack: none`", () => {
    const router = () => createPackRouter(baseConfig({ packs: ONE_OF_EACH }).packs);

    it("spells the value once", () => {
        expect(NO_PACK).toBe("none");
    });

    it("resolves a `doc` declaring none to no pack at all", () => {
        expect(router().resolve({ type: "doc", pack: "none" }, "JournalEntry")).toBeUndefined();
        expect(
            router().resolveOrNull({ type: "doc", pack: "none" }, "JournalEntry"),
        ).toBeUndefined();
    });

    it("still routes a `doc` declaring nothing to the default journal pack", () => {
        expect(router().resolve({ type: "doc" }, "JournalEntry")).toBe("journals");
    });

    it("refuses it on a type that compiles an Item, naming the Item", () => {
        expect(() => router().resolve({ type: "skill", pack: "none" }, "Item")).toThrow(
            /pack: none.*\bItem\b/s,
        );
    });

    it("refuses it on a type that compiles an Actor, naming the Actor", () => {
        const withActors = createPackRouter(
            baseConfig({ packs: [...ONE_OF_EACH, { name: "actors", type: "Actor" }] }).packs,
        );
        expect(() => withActors.resolve({ type: "being", pack: "none" }, "Actor")).toThrow(
            /pack: none.*\bActor\b/s,
        );
    });

    it("derives the refused types from the registries, not from a list", () => {
        // Every type the configured item registry declares, and every type the
        // system maps to an Actor, compiles a document beside its prose. Each
        // is refused, and the refusal names that document — read here from the
        // claim table, which is a derivation independent of the router's.
        const refused = [...itemTypes(), ...noteTypesFor(SOHL_DOCUMENT_SUBTYPES, "Actor")];
        expect(refused.length).toBeGreaterThan(5);
        const withActors = createPackRouter(
            baseConfig({ packs: [...ONE_OF_EACH, { name: "actors", type: "Actor" }] }).packs,
        );
        for (const type of refused) {
            const documents = documentClassesFor(type).filter((d) => d !== "JournalEntry");
            expect(documents, type).not.toEqual([]);
            const { docType } = packForType(type);
            expect(() => withActors.resolve({ type, pack: "none" }, docType), type).toThrow(
                new RegExp(`pack: none.*\\b${documents[0]}\\b`, "s"),
            );
        }
    });

    it("accepts it on every type whose only document is the JournalEntry", () => {
        for (const type of JOURNAL_TYPES) {
            expect(documentClassesFor(type), type).toEqual(["JournalEntry"]);
            expect(router().resolve({ type, pack: "none" }, "JournalEntry"), type).toBeUndefined();
        }
    });

    it("reads `<system>.pack: none` for that system's pass, over the shared value", () => {
        const twoSystems = createPackRouter(
            baseConfig({
                packs: [
                    { name: "journals", type: "JournalEntry" },
                    { name: "journals-sohl", type: "JournalEntry", system: "sohl" },
                ],
            }).packs,
        );
        const fm = { type: "doc", pack: "journals", sohl: { pack: "none" } };
        // The block overrides the shared declaration for its own system …
        expect(twoSystems.resolve(fm, "JournalEntry", "sohl")).toBeUndefined();
        // … and leaves the shared declaration standing for every other.
        expect(twoSystems.resolve(fm, "JournalEntry", "hm3")).toBe("journals");
        expect(twoSystems.resolve(fm, "JournalEntry")).toBe("journals");
    });

    it("lets a block name a pack where the shared declaration is none", () => {
        const twoSystems = createPackRouter(
            baseConfig({
                packs: [
                    { name: "journals", type: "JournalEntry" },
                    { name: "journals-sohl", type: "JournalEntry", system: "sohl" },
                ],
            }).packs,
        );
        const fm = { type: "doc", pack: "none", sohl: { pack: "journals-sohl" } };
        expect(twoSystems.resolve(fm, "JournalEntry", "sohl")).toBe("journals-sohl");
        expect(twoSystems.resolve(fm, "JournalEntry")).toBeUndefined();
    });

    it("refuses `<system>.pack: none` on a type that compiles an Item, the same way", () => {
        const sohlItems = createPackRouter(
            baseConfig({ packs: [{ name: "items-sohl", type: "Item", system: "sohl" }] }).packs,
        );
        expect(() =>
            sohlItems.resolve({ type: "skill", sohl: { pack: "none" } }, "Item", "sohl"),
        ).toThrow(/pack: none.*\bItem\b/s);
    });
});

describe("declaresNoPack — what a note says about its packs", () => {
    it("is true when the shared declaration is none", () => {
        expect(declaresNoPack({ type: "doc", pack: "none" })).toBe(true);
    });

    it("is false when the note declares nothing, or a pack", () => {
        expect(declaresNoPack({ type: "doc" })).toBe(false);
        expect(declaresNoPack({ type: "doc", pack: "journals" })).toBe(false);
    });

    it("reads a system's block over the shared value", () => {
        expect(declaresNoPack({ type: "doc", sohl: { pack: "none" } }, "sohl")).toBe(true);
        expect(declaresNoPack({ type: "doc", pack: "none", sohl: { pack: "j" } }, "sohl")).toBe(
            false,
        );
        expect(declaresNoPack({ type: "doc", pack: "none", sohl: { pack: "j" } }, "hm3")).toBe(
            true,
        );
    });
});

/* ---------------------------------------------------------------------- */
/*  The compile                                                            */
/* ---------------------------------------------------------------------- */

describe("generatePacksJson — a `doc` declaring `pack: none`", () => {
    let root: string;
    let errors: number;
    let messages: string[];

    beforeAll(async () => {
        root = repo({
            "Dev_Docs/Architecture.md": doc(
                "Architecture",
                "architecture",
                "pack: none",
                "## Layers {#layers}\n\nHow it is built. See [[doc-combat]].",
            ),
            "Rules/Combat.md": doc(
                "Combat",
                "combat",
                "",
                "Hit things. Read [[doc-architecture|the architecture]] and [[doc-architecture#layers|its layers]].",
            ),
            "Skills/Climbing.md": skill("Climbing", "climbing"),
        });
        roots.push(root);
        ({ errors, messages } = await compile(root, ONE_OF_EACH));
    });

    it("compiles without error", () => {
        expect(errors).toBe(0);
    });

    it("raises no finding about the note", () => {
        expect(messages.filter((m) => m.includes("Architecture"))).toEqual([]);
    });

    it("compiles the note into no document, and everything else as before", () => {
        expect(packNames(root, "journals")).toEqual(["Climbing", "Combat"]);
        expect(packNames(root, "items")).toEqual(["Climbing"]);
    });

    it("renders a compiled link to it as its label, with no document to open", () => {
        const page = packDocs(root, "journals")["Combat"].pages[0].text.content;
        expect(page).toContain("the architecture");
        expect(page).toContain("its layers");
        expect(page).not.toContain("architecture]");
        expect(page).not.toMatch(/@UUID\[[^\]]*architecture/i);
    });
});

describe("generatePacksJson — `pack: none` on a type that compiles an Item", () => {
    it("fails the build, naming the Item it would drop", async () => {
        const root = repo({
            "Skills/Climbing.md": skill("Climbing", "climbing", "pack: none"),
            "Skills/Jumping.md": skill("Jumping", "jumping"),
        });
        roots.push(root);
        const { errors, messages } = await compile(root, ONE_OF_EACH);
        expect(errors).toBeGreaterThan(0);
        const reported = messages.filter((m) => m.includes("pack: none"));
        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatch(/^[^\s]*Climbing\.md: error: /);
        expect(reported[0]).toMatch(/\bItem\b/);
        expect(packNames(root, "items")).toEqual(["Jumping"]);
    });
});

describe("unclaimedNoteFindings — a `pack: none` note is not unclaimed", () => {
    it("reports nothing for a `doc` declaring none, even with no JournalEntry pack", () => {
        const root = repo({
            "Dev_Docs/Architecture.md": doc("Architecture", "architecture", "pack: none"),
        });
        roots.push(root);
        const config = baseConfig({ rootDir: root, packs: [{ name: "items", type: "Item" }] });
        const records = indexRecordsFor({
            contentBase: config.paths.content,
            config,
            skipDirectories: [],
        });
        expect(unclaimedNoteFindings(config, undefined, { records })).toEqual([]);
    });

    it("still reports the same `doc` when it declares nothing", () => {
        const root = repo({
            "Dev_Docs/Architecture.md": doc("Architecture", "architecture"),
        });
        roots.push(root);
        const config = baseConfig({ rootDir: root, packs: [{ name: "items", type: "Item" }] });
        const records = indexRecordsFor({
            contentBase: config.paths.content,
            config,
            skipDirectories: [],
        });
        const findings = unclaimedNoteFindings(config, undefined, { records });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/JournalEntry/);
    });

    it("leaves a `skill` declaring none to the router, which refuses it", () => {
        // The type still produces an Item, and with an Item pack configured
        // that document has somewhere to go; the refusal is the compile's.
        const root = repo({ "Skills/Climbing.md": skill("Climbing", "climbing", "pack: none") });
        roots.push(root);
        const config = baseConfig({ rootDir: root, packs: ONE_OF_EACH });
        const records = indexRecordsFor({
            contentBase: config.paths.content,
            config,
            skipDirectories: [],
        });
        expect(unclaimedNoteFindings(config, undefined, { records })).toEqual([]);
    });
});

/* ---------------------------------------------------------------------- */
/*  The content index, the link checker and the site                       */
/* ---------------------------------------------------------------------- */

describe("the content index records a `pack: none` note with no Foundry address", () => {
    it("carries the note's address and no `foundry` block", () => {
        const root = repo({
            "Dev_Docs/Architecture.md": doc("Architecture", "architecture", "pack: none"),
            "Rules/Combat.md": doc("Combat", "combat"),
        });
        roots.push(root);
        const config = baseConfig({ rootDir: root, packs: ONE_OF_EACH });
        const { file } = emitContentIndex({ config });
        const records = fs
            .readFileSync(file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        const none = records.find((r) => r.shortcode === "architecture");
        const some = records.find((r) => r.shortcode === "combat");
        expect(none.address.canonical).toBe("sohl-none-doc-architecture");
        expect(none.foundry).toBeNull();
        // The positive control: a `doc` that compiles publishes its UUID.
        expect(some.foundry.none.uuid).toMatch(/^Compendium\.sohl\.journals\.JournalEntry\./);
    });
});

describe("a wikilink to a `pack: none` note resolves", () => {
    it("is a live address for the link checker, anchors included", () => {
        const root = repo({
            "Dev_Docs/Architecture.md": doc(
                "Architecture",
                "architecture",
                "pack: none",
                "## Layers {#layers}\n\nHow it is built.",
            ),
            "Rules/Combat.md": doc(
                "Combat",
                "combat",
                "",
                "See [[doc-architecture|]] and [[doc-architecture#layers|]].",
            ),
        });
        roots.push(root);
        const config = baseConfig({ rootDir: root, packs: ONE_OF_EACH });
        const index = buildLinkIndex(config.paths.content, { skipDirectories: [], config });
        const audited = auditLinks(index);
        expect(audited.deadAddresses).toEqual([]);
        expect(audited.deadAnchors).toEqual([]);
    });

    it("publishes the page and resolves the link to it on the site", () => {
        const root = repo({
            "homepage.md": "---\ntype: homepage\nshortcode: root\n---\n\nFront.\n",
            "Dev_Docs/Architecture.md": doc("Architecture", "architecture", "pack: none"),
            "Rules/Combat.md": doc("Combat", "combat", "", "See [[doc-architecture|]]."),
        });
        roots.push(root);
        const config = baseConfig({
            rootDir: root,
            packs: ONE_OF_EACH,
            publish: { site: "content", address: { prefix: "kb/" } },
        });
        const result = buildSite({ config });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.wikiErrors).toEqual([]);
        const out = path.join(root, "build/hugo/content/kb");
        expect(fs.existsSync(path.join(out, "doc-architecture.md"))).toBe(true);
        const combat = fs.readFileSync(path.join(out, "doc-combat.md"), "utf8");
        expect(combat).toContain("[Architecture](/sohl/doc-architecture/)");
    });
});
