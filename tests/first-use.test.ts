/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
    FIRST_USE_CLOSE,
    FIRST_USE_OPEN,
    boldFirstUses,
    createFirstUseChecker,
    nameUses,
} from "../engine/first-use.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import {
    loadForeignIndexes,
    metadataCacheDir,
    metadataFileName,
    markComplete,
} from "../engine/metadata-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

function fixture(extra: object[] = []) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "name-marking-")));
    roots.push(root);
    write(path.join(root, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    const config = configFromData(
        {
            contentPackage: "test",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "namechecking0000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            relationships: {
                requires: [{ id: "pub", manifest: "https://example.invalid/module.json" }],
            },
        },
        path.join(root, "package-build.config.yaml"),
    );
    const entries = [
        { type: "place", shortcode: "arden", name: { full: "Arden Vale", en: ["Arden"] } },
        { type: "lore", shortcode: "warden", name: { full: "Warden" } },
        { type: "doc", shortcode: "reader", name: { full: "Reader" } },
        ...extra,
    ];
    for (const [n, entry] of entries.entries())
        write(
            path.join(config.paths.content, `${n}.md`),
            `---\n${YAML.stringify(entry)}---\n\nWritten prose.\n`,
        );
    const foreign = metadataCacheDir(config, "pub", "1.0.0");
    write(
        path.join(foreign, metadataFileName("pub")),
        JSON.stringify({
            package: "pub",
            type: "skill",
            shortcode: "craft",
            name: { full: "North Craft", en: ["Northern Craft"] },
            address: { canonical: "pub-sohl-skill-craft", slug: "skill-craft" },
            anchors: [
                { slug: "work", kind: "prose" },
                { slug: "founding", kind: "event" },
            ],
            data: { events: [{ id: "founding", when: "1", summary: "The guild is founded." }] },
            foundry: {
                sohl: { uuid: "Compendium.pub.skills.Item.craft" },
                note: { uuid: "Compendium.pub.journals.JournalEntry.craft" },
            },
        }) + "\n",
    );
    markComplete(foreign);
    const parsed = new Map();
    const records = indexRecordsFor({ contentBase: config.paths.content, config, parsed });
    const index = buildLinkIndex(config.paths.content, { config, records, parsed });
    const before = structuredClone({ records: encodeAddresses(records), parsed: [...parsed] });
    const checker = createFirstUseChecker({ records, index });
    return {
        config,
        records,
        parsed,
        index,
        before,
        check: (raw: string) => checker({ file: path.join(config.paths.content, "2.md"), raw }),
    };
}

const rules = (findings: ReturnType<ReturnType<typeof createFirstUseChecker>>) =>
    findings.flatMap((finding) => finding.rules);

const positions = (raw: string, value: string) => {
    const found = [];
    for (
        let start = raw.indexOf(value);
        start >= 0;
        start = raw.indexOf(value, start + value.length)
    ) {
        const prefix = raw.slice(0, start);
        found.push({ line: prefix.split("\n").length, column: start - prefix.lastIndexOf("\n") });
    }
    return found;
};

