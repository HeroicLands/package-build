/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import {
    indexRecordsFor,
    isAssetRecord,
    isNoteRecord,
    noteFile,
} from "../engine/content-index.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { lintContentCharset } from "../engine/content-charset.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { positionOfLiteral } from "../engine/diagnostics.mjs";
import { metadataCacheDir, metadataFileName, markComplete } from "../engine/metadata-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { lintPathCharset } from "../engine/path-charset.mjs";
import { prepareLinkSqlTables } from "../engine/sql-tables.mjs";
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
}

function note(fm: Record<string, unknown>, body = "Written prose.") {
    return `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
}

/** Real capture, including physical inputs that are not selected note records. */
function fixture(size = 8, pkg = "local") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "link-source-reuse-")));
    roots.push(root);
    write(path.join(root, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }));
    const config = configFromData(
        {
            contentPackage: pkg,
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "linksourceproof0" },
            skipDirectories: ["Templates"],
            systems: { sohl: { compatibility: { verified: "0.9.0" } } },
            itemBuilders: ["sohl"],
            packs: [
                { name: "journals", type: "JournalEntry", default: true },
                { name: "items", type: "Item", system: "sohl", default: true },
            ],
            relationships: {
                requires: [{ id: "pub", manifest: "https://example.invalid/module.json" }],
            },
        },
        path.join(root, "package-build.config.yaml"),
    );
    const contentBase = config.paths.content;
    const dependency = metadataCacheDir(config, "pub", "1.0.0");
    write(
        path.join(dependency, metadataFileName("pub")),
        JSON.stringify({
            package: "pub",
            type: "lore",
            shortcode: "foreign",
            name: { full: "Foreign note" },
            address: { canonical: "pub-note-lore-foreign", slug: "lore-foreign" },
            anchors: [{ slug: "known", kind: "prose" }],
        }) + "\n",
    );
    markComplete(dependency);
    const guide = [
        "---",
        "type: doc",
        "shortcode: guide",
        "name:",
        "  full: Guide",
        "description: 'See [[lore-target|Target]] here.'",
        "---",
        "",
        "",
        "😀 First [[lore-target#missing|Missing]] and [[lore-target#missing|Missing]].\r",
        "[[lore-target#founding|Event]], [[lore-target#known|Known]], [[lore-stub|Stub]].",
        "[[lore-private|Private]], [[lore-draft|Draft]], [[lore-missing|Absent]], [[lore-target]].",
        "[[pub-note-lore-foreign#known|Foreign]] and [[pub-note-lore-foreign#gone|Gone]].",
        "![[image-anvil|Anvil]]",
        "",
        "",
    ].join("\n");
    write(path.join(contentBase, "Guide.md"), guide);
    write(
        path.join(contentBase, "Target.md"),
        note(
            {
                type: "lore",
                subType: "history",
                shortcode: "target",
                name: { full: "Target" },
                data: { events: [{ id: "founding", when: "1", summary: "The founding." }] },
            },
            "\r\n## Known {#known}\r\n\r\nCRLF prose.\r\n\r\n",
        ),
    );
    for (const tag of ["private", "draft"]) {
        write(
            path.join(contentBase, `${tag}.md`),
            note({ type: "lore", shortcode: tag, tags: [tag === "private" ? "gm" : "draft"] }),
        );
    }
    write(path.join(contentBase, "Stub.md"), note({ type: "lore", shortcode: "stub" }, ""));
    write(path.join(contentBase, "Group/_index.md"), note({ type: "folder", shortcode: "group" }));
    write(
        path.join(contentBase, "Language.md"),
        note(
            {
                type: "skill",
                subType: "language",
                shortcode: "language",
                name: { full: "A language" },
                data: {
                    fields: [{ name: "Nature", holds: "Natural things." }],
                    words: [{ form: "men", class: "n", field: "Nature", gloss: "stone" }],
                },
            },
            "",
        ),
    );
    write(
        path.join(contentBase, "Gear.md"),
        note({ type: "miscgear", shortcode: "gear", name: { full: "Gear" } }),
    );
    for (let n = 8; n < size; n++) {
        write(
            path.join(contentBase, `Extra${n}.md`),
            note({ type: "lore", shortcode: `extra${n}` }),
        );
    }
    write(path.join(contentBase, "Malformed.md"), "---\ntype: lore\nbad: [ }\n---\n\nə\n");
    write(path.join(contentBase, "Untyped.md"), "# Scaffolding\n\nə\n");
    write(
        path.join(contentBase, "CrLf.md"),
        note({ type: "lore", shortcode: "crlf" }).replaceAll("\n", "\r\n"),
    );
    write(path.join(contentBase, "Bad.yaml"), "bad: [ }\n# ə\n");
    write(path.join(contentBase, "Bad.json"), '{"bad": ə\n');
    write(path.join(contentBase, "Páth.txt"), "No note record.\n");
    write(
        path.join(contentBase, "Templates/Skipped.md"),
        note({ type: "lore", shortcode: "skip" }),
    );
    write(path.join(config.paths.assets, "images/anvil.svg"), "<svg/>\n");
    write(
        path.join(config.paths.assets, "images/provenance.yaml"),
        "attribution: Test fixture\nlicense: CC0-1.0\nai: false\n",
    );
    return { root, contentBase, config, guide, size };
}

async function capture(repo: ReturnType<typeof fixture>) {
    const parsed = new Map();
    const problems: any[] = [];
    const scope = { config: repo.config, skipDirectories: repo.config.skipDirectories };
    const records = indexRecordsFor({ contentBase: repo.contentBase, ...scope, parsed, problems });
    const sqlTables = await prepareLinkSqlTables(repo.contentBase, { ...scope, records, parsed });
    const selected = records.filter(
        (record) => isNoteRecord(record) && typeof record.type === "string",
    );
    return {
        ...repo,
        ...scope,
        records,
        parsed,
        problems,
        sqlTables,
        sources: new Set(selected.map((record) => noteFile(repo.contentBase, record))),
    };
}

type Capture = Awaited<ReturnType<typeof capture>>;
type LinkIndex = ReturnType<typeof buildLinkIndex>;

/** Count only selected note-source opens, after capture and SQL preparation. */
function measured(source: Capture, parsed?: Map<string, any>) {
    const reads: string[] = [];
    const read = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) => {
        if (typeof args[0] === "string" && source.sources.has(args[0])) reads.push(args[0]);
        return read(...(args as Parameters<typeof fs.readFileSync>));
    });
    try {
        const index = buildLinkIndex(source.contentBase, {
            config: source.config,
            skipDirectories: source.skipDirectories,
            records: source.records,
            sqlTables: source.sqlTables,
            ...(parsed === undefined ? {} : { parsed }),
        });
        return { index, reads };
    } finally {
        spy.mockRestore();
    }
}

/** Locate findings in the same order and with the same reporters as `links`. */
function diagnostics(index: LinkIndex) {
    const audit = auditLinks(index);
    const located = (finding: any, message: string, text = finding.text) => ({
        file: finding.note.file,
        ...positionOfLiteral(finding.note.raw, text, finding.occurrence),
        severity: "error",
        message,
    });
    return [
        ...audit.deadAnchors.map((finding) => located(finding, linkFindingMessage(finding))),
        ...[...audit.deadAddresses, ...audit.unlabelledLinks, ...audit.deadEmbeds].map((finding) =>
            located(finding, finding.message ?? linkFindingMessage(finding)),
        ),
        ...audit.frontmatterLinks.map((finding) =>
            located(
                finding,
                `wikilink ${finding.link} authored in frontmatter at ${finding.path} — frontmatter is data and is never resolved`,
                finding.link,
            ),
        ),
        ...audit.homepageLinks.map((finding) =>
            located(finding, `${finding.field}: ${finding.message}`),
        ),
    ];
}

function view(index: LinkIndex) {
    return {
        notes: index.notes,
        frontmatterLinks: index.frontmatterLinks,
        anchors: index.notes.map((note) => [note.rel, [...index.anchors.get(note)]]),
        events: index.notes.map((note) => [note.rel, [...index.eventAnchorsOf.get(note)]]),
        links: index.notes.map((note) => [note.rel, index.linksOf(note)]),
        embeds: index.notes.map((note) => [note.rel, index.embedsOf(note)]),
        audit: auditLinks(index),
        diagnostics: diagnostics(index),
        resolutions: {
            address: index.resolveAddress("lore-target"),
            asset: index.addressHit(`${index.contentPackage}-none-image-anvil`),
            stubPage: index.resolveAddress("lore-stub"),
            stubData: index.addressHit("lore-stub"),
            stub: index.stubAt("lore-stub"),
            foreignPage: index.manifestHit("pub-note-lore-foreign"),
            foreignData: index.addressHit("pub-note-lore-foreign"),
            foreignHits: index.foreignHits("pub-note-lore-foreign"),
            localShortcode: index.shortcodeHit("lore", "target"),
            foreignShortcode: index.shortcodeHit("lore", "foreign"),
        },
    };
}

describe("the audit link index reuses the caller's captured raw sources", () => {
    it.each([8, 16])(
        "removes %i duplicate opens with exact audit equivalence and one-entry fallback",
        async (size) => {
            const source = await capture(fixture(size));
            expect(source.sources.size, JSON.stringify(source.problems)).toBe(size + 1);
            expect(source.records.some(isAssetRecord)).toBe(true);
            expect(source.records.some((record) => Boolean(record.documents))).toBe(true);
            expect(source.problems).toEqual([
                expect.objectContaining({
                    file: path.join(source.contentBase, "Malformed.md"),
                    severity: "error",
                }),
            ]);
            expect(source.sources.has(path.join(source.contentBase, "Language.md"))).toBe(true);
            const languageFile = path.join(source.contentBase, "Language.md");
            const languageSource = source.parsed.get(languageFile);
            expect(languageSource.body).toBe("");
            const preparedLanguage = source.sqlTables.get(languageFile);
            expect(preparedLanguage.lexical).toEqual([
                expect.objectContaining({
                    slug: "dictionary",
                    result: expect.objectContaining({
                        rows: [
                            expect.objectContaining({
                                name: "men",
                                field: "Nature",
                                senses: [{ text: "stone", bodies: [] }],
                            }),
                        ],
                    }),
                }),
            ]);
            const dictionary = expandContentTables(languageSource.body, {
                source: languageFile,
                sqlTables: preparedLanguage,
            }).markdown;
            expect(dictionary).toContain("# Dictionary {#dictionary}");
            expect(dictionary).toContain("**men**");
            expect(dictionary).toContain("Stone.");
            expect(source.sources.has(path.join(source.contentBase, "Group/_index.md"))).toBe(true);
            expect(source.sources.has(path.join(source.contentBase, "Templates/Skipped.md"))).toBe(
                false,
            );
            const before = structuredClone({
                records: source.records,
                parsed: [...source.parsed],
                problems: source.problems,
            });
            const baseline = measured(source);
            const supplied = measured(source, source.parsed);
            const missing = path.join(source.contentBase, "Guide.md");
            const partial = new Map(source.parsed);
            partial.delete(missing);
            const fallback = measured(source, partial);

            expect(baseline.reads.sort()).toEqual([...source.sources].sort());
            expect(supplied.reads).toEqual([]);
            expect(fallback.reads).toEqual([missing]);
            expect(view(supplied.index)).toEqual(view(baseline.index));
            expect(view(fallback.index)).toEqual(view(baseline.index));
            expect({
                records: source.records,
                parsed: [...source.parsed],
                problems: source.problems,
            }).toEqual(before);

            const observed = view(supplied.index);
            expect(observed.resolutions.address?.rel).toBe("Target.md");
            expect(observed.resolutions.asset?.asset.path).toBe("images/anvil.svg");
            expect(observed.resolutions.stubPage).toBeUndefined();
            expect(observed.resolutions.stubData?.rel).toBe("Stub.md");
            expect(observed.resolutions.foreignHits).toHaveLength(1);
            expect(observed.audit.usedManifest.size).toBe(1);
            expect(observed.audit.deadAddresses.map((finding) => finding.reason)).toContain("stub");
            expect(observed.audit.deadAddresses.map((finding) => finding.reason)).not.toContain(
                "gm",
            );
            const target = supplied.index.notes.find((note) => note.rel === "Target.md");
            expect([...supplied.index.anchors.get(target)]).toContain("known");
            expect([...supplied.index.eventAnchorsOf.get(target)]).toContain("founding");
            expect(target.body).toContain("\r\n## Known {#known}\r\n");
            const guide = supplied.index.notes.find((note) => note.rel === "Guide.md");
            expect(guide.body.startsWith("\n\n😀")).toBe(true);
            expect(guide.body.endsWith("\n\n")).toBe(true);
            expect(guide.body).toContain("Missing]].\r\n");
            expect(guide.body).not.toBe(source.parsed.get(guide.file).body);
            expect(
                observed.diagnostics
                    .filter((finding) => finding.message.includes("#missing"))
                    .slice(0, 2),
            ).toMatchObject([
                { file: guide.file, line: 10, column: 10, severity: "error" },
                { file: guide.file, line: 10, column: 46, severity: "error" },
            ]);
        },
    );

    it("uses an empty captured raw string and falls back when an entry has no raw string", async () => {
        const source = await capture(fixture());
        const file = path.join(source.contentBase, "Guide.md");
        const withoutRaw = new Map(source.parsed);
        withoutRaw.set(file, { ...withoutRaw.get(file), raw: undefined });
        const fallback = measured(source, withoutRaw);
        expect(fallback.reads).toEqual([file]);
        expect(view(fallback.index)).toEqual(view(measured(source).index));

        const emptyRaw = new Map(source.parsed);
        emptyRaw.set(file, { ...emptyRaw.get(file), raw: "" });
        const supplied = measured(source, emptyRaw);
        expect(supplied.reads).toEqual([]);
        const guide = supplied.index.notes.find((note) => note.file === file);
        expect(guide.raw).toBe("");
        expect(guide.body).toBe("");
        expect(guide.fm.shortcode).toBe("guide");
    });

    it("keeps malformed and unindexed physical inputs in the independent charset/path walks", async () => {
        const source = await capture(fixture());
        const charset = lintContentCharset(source.contentBase, {
            skipDirectories: source.skipDirectories,
        });
        const paths = lintPathCharset({
            contentBase: source.contentBase,
            assetsBase: source.config.paths.assets,
            skipDirectories: source.skipDirectories,
        });
        const crlf = path.join(source.contentBase, "CrLf.md");
        expect(source.sources.has(crlf)).toBe(true);
        expect(source.parsed.get(crlf).frontmatter?.type).toBe("lore");
        expect(source.parsed.get(crlf).raw).toContain("\r\n");
        for (const rel of ["Malformed.md", "Untyped.md", "Bad.yaml", "Bad.json"]) {
            expect(
                charset.findings.some(
                    (finding) => path.resolve(finding.file) === path.join(source.contentBase, rel),
                ),
            ).toBe(true);
            expect(source.sources.has(path.join(source.contentBase, rel))).toBe(false);
        }
        expect(
            paths.findings.some(
                (finding) =>
                    path.resolve(finding.file) === path.join(source.contentBase, "Páth.txt"),
            ),
        ).toBe(true);
        expect(charset.findings.some((finding) => finding.file.includes("Skipped"))).toBe(false);
    });

    it("uses each fresh capture and keeps injected roots and configurations isolated", async () => {
        const repo = fixture(8, "first");
        const first = await capture(repo);
        const before = measured(first, first.parsed);
        const file = path.join(repo.contentBase, "Guide.md");
        write(file, repo.guide.replaceAll("lore-target#missing", "lore-target#known"));
        const next = await capture(repo);
        const second = measured(next, next.parsed);
        const other = await capture(fixture(8, "second"));
        const isolated = measured(other, other.parsed);

        expect(before.reads).toEqual([]);
        expect(second.reads).toEqual([]);
        expect(isolated.reads).toEqual([]);
        expect(diagnostics(second.index).length).toBe(diagnostics(before.index).length - 2);
        expect(view(second.index)).toEqual(view(measured(next).index));
        expect(view(isolated.index)).toEqual(view(measured(other).index));
        expect(first.parsed.get(file).raw).toBe(repo.guide);
        expect(next.parsed.get(file).raw).not.toBe(repo.guide);
        expect(before.index.contentPackage).toBe("first");
        expect(isolated.index.contentPackage).toBe("second");
        expect(
            isolated.index.notes.every((note) =>
                note.file.startsWith(other.contentBase + path.sep),
            ),
        ).toBe(true);
        expect(isolated.index.addressHit("first-note-lore-target")).toBeUndefined();
        expect(isolated.index.addressHit("second-note-lore-target")?.file).toBe(
            path.join(other.contentBase, "Target.md"),
        );
    });
});
