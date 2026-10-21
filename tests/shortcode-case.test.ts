/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every Address is validated as written, and a shortcode is lowercase.
 *
 * A capital in the shortcode segment of an Address a field declares is a
 * located finding at the value, one per reference, and the index the lint and
 * the compile both read refuses the note. A body wikilink or embed spelling a
 * shortcode with a capital is refused the same way by all three link
 * resolvers. Where the lowercase spelling is a shortcode the tree declares, the
 * finding names it.
 */

import { describe, it, expect, afterAll } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { collectContentIndex } from "../engine/content-index.mjs";
import { parseAddress } from "../engine/address.mjs";
import { encodeAddresses } from "../engine/note-addresses.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import {
    buildWikilinkIndex,
    convertWikilinks,
    readQualifier,
    resolveWebWikilinks,
} from "../engine/wikilinks.mjs";
import { readAssetAddress } from "../engine/art-fields.mjs";
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const roots: string[] = [];

/** A content tree holding `files`, removed after the suite. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shortcode-case-"));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    return root;
}

afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const GREAVES = [
    "---",
    "type: armorgear",
    "shortcode: lleg",
    "name:",
    "  full: Leather Leggings",
    "---",
    "",
    "Leggings.",
    "",
].join("\n");

/** A being whose embedded items name their models as `models` spells them. */
function being(...models: string[]): string {
    return [
        "---",
        "type: being",
        "shortcode: guard",
        "name:",
        "  full: A Guard",
        "sohl:",
        "  items:",
        ...models.map((model) => `    - {model: ${model}}`),
        "---",
        "",
        "A guard.",
        "",
    ].join("\n");
}

/** Index a tree as the lint and the compile do, collecting what it refuses. */
function index(root: string) {
    const problems: any[] = [];
    const records = collectContentIndex(root, {
        contentPackage: "world",
        skipDirectories: [],
        addressContext: {
            package: "world",
            system: "note",
            types: new Set(Object.keys(NOTE_VOCABULARY)),
            systemBlocks: { sohl: { fields: ITEM_FIELDS } },
        },
        problems,
    });
    return { records, problems };
}

describe("a mixed-case shortcode in a declared Address", () => {
    it("is refused at the value, one finding per reference", () => {
        const root = tree({
            "Gear/Leggings.md": GREAVES,
            "Beings/Guard.md": being("armorgear-LLeg", "armorgear-lleg", "armorgear-CShoe"),
        });
        const { records, problems } = index(root);
        const file = path.join(root, "Beings/Guard.md");
        expect(problems).toEqual([
            {
                file,
                line: 8,
                column: 15,
                severity: "error",
                message:
                    "`sohl.items.0.model` shortcode `LLeg` must be lowercase; " +
                    "the declared shortcode is `lleg`",
            },
            {
                file,
                line: 10,
                column: 15,
                severity: "error",
                message: "`sohl.items.2.model` shortcode `CShoe` must be lowercase",
            },
        ]);
        // The note is refused, not indexed with a guessed reading.
        expect(records.some((r: any) => r.type === "being")).toBe(false);
    });

    it("refuses the capital at the parser, whatever the caller", () => {
        const read = parseAddress(
            "armorgear-LLeg",
            { package: "world", system: "sohl", types: new Set(["armorgear"]) },
            { declared: true },
        );
        expect(read).toMatchObject({ reason: "shortcode-not-lowercase", shortcode: "LLeg" });
    });
});

describe("the same reference in lowercase", () => {
    it("resolves", () => {
        const root = tree({
            "Gear/Leggings.md": GREAVES,
            "Beings/Guard.md": being("armorgear-lleg"),
        });
        const { records, problems } = index(root);
        expect(problems).toEqual([]);
        const guard = records.find((r: any) => r.type === "being");
        expect(encodeAddresses(guard).sohl.items[0].model).toBe("world-sohl-armorgear-lleg");
    });
});

/** A `skill` note `clmb`, and a sibling whose body is `body`. */
function linkTree(body: string): Record<string, string> {
    const note = (shortcode: string, name: string, text: string) =>
        [
            "---",
            "type: skill",
            `shortcode: ${shortcode}`,
            "name:",
            `  full: ${name}`,
            "---",
            "",
            text,
            "",
        ].join("\n");
    return {
        "Skills/Climbing.md": note("clmb", "Climbing", "Prose."),
        "Skills/Jumping.md": note("jmp", "Jumping", body),
    };
}

const DOCS = [{ type: "skill", id: "aaaaaaaaaaaaaaa1", shortcode: "clmb", name: "Climbing" }];