describe("a marked name that names an indexed note", () => {
    it("uses the body's resolved reference text inside an actual marked name", () => {
        const { check } = fixture();
        const raw = "[**Arden** [Vale][person]]{.name}\n\n[person]: https://example.invalid/vale";
        expect(renderFoundryMarkdown(raw)).toContain(
            '<strong>Arden</strong> <a href="https://example.invalid/vale">Vale</a>',
        );
        const findings = check(raw);
        expect(findings).toHaveLength(1);
        expect(findings[0].rules).toEqual(["unlinked-name"]);
        expect(findings[0].message).toContain("Arden Vale");
        expect(findings[0]).toMatchObject(positions(raw, "[**Arden**")[0]);
    });

    it("never searches plain prose or infers names from capitalization and emphasis", () => {
        const { check } = fixture([
            { type: "mysticalability", shortcode: "flame", name: { full: "Flame" } },
            { type: "lore", shortcode: "king", name: { full: "Konung Rank", en: ["King"] } },
        ]);
        expect(
            check(
                [
                    "Arden waits for Arden Vale. Warden waits. Flame burns. King reigns.",
                    "Black Flame and High King. Arden’s people and Wardens gather.",
                    "**Hidden Hand** and **Hidden Hand**. **hidden hand** and **hidden hand**.",
                    "**is part of the Hidden Hand**. **Arden Vale is quiet**.",
                    "- **Mechanics**: paid.\n- **Mechanics**: paid.",
                    "- **Strength**: physically capable, though not heavily muscled.",
                    "**[Arden Vale]{.wide}** and **[Arden Vale]**.",
                ].join("\n\n"),
            ),
        ).toEqual([]);
    });

    it("asks for a link or a ref for an indexed name or listed form", () => {
        const { check } = fixture();
        const found = check("[Arden]{.name} awaits [Arden Vale]{.name}.");
        expect(found.map((finding) => finding.rules)).toEqual([
            ["unlinked-name"],
            ["unlinked-name"],
        ]);
        expect(found[0].message).toContain("Arden Vale");
        expect(found[0].message).toContain("test-note-place-arden");
        expect(found[0].message).toContain("ref=");
        expect(found.every((finding) => finding.severity === "warning")).toBe(true);
    });

    it("leaves unindexed names, repeats and links alone", () => {
        const { check } = fixture();
        for (const raw of [
            "[hidden hand]{.name} and [Hidden Hand]{.name} and [Hidden Hands]{.name}.",
            "[Joe]{.name} before [Joe Blow]{.name}, then [Joe]{.name}.",
            "[[place-arden|Arden]] then [[place-arden|Arden Vale]] and [Arden](https://example.invalid).",
            "[Arden Vale](https://example.invalid){.name}",
            String.raw`\[Arden Vale]{.name} \[[place-arden|Arden]]`,
            "[Wardenship]{.name} [Ardenwood]{.name}",
        ])
            expect(check(raw), raw).toEqual([]);
    });

    it("reads the name class among other classes and attributes", () => {
        const { check } = fixture();
        expect(
            rules(check('[Arden Vale]{#person .wide .name lang="en" title="The vale"}')),
        ).toEqual(["unlinked-name"]);
        expect(check('[Arden Vale]{.named} [Arden Vale]{title="name"} [Arden Vale]')).toEqual([]);
        expect(rules(check("[Arden *Vale*]{.name}"))).toEqual(["unlinked-name"]);
    });

    it("reads a span inside a link as the link's, and a link label never as a name", () => {
        const { check } = fixture();
        const raw =
            "[ [Arden Vale]{.name}](https://example.invalid) then [Arden Vale](https://example.invalid).";
        expect(renderFoundryMarkdown(raw)).toMatch(/<span\b[^>]*>Arden Vale<\/span>/);
        expect(rules(check(raw))).toEqual(["unlinked-name"]);
        const literal =
            "[[Arden Vale]{.name}](https://example.invalid) then [Arden Vale](https://example.invalid).";
        expect(renderFoundryMarkdown(literal)).toContain(">[Arden Vale]{.name}</a>");
        expect(check(literal)).toEqual([]);
    });

    it("reads nested span text and entities without losing the explicit outer name", () => {
        const { check } = fixture([
            { type: "place", shortcode: "brackets", name: { full: "Arden [Vale]" } },
        ]);
        for (const raw of [
            "[Arden [Vale]{.wide}]{.name}",
            "[**Arden** Vale]{.name}",
            "[Arden&nbsp;Vale]{.name}",
            String.raw`[Arden \[Vale\]]{.name}`,
        ])
            expect(rules(check(raw))).toEqual(["unlinked-name"]);
    });

    it("recognizes whole indexed possessives and regular plurals", () => {
        const { check } = fixture();
        expect(rules(check("[Arden’s]{.name} and [Wardens]{.name}."))).toEqual([
            "unlinked-name",
            "unlinked-name",
        ]);
    });

    it("does not select an indexed identity from an ambiguous marked name", () => {
        const { check } = fixture([
            { type: "place", shortcode: "other", name: { full: "Arden Vale", en: ["Arden"] } },
        ]);
        const found = check("[Arden Vale]{.name}");
        expect(found).toHaveLength(1);
        expect(found[0].rules).toEqual(["unlinked-name"]);
        expect(found[0].message).toContain("test-note-place-arden");
        expect(found[0].message).toContain("test-note-place-other");
    });

    it("recognizes a fetched note's forms", () => {
        const { check, index } = fixture();
        const foreign = index.foreign.index.get("pub-note-skill-craft");
        expect(foreign.forms).toEqual({ en: ["Northern Craft"] });
        expect(foreign.uuid).toBe("Compendium.pub.journals.JournalEntry.craft");
        const found = check("[Northern Craft]{.name} before [[pub-note-skill-craft|North Craft]].");
        expect(rules(found)).toEqual(["unlinked-name"]);
        expect(found[0].message).toContain("pub-note-skill-craft");
    });

    it("keeps folder projections out of indexed names", () => {
        const source = fixture([{ type: "folder", shortcode: "great", name: { full: "Great" } }]);
        const folder = encodeAddresses(source.records.find((record) => record.type === "folder"));
        fs.appendFileSync(
            path.join(metadataCacheDir(source.config, "pub", "1.0.0"), metadataFileName("pub")),
            JSON.stringify({
                ...folder,
                package: "pub",
                address: { ...folder.address, canonical: "pub-none-folder-great" },
                foundry: {},
            }) + "\n",
        );
        const foreign = loadForeignIndexes(source.config, ["test"], { pub: "/pub/" });
        expect(foreign.index.has("pub-note-folder-great")).toBe(true);
        const index = buildLinkIndex(source.config.paths.content, {
            config: source.config,
            records: source.records,
            parsed: source.parsed,
            foreign,
        });
        const check = createFirstUseChecker({ records: source.records, index });
        expect(
            check({
                file: path.join(source.config.paths.content, "2.md"),
                raw: "[Great]{.name} and **Great**.",
            }),
        ).toEqual([]);
    });

    it("keeps corpus inputs immutable", () => {
        const source = fixture();
        const raw = "[Arden]{.name} then [Arden Vale]{.name}.";
        const first = source.check(raw);
        expect(first).toHaveLength(2);
        expect(source.check(raw)).toEqual(first);
        expect({ records: encodeAddresses(source.records), parsed: [...source.parsed] }).toEqual(
            source.before,
        );
    });
});

