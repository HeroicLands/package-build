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
import { createFirstUseChecker } from "../engine/first-use.mjs";
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
        { type: "place", shortcode: "arden", name: { full: "Arden Vale", aliases: ["Arden"] } },
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
            name: { full: "North Craft", aliases: ["Northern Craft"] },
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

describe("explicit name occurrences", () => {
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
            { type: "lore", shortcode: "king", name: { full: "Konung Rank", aliases: ["King"] } },
        ]);
        expect(
            check(
                [
                    "Arden waits for Arden Vale. Warden waits. Flame burns. King reigns.",
                    "Black Flame and High King. Arden’s people and Wardens gather.",
                    "**Hidden Hand** and **Hidden Hand**. **hidden hand** and **hidden hand**.",
                    "**is part of the Hidden Hand**. **Arden Vale is quiet**.",
                    "- **Mechanics**: paid.\n- **Mechanics**: paid.",
                ].join("\n\n"),
            ),
        ).toEqual([]);
    });

    it("treats bold that matches an indexed name as emphasis", () => {
        const { check } = fixture([
            { type: "lore", shortcode: "strength", name: { full: "Strength" } },
            { type: "place", shortcode: "olives", name: { full: "Olives" } },
        ]);
        expect(
            check(
                [
                    "**Arden Vale** and **Arden** and __Warden__ and **Arden Vale**.",
                    "- **Strength**: physically capable, though not heavily muscled.",
                    "- **Olives** on the lower slopes, for local use rather than export.",
                    "**[Arden Vale]{.wide}** and **[Arden Vale]**.",
                ].join("\n\n"),
            ),
        ).toEqual([]);
        expect(rules(check("**Arden Vale**. [Arden]{.name}"))).toEqual([
            "unlinked-name",
            "short-before-full",
        ]);
    });

    it("requires indexed marked names and aliases to link instead", () => {
        const { check } = fixture();
        const found = check("[Arden]{.name} awaits [Arden Vale]{.name}.");
        expect(found.map((finding) => finding.rules)).toEqual([
            ["unlinked-name", "short-before-full"],
            ["unlinked-name", "repeated-name"],
        ]);
        expect(found[0].message).toContain("Arden Vale");
        expect(found[0].message).toContain("test-note-place-arden");
        expect(found.every((finding) => finding.severity === "warning")).toBe(true);
    });

    it("uses explicit unindexed names regardless of capitalization", () => {
        const { check } = fixture();
        expect(check("[hidden hand]{.name}")).toEqual([]);
        expect(rules(check("[hidden hand]{.name} and [hidden hand]{.name}."))).toEqual([
            "repeated-name",
        ]);
        expect(
            rules(
                check("[Hidden Hand]{.name} and [Hidden Hands]{.name} and [Hidden Hand’s]{.name}."),
            ),
        ).toEqual(["repeated-name", "repeated-name"]);
    });

    it("shares repetition state across marked names, links and aliases", () => {
        const { check } = fixture();
        for (const raw of [
            "[Arden Vale]{.name} then [[place-arden|Arden]].",
            "[[place-arden|Arden Vale]] then [Arden]{.name}.",
            "[Arden Vale](https://example.invalid) then [[place-arden|Arden]].",
        ]) {
            const found = check(raw);
            expect(found.at(-1).rules).toContain("repeated-name");
            expect(found.at(-1).rules).not.toContain("short-before-full");
        }
        expect(
            rules(check("[Ravenmoor]{.name} then [Ravenmoor](https://example.invalid).")),
        ).toEqual(["repeated-name"]);
    });

    it("tracks authored Markdown and reference labels as well as wikilinks", () => {
        const { check } = fixture();
        const found = check(
            [
                "[Arden](https://example.invalid) then [Arden Vale][vale] and [[place-arden|Arden Vale]].",
                "",
                "[vale]: https://example.invalid/vale",
            ].join("\n"),
        );
        expect(found.map((finding) => finding.rules)).toEqual([
            ["short-before-full"],
            ["repeated-name"],
            ["repeated-name"],
        ]);
        expect(
            rules(
                check(
                    "[Arden Vale][] and [Arden Vale][].\n\n[Arden Vale]: https://example.invalid",
                ),
            ),
        ).toEqual(["repeated-name"]);
    });

    it("counts names across heading destinations while keeping distinct heading labels independent", () => {
        const { check } = fixture();
        expect(
            rules(check("[[place-arden#east|Arden Vale]] then [[place-arden#west|Arden Vale]].")),
        ).toEqual(["repeated-name"]);
        expect(
            check("[[place-arden#east|Eastern gate]] then [[place-arden#west|Western gate]]."),
        ).toEqual([]);
        expect(
            rules(check("[[place-arden#east|Eastern gate]] then [[lore-warden|Eastern gate]].")),
        ).toEqual(["repeated-name"]);
    });

    it("does not invent aliases from arbitrary link labels", () => {
        const { check } = fixture();
        expect(
            check("[[place-arden|the vale]] then [Elsewhere](https://example.invalid)."),
        ).toEqual([]);
        expect(rules(check("[[place-arden|the vale]] then [[place-arden|the vale]]."))).toEqual([
            "repeated-name",
        ]);
        expect(rules(check("[[place-arden|]] then [[place-arden|Arden]]."))).toEqual([
            "repeated-name",
        ]);
        expect(check("[[place-arden]] [[place-missing|]]")).toEqual([]);
    });

    it("extracts a marked name inside bold and other inline emphasis", () => {
        const { check } = fixture();
        expect(
            rules(
                check("**This is a phrase with [Joe Blow]{.name} in it** then [Joe Blow]{.name}."),
            ),
        ).toEqual(["repeated-name"]);
        for (const raw of [
            "**[Arden Vale]{.name}**",
            "[**Arden Vale**]{.name}",
            "*[Arden **Vale**]{.name}*",
            "**[[place-arden|Arden Vale]]**",
            "**[Arden Vale](https://example.invalid)**",
        ]) {
            const found = check(raw);
            expect(rules(found)).toEqual(raw.includes("{.name}") ? ["unlinked-name"] : []);
        }
    });

    it("uses the shared parsed name class among multiple classes and attributes", () => {
        const { check } = fixture();
        expect(
            rules(check('[Arden Vale]{#person .wide .name lang="en" title="The vale"}')),
        ).toEqual(["unlinked-name"]);
        expect(check('[Arden Vale]{.named} [Arden Vale]{title="name"} [Arden Vale]')).toEqual([]);
        expect(rules(check("[Arden *Vale*]{.name}"))).toEqual(["unlinked-name"]);
    });

    it("distinguishes shared spans from actual authored links", () => {
        const { check } = fixture();
        for (const attributes of [".name", '.wide lang="en"', ""]) {
            const marked = attributes ? `[Arden Vale]{${attributes}}` : "[Arden Vale]";
            const raw = `[ ${marked}](https://example.invalid) then [Arden Vale](https://example.invalid).`;
            expect(renderFoundryMarkdown(raw)).toMatch(/<span\b[^>]*>Arden Vale<\/span>/);
            expect(renderFoundryMarkdown(raw).match(/<a /g) ?? []).toHaveLength(1);
            expect(rules(check(raw))).toEqual(
                attributes === ".name" ? ["unlinked-name", "repeated-name"] : [],
            );
        }
        const reference =
            "[ [Arden Vale]{.wide}][target] then [Arden Vale](https://example.invalid).\n\n[target]: https://example.invalid";
        expect(renderFoundryMarkdown(reference)).toContain('<span class="wide">Arden Vale</span>');
        expect(renderFoundryMarkdown(reference).match(/<a /g) ?? []).toHaveLength(2);
        expect(renderFoundryMarkdown(reference)).toContain(
            ']<a href="https://example.invalid">target</a>',
        );
        expect(check(reference)).toEqual([]);
        const formattedReference =
            "[**Arden Vale**][target] then [Arden Vale](https://example.invalid).\n\n[target]: https://example.invalid";
        expect(renderFoundryMarkdown(formattedReference)).toContain(
            "<strong>Arden Vale</strong></a>",
        );
        expect(rules(check(formattedReference))).toEqual(["repeated-name"]);
        const literal =
            "[[Arden Vale]{.name}](https://example.invalid) then [Arden Vale](https://example.invalid).";
        expect(renderFoundryMarkdown(literal)).toContain(">[Arden Vale]{.name}</a>");
        expect(check(literal)).toEqual([]);
    });

    it("decodes authored label escapes once instead of turning literal stars into emphasis", () => {
        const { check } = fixture();
        const raw = String.raw`[\*Arden Vale\*](https://example.invalid) then [Arden Vale](https://example.invalid).`;
        expect(renderFoundryMarkdown(raw)).toContain(">*Arden Vale*</a>");
        expect(check(raw)).toEqual([]);
    });

    it("keeps actual inner reference labels and their original CRLF and nested-span offsets", () => {
        const { check } = fixture();
        for (const raw of [
            "- 😀 [ [Arden Vale]{.wide}][target]\r\n\r\n> [target](https://example.invalid)\r\n\r\n[target]: https://example.invalid",
            "[target](https://example.invalid)\r\n\r\n[ [Arden\r\nVale]{.wide}][target]\r\n\r\n[target]: https://example.invalid",
            "[target](https://example.invalid)\r\n\r\n[Outer [inner [target](https://example.invalid)]{.wide}]{.wide}",
        ]) {
            expect(renderFoundryMarkdown(raw).match(/>target<\/a>/g) ?? []).toHaveLength(2);
            const found = check(raw);
            expect(rules(found)).toEqual(["repeated-name"]);
            expect(found.map(({ line, column }) => ({ line, column }))).toEqual([
                positions(raw, "[target]")[1],
            ]);
        }
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

    it("gives links priority over span syntax and ignores escaped syntax and literal code", () => {
        const { check } = fixture();
        expect(check("[Arden Vale](https://example.invalid){.name}")).toEqual([]);
        expect(check(String.raw`\[Arden Vale]{.name} \[[place-arden|Arden]]`)).toEqual([]);
        expect(
            check(
                "`[Arden]{.name}` `[[place-arden|Arden]]`\n\n```md\n[Arden]{.name}\n[[place-arden|Arden]]\n```",
            ),
        ).toEqual([]);
        expect(
            check(
                "![Arden](image.png) ![[place-arden|Arden]] <https://example.invalid> https://example.invalid [^Arden]\n\n[^Arden]: Written prose.",
            ),
        ).toEqual([]);
    });

    it("lets a resolved wikilink introduce its note under any label", () => {
        const { check } = fixture();
        expect(check("[[place-arden|Arden]] lies east.")).toEqual([]);
        expect(check("[[place-arden|the vale]] lies east.")).toEqual([]);
        expect(check("[[lore-warden|Arden]] keeps the gate.")).toEqual([]);
        expect(rules(check("[[place-arden|Arden]] then [[place-arden|Arden Vale]]."))).toEqual([
            "repeated-name",
        ]);
        expect(rules(check("[Arden](https://example.invalid) lies east."))).toEqual([
            "short-before-full",
        ]);
    });

    it("keeps declared aliases attached to their indexed names", () => {
        const { check } = fixture([
            {
                type: "lore",
                shortcode: "watch",
                name: { full: "Hidden Watch", aliases: ["Hidden"] },
            },
        ]);
        const found = check("[Hidden]{.name} before [Hidden Hand]{.name}.");
        expect(found).toHaveLength(1);
        expect(found[0].rules).toEqual(["unlinked-name", "short-before-full"]);
        expect(found[0].message).toContain("Hidden Watch");
        expect(found[0].message).not.toContain("Hidden Hand");
    });

    it("keeps unknown marked names independent instead of inferring a first-word alias", () => {
        const { check } = fixture();
        expect(check("[Joe]{.name} before [Joe Blow]{.name}.")).toEqual([]);
        expect(check("[Joe](https://example.invalid) before [Joe Blow]{.name}.")).toEqual([]);
        expect(rules(check("[Joe]{.name}, [Joe Blow]{.name}, then [Joe]{.name}."))).toEqual([
            "repeated-name",
        ]);
    });

    it("recognizes whole indexed possessives and regular plurals without matching prefixes", () => {
        const { check } = fixture();
        expect(rules(check("[Arden’s]{.name} before [[place-arden|Arden Vale]]."))).toEqual([
            "unlinked-name",
            "short-before-full",
            "repeated-name",
        ]);
        expect(rules(check("[Wardens]{.name} then [Warden’s](https://example.invalid)."))).toEqual([
            "unlinked-name",
            "repeated-name",
        ]);
        expect(check("[Wardenship]{.name} [Ardenwood]{.name}")).toEqual([]);
    });
});