describe("a mixed-case shortcode in a body wikilink", () => {
    const LINKS = [
        "[[skill-Clmb|Climbing]]",
        "[[sohl-skill-Clmb|Climbing]]",
        "[[skill/Clmb|Climbing]]",
    ];

    it("is refused by the reader, not lowercased", () => {
        expect(readQualifier("skill-Clmb", new Set(["skill"]))).toMatchObject({
            reason: "shortcode-not-lowercase",
            shortcode: "Clmb",
        });
    });

    it.each(LINKS)("%s is refused by the checker, naming the declared shortcode", (link) => {
        const index = buildLinkIndex(tree(linkTree(`See ${link}.`)), { skipDirectories: [] });
        const { deadAddresses } = auditLinks(index);
        expect(deadAddresses).toHaveLength(1);
        expect(deadAddresses[0]).toMatchObject({
            reason: "shortcode-not-lowercase",
            shortcode: "Clmb",
            declared: "clmb",
        });
        expect(linkFindingMessage(deadAddresses[0])).toContain(
            "shortcode `Clmb` must be lowercase; the declared shortcode is `clmb`",
        );
    });

    it.each(LINKS)("%s is refused by the pack build", (link) => {
        const { unresolved } = convertWikilinks(link, {
            type: "skill",
            id: "aaaaaaaaaaaaaaa2",
            index: buildWikilinkIndex(DOCS, "sohl"),
        });
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({
            reason: "shortcode-not-lowercase",
            shortcode: "Clmb",
            declared: "clmb",
        });
    });

    it.each(LINKS)("%s is refused by the site build", (link) => {
        const errors: Record<string, unknown>[] = [];
        resolveWebWikilinks(link, {
            // The note's page, and the Item a system-qualified link names.
            index: new Map<string, object>([
                ["sohl-note-skill-clmb", { url: "/kb/skill/climbing/", name: "Climbing" }],
                ["sohl-sohl-skill-clmb", { name: "Climbing" }],
            ]),
            collide: new Set<string>(),
            sections: new Set<string>(["kb"]),
            contentPackage: "sohl",
            contentTypes: new Set<string>(["skill"]),
            foreign: new Map<string, object>(),
            type: "skill",
            errors,
            src: "Skills/Jumping.md",
        } as never);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            reason: "shortcode-not-lowercase",
            shortcode: "Clmb",
            declared: "clmb",
        });
    });

    it("refuses a capitalised shortcode in an embed", () => {
        const read = readAssetAddress(
            {
                contentPackage: "sohl",
                types: new Set(["icon"]),
                packages: new Set(["sohl"]),
                assets: new Map(),
            },
            "icon-Anvil",
            "image",
        );
        expect(read).toMatchObject({ reason: "shortcode-not-lowercase" });
    });

    it(
        "is reported by `package-build links` at the link's own line and column",
        () => {
            const files = Object.fromEntries(
                Object.entries(linkTree("Prose.\n\nSee [[skill-Clmb|Climbing]] here.")).map(
                    ([rel, text]) => [`assets/content/${rel}`, text],
                ),
            );
            const root = tree({
                ...files,
                "package.json": JSON.stringify({ name: "sohl", version: "1.0.0" }),
                "package-build.config.yaml": [
                    "contentPackage: sohl",
                    "packageKind: systems",
                    "compatibility: { minimum: '14.359' }",
                    "stats: { lastModifiedBy: contentbuild0000 }",
                    "itemBuilders: sohl",
                    "packs:",
                    "    - { name: items, type: Item }",
                    "",
                ].join("\n"),
            });
            const bin = path.join(
                path.dirname(fileURLToPath(import.meta.url)),
                "..",
                "bin",
                "package-build.mjs",
            );
            const r = spawnSync(process.execPath, [bin, "links"], {
                cwd: root,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                },
                encoding: "utf8",
            });
            expect(r.status).not.toBe(0);
            const line = `${r.stdout}${r.stderr}`
                .split("\n")
                .find((l) => l.includes("Clmb") && l.includes("error:"));
            expect(line).toMatch(
                /^\S*assets\/content\/Skills\/Jumping\.md:10:5: error: .*shortcode `Clmb` must be lowercase; the declared shortcode is `clmb`/,
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});

describe("no source reads a case-folding option", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const sources = ["engine", "sohl", "bin"].flatMap((dir) =>
        fs
            .readdirSync(path.join(here, "..", dir), { recursive: true })
            .map(String)
            .filter((rel) => rel.endsWith(".mjs"))
            .map((rel) => path.join(dir, rel)),
    );

    it.each(sources)("%s", (rel) => {
        const text = fs.readFileSync(path.join(here, "..", rel), "utf8");
        expect(text).not.toMatch(/legacyShortcodeCase/);
    });
});