describe("source exclusions", () => {
    it("skips frontmatter, headings, tables, infoboxes, comments and inline literals", () => {
        const { check } = fixture();
        expect(
            check(
                [
                    "---",
                    'name: "[Arden]{.name}"',
                    "---",
                    "",
                    "# [Arden]{.name} and **[Arden]{.name}**",
                    "",
                    "| Name |",
                    "| --- |",
                    "| [Arden]{.name} **[Arden]{.name}** |",
                    "",
                    '<aside class="infobox wide">',
                    "",
                    "[Arden]{.name}",
                    "",
                    "**[Arden]{.name}**",
                    "",
                    "</aside>",
                    "",
                    "<!-- [Arden]{.name} **[Arden]{.name}** -->",
                    "",
                    "`[Arden]{.name}` {{ref '[[place-arden|Arden]]'}} ![[place-arden|Arden]]",
                    "",
                    "```md\n**[Arden]{.name}**\n```",
                ].join("\n"),
            ),
        ).toEqual([]);
    });

    it("excludes HTML attributes, comments and structural wrappers with quoted brackets", () => {
        const { check } = fixture();
        for (const quote of ['"', "'"]) {
            const opening = `<span title=${quote}gate > [Arden]{.name} [[place-arden|Arden]]${quote}>`;
            expect(check(`${opening}Written prose.</span>`)).toEqual([]);
            const raw = `${opening}[Arden Vale]{.name}</span>`;
            expect(check(raw)).toMatchObject([
                { line: 1, column: opening.length + 1, rules: ["unlinked-name"] },
            ]);
        }
        expect(rules(check('<!-- <aside class="infobox"> -->\n\n[Arden Vale]{.name}'))).toEqual([
            "unlinked-name",
        ]);
    });

    it("reports literal UTF-16 positions in CRLF lists and quotations", () => {
        const { check } = fixture();
        const raw =
            "---\r\nname: sample\r\n---\r\n\r\n- 😀 [Arden Vale]{.name}\r\n\r\n> **This has [Arden]{.name} inside.**";
        const found = check(raw);
        expect(found.map(({ line, column }) => ({ line, column }))).toEqual([
            ...positions(raw, "[Arden Vale]"),
            ...positions(raw, "[Arden]"),
        ]);
        expect(found.map((finding) => finding.rules)).toEqual([
            ["unlinked-name"],
            ["unlinked-name"],
        ]);
    });

    it("normalizes names for matching without shifting decomposed source positions", () => {
        const { check } = fixture([
            { type: "place", shortcode: "renee", name: { full: "Renée Vale" } },
        ]);
        const raw = "😀 [Renée Vale]{.name} and [Arden Vale]{.name}.";
        const found = check(raw);
        expect(found.map(({ line, column }) => ({ line, column }))).toEqual([
            ...positions(raw, "[Renée Vale]"),
            ...positions(raw, "[Arden Vale]"),
        ]);
        expect(found[0].message).toContain("test-note-place-renee");
    });
});

