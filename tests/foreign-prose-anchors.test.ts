/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { positionOfLiteral } from "../engine/diagnostics.mjs";
import { fetchMetadataFromPath } from "../engine/foreign-catalog.mjs";
import { buildContentLinkIndex } from "../engine/helpers.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { buildSiteIndex, wikiContext } from "../engine/site-index.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { convertWikilinks } from "../engine/wikilinks.mjs";
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PACKAGE_ROOT, "bin/package-build.mjs");
let root: string;
let leaf: ReturnType<typeof configure>;
let fetchedBytes: string;
let publishedBytes: string;
let stubRefusal: ReturnType<typeof run>;

function write(file: string, body: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
}

function note(fm: Record<string, unknown>, body = "Prose.") {
    return `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
}

function configure(contentPackage: string, extra: Record<string, unknown> = {}) {
    const dir = path.join(root, contentPackage);
    write(
        path.join(dir, "package.json"),
        JSON.stringify({ name: contentPackage, version: "1.0.0" }),
    );
    const data = {
        contentPackage,
        packageKind: "modules",
        compatibility: { minimum: "14", verified: "14.367" },
        stats: { lastModifiedBy: "anchorbuild00000" },
        skipDirectories: [],
        packs: [{ name: "journals", type: "JournalEntry", default: true }],
        ...extra,
    };
    const file = path.join(dir, "package-build.config.yaml");
    write(file, YAML.stringify(data));
    return { dir, file, config: configFromData(data, file) };
}

function run(repo: ReturnType<typeof configure>, command: string) {
    const result = spawnSync(process.execPath, [CLI, command], {
        cwd: repo.dir,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: repo.file },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function reader(body: string, tags: string[] = []) {
    const file = path.join(leaf.config.paths.content, "Reader.md");
    write(file, note({ type: "doc", shortcode: "reader", name: { full: "Reader" }, tags }, body));
    return file;
}

function audit(body: string, tags: string[] = []) {
    reader(body, tags);
    return auditLinks(
        buildLinkIndex(leaf.config.paths.content, { config: leaf.config, skipDirectories: [] }),
    );
}

beforeAll(async () => {
    fs.mkdirSync(path.join(PACKAGE_ROOT, "nogit"), { recursive: true });
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, "nogit", "foreign-prose-anchors-"));
    const publisher = configure("pub", {
        itemBuilders: ["sohl"],
        systems: { sohl: { compatibility: { verified: "0.9.0" } } },
        packs: [
            { name: "items", type: "Item", system: "sohl", default: true },
            { name: "journals", type: "JournalEntry", default: true },
        ],
    });
    const content = publisher.config.paths.content;
    write(
        path.join(content, "Guide.md"),
        note(
            { type: "doc", shortcode: "guide", name: { full: "Guide" } },
            "# Reading {#reading}\n\nA published section.",
        ),
    );
    write(
        path.join(content, "Chronicle.md"),
        note(
            {
                type: "lore",
                subType: "history",
                shortcode: "chronicle",
                name: { full: "Chronicle" },
                data: { events: [{ id: "founding", when: "1", summary: "The town is founded." }] },
            },
            "# Origins {#origins}\n\nA history.",
        ),
    );
    write(
        path.join(content, "Secret.md"),
        note(
            { type: "doc", shortcode: "secret", name: { full: "Secret" }, tags: ["gm"] },
            "# Hidden {#hidden}\n\nSecret prose.",
        ),
    );
    write(
        path.join(content, "Skill.md"),
        note(
            {
                type: "skill",
                subType: "craft",
                shortcode: "craft",
                name: { full: "Craft" },
                sohl: { subType: "craft" },
            },
            "# Method {#method}\n\nCraft prose.",
        ),
    );
    const stub = path.join(content, "Stub.md");
    write(stub, note({ type: "doc", shortcode: "stub", name: { full: "Stub" } }, ""));
    stubRefusal = run(publisher, "content-index");
    expect(stubRefusal.status, stubRefusal.output).toBe(1);
    expect(stubRefusal.output).toMatch(/Stub\.md:\d+:\d+: error: this note has no body/);
    expect(
        fs.existsSync(path.join(publisher.config.paths.contentIndex, "pub-metadata.jsonl")),
    ).toBe(false);
    fs.rmSync(stub);
    const published = run(publisher, "content-index");
    expect(published.status, published.output).toBe(0);
    const metadata = path.join(publisher.config.paths.contentIndex, "pub-metadata.jsonl");
    publishedBytes = fs.readFileSync(metadata, "utf8");

    const artifact = path.join(root, "artifact");
    write(
        path.join(artifact, "module.json"),
        JSON.stringify({
            id: "pub",
            version: "1.0.0",
            flags: { metadataUrl: "https://example.invalid/pub-metadata.jsonl" },
        }),
    );
    fs.copyFileSync(metadata, path.join(artifact, "pub-metadata.jsonl"));
    leaf = configure("leaf", {
        relationships: {
            requires: [
                {
                    id: "pub",
                    type: "module",
                    manifest: "https://example.invalid/module.json",
                    compatibility: { verified: "1.0.0" },
                },
            ],
        },
    });
    const fetched = await fetchMetadataFromPath(leaf.config, { id: "pub" }, artifact);
    fetchedBytes = fs.readFileSync(fetched, "utf8");
    write(
        path.join(leaf.config.paths.content, "Local.md"),
        note({ type: "doc", shortcode: "local" }, "# Local {#local}\n\nProse."),
    );
    write(
        path.join(leaf.config.paths.content, "LocalStub.md"),
        note({ type: "doc", shortcode: "stub" }, ""),
    );
}, subprocessTimeout(2));

afterAll(() => root && fs.rmSync(root, { recursive: true, force: true }));

describe("foreign prose anchors from the publisher's fetched metadata", () => {
    it("fetches the real publisher artifact without changing its anchors", () => {
        expect(stubRefusal.status).toBe(1);
        expect(stubRefusal.output).toContain("this note has no body");
        expect(fetchedBytes).toBe(publishedBytes);
        const foreign = loadForeignIndexes(leaf.config, new Set(["leaf"]));
        expect(foreign.index.get("pub-note-doc-guide")?.noteAnchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "reading", kind: "prose" })]),
        );
        expect(foreign.index.get("pub-note-lore-chronicle")?.noteAnchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "founding", kind: "event" })]),
        );
    });

    it(
        "reports a missing foreign section at each authored link through the CLI",
        () => {
            const link = "[[pub-note-doc-guide#missing|the section]]";
            const file = reader(`First ${link}.\n\nSecond ${link}.`);
            const result = run(leaf, "links");
            expect(result.status, result.output).toBe(1);
            for (const occurrence of [1, 2]) {
                const at = positionOfLiteral(fs.readFileSync(file, "utf8"), link, occurrence);
                expect(result.output).toContain(`Reader.md:${at.line}:${at.column}: error:`);
            }
            expect(result.output.match(/no section "#missing" is published for it/g)).toHaveLength(
                2,
            );
            expect(result.output).not.toContain("every anchor link lands");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "accepts a declared foreign prose section through the CLI",
        () => {
            reader("Read [[pub-note-doc-guide#reading|the published section]].");
            const result = run(leaf, "links");
            expect(result.status, result.output).toBe(0);
            expect(result.output).toContain("every anchor link lands");
            expect(result.output).toContain("1 cross-package reference(s) via manifest");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it("agrees with both renderers on the missing anchor finding", () => {
        const link = "[[pub-note-doc-guide#Missing Section|the section]]";
        const findings = audit(`Read ${link}.`).deadAnchors;
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            reason: "unknown-anchor",
            target: "pub-note-doc-guide",
            anchor: "Missing Section",
            text: link,
            occurrence: 1,
        });
        const foreign = loadForeignIndexes(leaf.config, new Set(["leaf"]), {
            pub: "https://example.invalid/pub/",
        });
        const foundry = convertWikilinks(link, {
            type: "doc",
            id: "reader",
            index: buildContentLinkIndex(leaf.config.paths.content, undefined, {
                config: leaf.config,
                records: indexRecordsFor({
                    contentBase: leaf.config.paths.content,
                    config: leaf.config,
                    skipDirectories: [],
                }),
            }),
        });
        const errors: any[] = [];
        const site = buildSiteIndex([], { package: "leaf", foreignIndex: foreign.index });
        resolveWebWikilinks(link, {
            ...wikiContext(site, { errors, foreignIndex: foreign.index }),
            contentPackage: "leaf",
        });
        expect(foundry.unresolved.map(linkFindingMessage)).toEqual(
            findings.map(linkFindingMessage),
        );
        expect(errors.map(linkFindingMessage)).toEqual(findings.map(linkFindingMessage));
    });

    it("refuses a foreign event id as an event, not as a prose section", () => {
        const result = audit("Read [[pub-note-lore-chronicle#founding|the founding]].");
        expect(result.deadAnchors).toHaveLength(1);
        expect(result.deadAnchors[0]).toMatchObject({ reason: "event-anchor", anchor: "founding" });
        expect(result.deadAddresses).toEqual([]);
    });

    it("keeps a public link to a foreign GM note an audience refusal", () => {
        const result = audit("Read [[pub-note-doc-secret#missing|a secret]].");
        expect(result.deadAddresses).toMatchObject([{ reason: "gm" }]);
        expect(result.deadAnchors).toEqual([]);
    });

    it("checks foreign GM sections from a GM note", () => {
        const missing = audit("Read [[pub-note-doc-secret#missing|a secret]].", ["gm"]);
        expect(missing.deadAddresses).toEqual([]);
        expect(missing.deadAnchors).toMatchObject([{ reason: "unknown-anchor" }]);
        const present = audit("Read [[pub-note-doc-secret#hidden|a secret]].", ["gm"]);
        expect(present.deadAddresses).toEqual([]);
        expect(present.deadAnchors).toEqual([]);
    });

    it("preserves canonical spelling and never falls through a short address to a dependency", () => {
        const result = audit(
            [
                "[[pub-note-doc-Guide#reading|wrong case]]",
                "[[Pub-note-doc-guide#reading|wrong package case]]",
                "[[doc-guide#reading|local address]]",
            ].join("\n\n"),
        );
        expect(result.deadAddresses.map((finding) => finding.reason)).toEqual([
            "shortcode-not-lowercase",
            "not-lowercase",
            "unresolved",
        ]);
        expect(result.deadAnchors).toEqual([]);
    });

    it("preserves local stub, missing foreign address, and system-document handling", () => {
        const result = audit(
            [
                "[[doc-stub#missing|local stub]]",
                "[[pub-note-doc-stub#missing|foreign stub]]",
                "[[pub-sohl-skill-craft#missing|the skill sheet]]",
            ].join("\n\n"),
        );
        expect(result.deadAddresses.map((finding) => finding.reason)).toEqual([
            "stub",
            "unresolved",
        ]);
        expect(result.deadAnchors).toEqual([]);
    });

    it("checks the note view of a foreign system document", () => {
        const missing = audit("[[pub-note-skill-craft#missing|the documentation]]");
        expect(missing.deadAddresses).toEqual([]);
        expect(missing.deadAnchors).toMatchObject([{ reason: "unknown-anchor" }]);
        const present = audit("[[pub-note-skill-craft#method|the documentation]]");
        expect(present.deadAddresses).toEqual([]);
        expect(present.deadAnchors).toEqual([]);
    });

    it("retains local and same-page anchor checks", () => {
        const result = audit(
            [
                "[[doc-local#local|present]] [[doc-local#missing|missing]]",
                "[[#reader|present]] [[#missing|missing]]",
                "# Reader {#reader}",
            ].join("\n\n"),
        );
        expect(result.deadAddresses).toEqual([]);
        expect(result.deadAnchors.map((finding) => finding.target)).toEqual(["doc-local", ""]);
    });
});