describe("source exclusions and canonical identities", () => {
    it("skips frontmatter, headings, tables, infoboxes, comments and inline literals", () => {
        const { check } = fixture();
        expect(
            check(
                [
                    "---",
                    'name: "[Arden]{.name}"',
                    "---",
                    "",
                    "# [Arden]{.name} and **Arden Vale**",
                    "",
                    "| Name |",
                    "| --- |",
                    "| [Arden]{.name} [[place-arden|Arden]] |",
                    "",
                    '<aside class="infobox wide">',
                    "",
                    "[Arden]{.name}",
                    "",
                    "[[place-arden|Arden]]",
                    "",
                    "**Arden Vale**",
                    "",
                    "</aside>",
                    "",
                    "<!-- [Arden]{.name} [[place-arden|Arden]] **Arden Vale** -->",
                    "",
                    "{{ref '[[place-arden|Arden]]'}} ![[place-arden|Arden]]",
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
        expect(
            check(
                "<h2>[[place-arden|Arden]]</h2>\n<table><tr><td>[[place-arden|Arden]]</td></tr></table>\n<pre>[[place-arden|Arden]]</pre>",
            ),
        ).toEqual([]);
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
            ["unlinked-name", "repeated-name"],
        ]);
    });

    it("normalizes names for matching without shifting decomposed source positions", () => {
        const { check } = fixture([
            { type: "place", shortcode: "renee", name: { full: "Renée Vale" } },
        ]);
        const raw = "😀 [Rene\u0301e Vale]{.name} and [Arden Vale]{.name}.";
        const found = check(raw);
        expect(found.map(({ line, column }) => ({ line, column }))).toEqual([
            ...positions(raw, "[Rene\u0301e Vale]"),
            ...positions(raw, "[Arden Vale]"),
        ]);
        expect(found[0].message).toContain("test-note-place-renee");
    });

    it("does not select an indexed identity from an ambiguous marked name", () => {
        const { check } = fixture([
            { type: "place", shortcode: "other", name: { full: "Arden Vale", aliases: ["Arden"] } },
        ]);
        const found = check("[Arden Vale]{.name}");
        expect(found).toHaveLength(1);
        expect(found[0].rules).toEqual(["unlinked-name"]);
        expect(found[0].message).toContain("test-note-place-arden");
        expect(found[0].message).toContain("test-note-place-other");
        expect(check("[[place-arden|Arden Vale]] then [[place-other|Arden Vale]].")).toEqual([]);
    });

    it("uses canonical foreign NOTE identity rather than projected object identity", () => {
        const { check, index } = fixture();
        expect(index.foreign.index.get("pub-sohl-skill-craft")).not.toBe(
            index.foreign.index.get("pub-note-skill-craft"),
        );
        expect(
            rules(
                check(
                    "[[pub-sohl-skill-craft|Northern Craft]] then [[pub-note-skill-craft|North Craft]].",
                ),
            ),
        ).toEqual(["repeated-name"]);
        expect(
            rules(check("[North Craft]{.name} then [[pub-sohl-skill-craft|North Craft]].")),
        ).toEqual(["unlinked-name", "repeated-name"]);
    });

    it("retains fetched aliases and accurate prose/event/native metadata", () => {
        const { check, index } = fixture();
        const foreign = index.foreign.index.get("pub-note-skill-craft");
        expect(foreign.aliases).toEqual(["Northern Craft"]);
        expect(foreign.noteAnchors).toEqual([
            expect.objectContaining({ slug: "work", kind: "prose" }),
            expect.objectContaining({ slug: "founding", kind: "event" }),
        ]);
        expect(foreign.events).toEqual([
            expect.objectContaining({
                id: "founding",
                entry: expect.objectContaining({ summary: "The guild is founded." }),
            }),
        ]);
        expect(foreign.uuid).toBe("Compendium.pub.journals.JournalEntry.craft");
        expect(
            rules(check("[Northern Craft]{.name} before [[pub-note-skill-craft|North Craft]].")),
        ).toEqual(["unlinked-name", "short-before-full", "repeated-name"]);
    });

    it("keeps folder projections out of indexed-name introductions", () => {
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

    it("keeps corpus inputs immutable and resets all use state for each note", () => {
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