describe("a name span's ref", () => {
    it("ties a span to its note without a link warning, whatever its spelling", () => {
        const { check } = fixture();
        expect(check("[Vale]{.name ref=place-arden}")).toEqual([]);
        expect(check("[Arden Vale]{.name ref=place-arden}")).toEqual([]);
        expect(check("[North Craft]{.name ref=pub-sohl-skill-craft}")).toEqual([]);
        expect(rules(check("[Arden]{.name}"))).toContain("unlinked-name");
    });

    it("ties every spelling of a page-local subject without a finding", () => {
        const { check } = fixture();
        expect(
            check('[Jane Doe]{.name ref="#jane"} and [Miss Gorgeous]{.name ref="#jane"}'),
        ).toEqual([]);
    });
});

/** The keys of a body's uses, in order. */
const keys = (markdown: string, vocabulary?: object) =>
    nameUses(markdown, vocabulary as any).map((use) => use.key);

/** A body with its first-use marks written as `<<` and `>>`. */
const shown = (markdown: string, vocabulary?: object) =>
    boldFirstUses(markdown, vocabulary as any)
        .replaceAll(FIRST_USE_OPEN, "<<")
        .replaceAll(FIRST_USE_CLOSE, ">>");

const VOCABULARY = {
    types: new Set(["place", "skill", "being"]),
    packages: new Set(["test", "pub"]),
    noIndexPackages: new Set(),
    contentPackage: "test",
};

describe("the key of a name's use", () => {
    it("is a span's page-local ref, whatever the span says", () => {
        expect(
            keys(
                '[Jane Doe]{.name ref="#jane"}, [Jane]{.name ref="#jane"} and [Joan]{.name ref="#joan"}.',
            ),
        ).toEqual(["local:#jane", "local:#jane", "local:#joan"]);
    });

    it("is a note's address however it is spelt, from a span's ref or a name wikilink", () => {
        expect(
            keys(
                "[Vale]{.name ref=place-arden}, [Arden Vale]{.name ref=test-note-place-arden}, " +
                    "[[place-arden|the vale]]{.name}, [Craft]{.name ref=pub-sohl-skill-craft} and " +
                    "[[pub-note-skill-craft|North Craft]]{.name}.",
                VOCABULARY,
            ),
        ).toEqual([
            "note:test-place-arden",
            "note:test-place-arden",
            "note:test-place-arden",
            "note:pub-skill-craft",
            "note:pub-skill-craft",
        ]);
    });

    it("is the label, case folded, with its language", () => {
        expect(
            keys(
                "[Old Tam]{.name}, [old  tam]{.name}, [Old Tam]{.name lang=en} and [old tam]{.name lang=vyl}.",
            ),
        ).toEqual([
            "label:en:old tam",
            "label:en:old tam",
            "label:en:old tam",
            "label:vyl:old tam",
        ]);
    });

    it("leaves a wikilink without the name class out", () => {
        expect(keys("[[place-arden|Arden Vale]] and [[place-arden|Arden]]{.wide}.")).toEqual([]);
    });
});

describe("the first use of each key", () => {
    it("is marked once, at its first prose use", () => {
        expect(
            shown(
                '[Jane Doe]{.name ref="#jane"} keeps [[place-arden|the vale]]{.name}. [Jane]{.name ref="#jane"} rows. [Miss Gorgeous]{.name ref="#jane"} sings at [[place-arden|Arden]]{.name}.',
                VOCABULARY,
            ),
        ).toBe(
            '<<[Jane Doe]{.name ref="#jane"}>> keeps <<[[place-arden|the vale]]{.name}>>. [Jane]{.name ref="#jane"} rows. [Miss Gorgeous]{.name ref="#jane"} sings at [[place-arden|Arden]]{.name}.',
        );
    });

    it("is never in a heading, table, caption, run, raw HTML or code", () => {
        const body = [
            "# [Tam]{.name}",
            "",
            "| [Tam]{.name} |",
            "| --- |",
            "| [Tam]{.name} |",
            "",
            ": [Tam]{.name} counts the nets",
            "",
            "| Net |",
            "| --- |",
            "| one |",
            "",
            ':::info {title="Nets"}',
            "Inside the block, [Ada]{.name} works.",
            ":::",
            "",
            "::: {lang=vyl}",
            "[Tam]{.name} wa",
            ":::",
            "",
            "[wa [Tam]{.name} wa]{lang=vyl}",
            "",
            "<div>[Tam]{.name}</div>",
            "",
            "`[Tam]{.name}`",
            "",
            "```\n[Tam]{.name}\n```",
            "",
            "Then [Tam]{.name} speaks, and [Tam]{.name} again.",
        ].join("\n");
        expect(nameUses(body).map((use) => body.slice(use.start, use.end))).toEqual([
            "[Ada]{.name}",
            "[Tam]{.name}",
            "[Tam]{.name}",
        ]);
        expect(shown(body)).toContain("Then <<[Tam]{.name}>> speaks, and [Tam]{.name} again.");
        expect(shown(body)).toContain("Inside the block, <<[Ada]{.name}>> works.");
    });

    it("counts a name a run states the language of, as its own span", () => {
        expect(shown("[juan]{.name lang=vyl} and [juan]{.name lang=vyl}")).toBe(
            "<<[juan]{.name lang=vyl}>> and [juan]{.name lang=vyl}",
        );
    });

    it("counts inside authored strong text without a second bold", () => {
        expect(shown("**A phrase with [Joe Blow]{.name} in it** then [Joe Blow]{.name}.")).toBe(
            "**A phrase with [Joe Blow]{.name} in it** then [Joe Blow]{.name}.",
        );
    });

    it("counts a name wrapped exactly in authored bold without a second bold", () => {
        expect(shown("**[Joe Blow]{.name}** then [Joe Blow]{.name}.")).toBe(
            "**[Joe Blow]{.name}** then [Joe Blow]{.name}.",
        );
        expect(
            shown("**[[place-arden|the vale]]{.name}** then [[place-arden|the vale]]{.name}."),
        ).toBe("**[[place-arden|the vale]]{.name}** then [[place-arden|the vale]]{.name}.");
    });

    it("counts in lists, quotations and footnotes, in source order", () => {
        expect(
            shown("- [Tam]{.name} rows\n\n> [Tam]{.name} sings.[^1]\n\n[^1]: [Ada]{.name} too."),
        ).toBe(
            "- <<[Tam]{.name}>> rows\n\n> [Tam]{.name} sings.[^1]\n\n[^1]: <<[Ada]{.name}>> too.",
        );
    });

    it("leaves a body with no name untouched", () => {
        const body = "Plain prose, **bold**, and [a span]{.wide}.";
        expect(boldFirstUses(body)).toBe(body);
    });
});

describe("the first-use marks", () => {
    it("render as strong text on every HTML target and in the book's tokens", () => {
        const marked = boldFirstUses("[Tam]{.name} rows, and [Tam]{.name} sings.");
        for (const target of ["foundry", "preview"] as const)
            expect(createRenderer(target).render(marked)).toBe(
                '<p><strong><span class="name">Tam</span></strong> rows, and <span class="name">Tam</span> sings.</p>\n',
            );
        expect(createRenderer("web").render(marked)).toContain(
            '<strong><span class="name">Tam</span></strong> rows',
        );
        const types = createRenderer("book")
            .md.parse(marked, {})[1]
            .children.map((token: any) => token.type);
        expect(types.slice(0, 4)).toEqual(["strong_open", "span_open", "text", "span_close"]);
        expect(types[4]).toBe("strong_close");
    });

    it("never reach a reader outside inline text", () => {
        const stray = `${FIRST_USE_OPEN}<div>raw</div>${FIRST_USE_CLOSE}\n\n\`${FIRST_USE_OPEN}code${FIRST_USE_CLOSE}\``;
        const html = createRenderer("foundry").render(stray);
        expect(html).not.toMatch(/[﷐﷑]/);
        expect(html).toContain("<code>code</code>");
    });
});

describe("verse regions do not advance prose first use", () => {
    it("excludes both verse div spellings while retaining the later prose name", () => {
        for (const verse of [
            "::: {.verse}\n[Tam]{.name}/returns\n:::",
            ":::verse\n[Tam]{.name}/returns\n:::",
        ]) {
            const source = verse + "\n\n[Tam]{.name} keeps watch.";
            expect(nameUses(source).map((use) => use.start)).toEqual([source.lastIndexOf("[Tam]")]);
            expect(shown(source)).toBe(verse + "\n\n<<[Tam]{.name}>> keeps watch.");
        }
    });
    it("keeps literal block markers in verse from swallowing later prose", () => {
        const verse = "::: {.verse}\n```\n[Tam]{.name}\n:::";
        expect(shown(verse + "\n\n[Tam]{.name} keeps watch.")).toBe(
            verse + "\n\n<<[Tam]{.name}>> keeps watch.",
        );
    });
    it("excludes quoted verse inside prose including nested names and name links", () => {
        const source =
            "Before [The [Tam]{.name} comes/returns]{.verse}, then [Tam]{.name} keeps watch.";
        expect(shown(source)).toBe(
            "Before [The [Tam]{.name} comes/returns]{.verse}, then <<[Tam]{.name}>> keeps watch.",
        );
        const linked =
            "[The [[being-tam|Tam]]{.name} comes/returns]{.verse}, then [Tam]{.name ref=being-tam}.";
        expect(nameUses(linked)).toHaveLength(1);
        expect(shown(linked)).toContain("then <<[Tam]{.name ref=being-tam}>>.");
    });
    it("does not lint a marked name inside a verse as an unlinked prose name", () => {
        const source = fixture();
        expect(source.check("::: {.verse}\n[Arden Vale]{.name}\n:::\n")).toEqual([]);
        expect(source.check("[The [Arden Vale]{.name} returns]{.verse}")).toEqual([]);
    });
});
