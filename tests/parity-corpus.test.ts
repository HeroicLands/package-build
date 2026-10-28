/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **The parity corpus.** One note holds every construct the renderers handle,
 * and every target — the Foundry packs, the editor preview, the website and the
 * book — renders it. Each construct states, per target, what a reader must see.
 *
 * `tests/fixtures/parity/` is the corpus and the notes it links to;
 * `tests/helpers/parity-expectations.ts` is the table of expectations, and
 * `tests/helpers/parity.ts` renders the corpus for each target. The book is
 * read as Typst source and never compiled.
 *
 * **What fails this test:**
 *
 * - A construct with no stated rendering for some target.
 * - A target whose rendering stops matching its expectation.
 * - A construct whose text is missing from the corpus.
 * - A construct a renderer's own source handles that the corpus does not
 *   exercise. The vocabularies are read from the renderers' modules: the alert
 *   types, the named blocks, the figure kinds, the verse attributes, the run
 *   keys and generic fonts, the expression helpers. Every markdown-it rule a
 *   renderer registers, and every token rule it renders, must run while the
 *   corpus renders; a rule the table does not map to a construct fails.
 *
 * **Where the renderers disagree** the expectation records what the target
 * shows today, and its `differs` text says how it departs. A disagreement is a
 * statement of the present, not an endorsement.
 *
 * The thalorna site and book snapshots that later changes must match are
 * recorded by `tests/snapshots/regenerate.mjs`; `tests/content-snapshot.test.ts`
 * holds them to their shape.
 */

import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";
import YAML from "yaml";

import { ALERT_TYPES, scanAlerts } from "../engine/content-alerts.mjs";
import { BLOCK_CONTAINERS, BLOCK_NAMES, scanBlocks } from "../engine/content-blocks.mjs";
import { FIGURE_NAMES, scanFigures } from "../engine/content-figures.mjs";
import {
    CARTOUCHE_ALIGNS,
    CARTOUCHE_KEYS,
    GLYPH_FRAMES,
    GLYPH_KEYS,
    GLYPH_SIZES,
} from "../engine/content-glyphs.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
import { GENERIC_FONTS, RUN_KEYS, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { VERSE_KEYS, scanVerse } from "../engine/content-verse.mjs";
import { SCROLL_KEYS, scanScrolls } from "../engine/content-scroll.mjs";
import { EXPRESSION_HELPERS } from "../engine/markdown-expressions.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { createParser, markdownToTypst } from "../engine/pdf-render.mjs";
import { renderPreview } from "../engine/site-preview.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

import {
    CONSTRUCTS,
    RENDERINGS,
    TARGETS,
    type Expectation,
    type Rendering,
    type Subject,
} from "./helpers/parity-expectations";
import {
    bodyOf,
    buildParity,
    fixtureConfig,
    noteRecords,
    previewIndexFor,
    type Built,
} from "./helpers/parity";
import { encodeText, decodeText } from "../engine/encoding.mjs";

let built: Built;

beforeAll(async () => {
    built = await buildParity();
}, 240_000);

afterAll(() => {
    if (built) fs.rmSync(built.root, { recursive: true, force: true });
});

/** What a rendering produced, or nothing when it could not run. */
function rendered(rendering: Rendering, subject: Subject): string | undefined {
    const output = built[rendering];
    return output ? output[subject] : undefined;
}

/**
 * What a rendering must show for a construct. The preview with an index reads
 * as the buffer-only preview does unless the construct states otherwise.
 */
function expected(id: string, rendering: Rendering): Expectation {
    const construct = CONSTRUCTS[id];
    return rendering === "indexed" ?
            (construct.indexed ?? construct.preview)
        :   construct[rendering];
}

/** The ids of the constructs, for table-driven cases. */
const IDS = Object.keys(CONSTRUCTS);

describe("every construct states what each target shows", () => {
    it("names at least one construct", () => {
        expect(IDS.length).toBeGreaterThan(0);
    });

    it.each(IDS)("%s has a stated rendering for every target", (id) => {
        const construct = CONSTRUCTS[id];
        expect(construct.summary, `${id}: no summary`).toBeTruthy();
        expect(construct.probe, `${id}: no probe`).toBeTruthy();
        for (const target of TARGETS) {
            const expectation = construct[target] as Expectation | undefined;
            expect(expectation, `${id}: no rendering stated for ${target}`).toBeTruthy();
            expect(
                expectation?.sees?.length ?? 0,
                `${id}: ${target} states nothing a reader must see`,
            ).toBeGreaterThan(0);
        }
    });

    it("says how a target differs wherever it records a difference", () => {
        for (const id of IDS)
            for (const rendering of RENDERINGS) {
                const { differs } = expected(id, rendering);
                if (differs !== undefined)
                    expect(differs.trim().length, `${id}/${rendering}`).toBeGreaterThan(20);
            }
    });

    it.each(IDS)(
        "%s states the indexed preview wherever the buffer-only preview cannot resolve it",
        (id) => {
            const construct = CONSTRUCTS[id];
            if (construct.preview.bufferOnly)
                expect(
                    construct.indexed?.sees?.length ?? 0,
                    `${id}: the buffer-only preview shows source, so the indexed preview must state what it shows`,
                ).toBeGreaterThan(0);
        },
    );
});

describe("the corpus holds every construct", () => {
    it.each(IDS)("%s is in the corpus note", (id) => {
        const note = {
            corpus: built.corpusSource,
            lost: built.lostSource,
            worded: built.wordedSource,
            fenced: built.fencedSource,
            unrolled: built.unrolledSource,
            named: built.namedSource,
        }[CONSTRUCTS[id].probeIn ?? "corpus"];
        expect(note, `${id}: probe missing from the corpus`).toContain(CONSTRUCTS[id].probe);
    });
});

describe.each(RENDERINGS)("the %s rendering", (rendering) => {
    it.each(IDS)("shows what a reader must see for %s", (id) => {
        const expectation = expected(id, rendering);
        const subject = expectation.of ?? "corpus";
        const output = rendered(rendering, subject) ?? "";
        expect(output.length, `${rendering} produced no ${subject} output`).toBeGreaterThan(0);
        for (const pattern of expectation.sees)
            expect(output, `${rendering}: ${id} must show ${pattern}`).toMatch(pattern);
        for (const pattern of expectation.absent ?? [])
            expect(output, `${rendering}: ${id} must not show ${pattern}`).not.toMatch(pattern);
    });
});

/**
 * The bold each key of the named note takes, as a target writes it: the
 * subject tied by `ref="#jane"` under three forms, the one keyed by its label
 * alone in two cases, and the wikilinked harbor. The book keeps no `ref`, so
 * its pattern names the forms.
 */
const FIRST_USES: Record<"foundry" | "web" | "indexed" | "book", Record<string, RegExp>> = {
    foundry: {
        jane: /<strong><span class="name" ref="#jane">([^<]*)<\/span><\/strong>/g,
        tam: /<strong><span class="name">((?:Old|old) Tam)<\/span><\/strong>/gi,
        harbor: /<strong><span class="name">@UUID\[[^\]]*\]\{(the harbor)\}<\/span><\/strong>/g,
    },
    web: {
        jane: /<strong><span class="name" ref="#jane">([^<]*)<\/span><\/strong>/g,
        tam: /<strong><span class="name">((?:Old|old) Tam)<\/span><\/strong>/gi,
        harbor: /<strong><span class="name"><a href="[^"]*place-harbor\/">(the harbor)<\/a><\/span><\/strong>/g,
    },
    indexed: {
        jane: /<strong><span class="name" ref="#jane">([^<]*)<\/span><\/strong>/g,
        tam: /<strong><span class="name">((?:Old|old) Tam)<\/span><\/strong>/gi,
        harbor: /<strong><span class="name"><a href="[^"]*place-harbor\/">(the harbor)<\/a><\/span><\/strong>/g,
    },
    book: {
        jane: /#strong\[#book-span\(classes: \("name",\)\)\[(Jane Doe|Jane|Miss Gorgeous)\]\]/g,
        tam: /#strong\[#book-span\(classes: \("name",\)\)\[((?:Old|old) Tam)\]\]/g,
        harbor: /#strong\[#book-span\(classes: \("name",\)\)\[#link\(<place-harbor>\)\[(the harbor)\]/g,
    },
};

/** The form each key's first prose use is written in. */
const FIRST_FORMS: Record<string, string> = {
    jane: "Jane Doe",
    tam: "Old Tam",
    harbor: "the harbor",
};

/** An HTML rendering without its headings and tables, which take no bold. */
const proseOf = (html: string) =>
    html.replace(/<h([1-6])\b[\s\S]*?<\/h\1>/g, "").replace(/<table\b[\s\S]*?<\/table>/g, "");

describe("a compiled page name", () => {
    it("uses the visible text of the named heading", () => {
        expect(built.foundry.named).toContain('<!-- page "Jane Doe and Old Tam" type=text');
    });

    it("uses the visible text of spans, authored wikilinks and emphasis at each page-opening level", () => {
        const dir = path.join(built.root, "build", "packs-json", "journals");
        const file = fs.readdirSync(dir).find((name) => name.startsWith("Heading_Names_"));
        expect(file, "the heading fixture compiled to a journal").toBeTruthy();
        const entry = JSON.parse(fs.readFileSync(path.join(dir, file!), "utf8"));
        const authored = entry.pages.slice(0, 2);
        expect(authored.map((page: any) => page.name)).toEqual([
            "The ferryman at the harbor",
            "A boat for the harbor",
        ]);
        expect(authored.map((page: any) => page.title.level)).toEqual([1, 2]);
    });
});

describe("a name's first use in a page is bold", () => {
    it.each(Object.keys(FIRST_USES) as Array<keyof typeof FIRST_USES>)(
        "%s bolds each key exactly once, in prose, at its first prose use",
        (rendering) => {
            const output = rendered(rendering, "named") ?? "";
            expect(output.length, `${rendering} produced no named output`).toBeGreaterThan(0);
            const prose = rendering === "book" ? output : proseOf(output);
            for (const [key, pattern] of Object.entries(FIRST_USES[rendering])) {
                const everywhere = [...output.matchAll(pattern)].map((match) => match[1]);
                const inProse = [...prose.matchAll(pattern)].map((match) => match[1]);
                expect(everywhere, `${rendering}: ${key} is bolded once`).toEqual([
                    FIRST_FORMS[key],
                ]);
                expect(inProse, `${rendering}: ${key} is bolded in prose`).toEqual([
                    FIRST_FORMS[key],
                ]);
            }
            const strong = rendering === "book" ? /#strong\[/g : /<strong>/g;
            expect(
                output.match(strong) ?? [],
                `${rendering}: nothing but the three first uses is bold`,
            ).toHaveLength(3);
        },
    );
});

describe("the corpus exercises every vocabulary the renderers read", () => {
    const body = () => built.corpusBody;

    it("uses every alert type", () => {
        const used = new Set(scanAlerts(body()).blocks.map((alert: any) => alert.type));
        for (const type of Object.keys(ALERT_TYPES)) {
            expect(used.has(type), `no [!${type.toUpperCase()}] alert in the corpus`).toBe(true);
            expect(CONSTRUCTS[`alert-${type}`], `no construct alert-${type}`).toBeTruthy();
        }
    });

    it("uses every named block and the general div", () => {
        const used = new Set(scanBlocks(body()).blocks.map((block: any) => block.name));
        for (const name of new Set([...Object.keys(BLOCK_NAMES), ...BLOCK_CONTAINERS])) {
            expect(used.has(name), `no :::${name} block in the corpus`).toBe(true);
            expect(CONSTRUCTS[`${name}-block`], `no construct ${name}-block`).toBeTruthy();
        }
    });

    it("draws a glyph in every frame and size, and a cartouche on every side", () => {
        const glyphs = scanSpans(body()).spans.filter((span: any) =>
            span.attrs.some(([key, value]: string[]) => key === "class" && value === "glyph"),
        );
        const values = (key: string) =>
            new Set(
                glyphs.flatMap((span: any) =>
                    span.attrs
                        .filter(([name]: string[]) => name === key)
                        .map(([, v]: string[]) => v),
                ),
            );
        for (const frame of GLYPH_FRAMES)
            expect(values("frame").has(frame), `no glyph states frame=${frame}`).toBe(true);
        for (const size of GLYPH_SIZES)
            expect(values("size").has(size), `no glyph states size=${size}`).toBe(true);
        const cartouches = scanSpans(body())
            .spans.filter((span: any) =>
                span.attrs.some(
                    ([key, value]: string[]) => key === "class" && value === "cartouche",
                ),
            )
            .map((span: any) => Object.fromEntries(span.attrs));
        const used = new Set(cartouches.flatMap((attributes: any) => Object.keys(attributes)));
        for (const key of CARTOUCHE_KEYS)
            expect(used.has(key), `no cartouche states ${key}=`).toBe(true);
        for (const align of CARTOUCHE_ALIGNS)
            expect(
                cartouches.some((attributes: any) => attributes.align === align),
                `no cartouche states align=${align}`,
            ).toBe(true);
        for (const key of GLYPH_KEYS)
            expect(
                glyphs.some((span: any) => span.attrs.some(([name]: string[]) => name === key)),
                `no glyph states ${key}=`,
            ).toBe(true);
        for (const id of [
            "glyph-inline",
            "glyph-tablet",
            "glyph-block",
            "cartouche-span",
            "cartouche-leading",
            "cartouche-block-form",
            "cartouche-floated",
            "cartouche-left",
        ])
            expect(CONSTRUCTS[id], `no construct ${id}`).toBeTruthy();
    });

    it("captions every figure kind", () => {
        const resolveRole = (address: string) => (/coast/.test(address) ? "map" : undefined);
        const used = new Set(
            scanFigures(body(), { resolveRole }).figures.map((figure: any) => figure.kind),
        );
        for (const kind of Object.keys(FIGURE_NAMES)) {
            expect(used.has(kind), `no ${kind} figure in the corpus`).toBe(true);
            expect(CONSTRUCTS[`figure-${kind}`], `no construct figure-${kind}`).toBeTruthy();
        }
    });

    it("states every attribute a verse div takes", () => {
        // `dir` and `data-pagefind-ignore` are written by the rewrite of a fence
        // set in a face, not authored.
        const written = new Set(["dir", "data-pagefind-ignore"]);
        const used = new Set(
            scanVerse(body()).blocks.flatMap((verse: any) => Object.keys(verse.attributes)),
        );
        for (const key of VERSE_KEYS.filter((key: string) => !written.has(key)))
            expect(used.has(key), `no verse div states ${key}=`).toBe(true);
    });

    it("states every attribute a scroll fence takes", () => {
        // `data-pagefind-ignore` is written by the rewrite of a fence set in a
        // face, not authored.
        const used = new Set(
            scanScrolls(body()).blocks.flatMap((scroll: any) => Object.keys(scroll.attributes)),
        );
        for (const key of SCROLL_KEYS.filter((key: string) => key !== "data-pagefind-ignore"))
            expect(used.has(key), `no scroll fence states ${key}=`).toBe(true);
    });

    it("marks text with every run key and every generic font", () => {
        const { runs } = scanRuns(body(), { languages: { vyl: { tag: "art-x-vyl" } } });
        for (const key of RUN_KEYS)
            expect(
                runs.some((run: any) => run[key] !== undefined),
                `no marked run states ${key}=`,
            ).toBe(true);
        for (const family of Object.keys(GENERIC_FONTS)) {
            expect(
                runs.some((run: any) => run.font === family),
                `no run sets font=${family}`,
            ).toBe(true);
            expect(
                CONSTRUCTS[`run-font-${family}`],
                `no construct run-font-${family}`,
            ).toBeTruthy();
        }
        for (const kind of ["span", "block", "verse", "scroll"])
            expect(
                runs.some((run: any) => run.kind === kind),
                `no marked ${kind}`,
            ).toBe(true);
    });

    it("calls every expression helper", () => {
        for (const name of Object.keys(EXPRESSION_HELPERS)) {
            expect(
                new RegExp(String.raw`[({]\s*${name}\s`).test(body()),
                `no expression calls ${name}`,
            ).toBe(true);
            expect(
                CONSTRUCTS[`expression-${name}`],
                `no construct expression-${name}`,
            ).toBeTruthy();
        }
    });

    it("writes a sql fence", () => {
        expect(body()).toMatch(/^```sql$/m);
    });
});

/** A markdown-it rule or renderer rule that ran, as `chain:name`. */
type Hits = Set<string>;

/**
 * Wrap every rule of a parser so the names of those that run are recorded.
 *
 * @returns A function that removes the wrappers.
 */
function observe(md: any, hits: Hits): () => void {
    const undo: Array<() => void> = [];
    for (const chain of ["core", "block", "inline"] as const) {
        const ruler = md[chain].ruler;
        for (const rule of ruler.__rules__) {
            const original = rule.fn;
            rule.fn = (...args: unknown[]) => {
                const result = original(...args);
                if (chain === "core" || result) hits.add(`${chain}:${rule.name}`);
                return result;
            };
            undo.push(() => {
                rule.fn = original;
            });
        }
        ruler.__cache__ = null;
        undo.push(() => {
            ruler.__cache__ = null;
        });
    }
    const rules = md.renderer.rules;
    for (const name of Object.keys(rules)) {
        const original = rules[name];
        rules[name] = (...args: unknown[]) => {
            hits.add(`render:${name}`);
            return original(...args);
        };
        undo.push(() => {
            rules[name] = original;
        });
    }
    return () => undo.reverse().forEach((restore) => restore());
}

/** Every parser's rule names, which a stock parser already has. */
function ruleNames(md: any, chain: "core" | "block" | "inline"): string[] {
    return md[chain].ruler.__rules__.map((rule: any) => rule.name);
}

/** The parser a plain `new MarkdownIt()` builds. */
const STOCK = new MarkdownIt();

/**
 * The construct each rule a plugin adds is for. A rule the renderers register
 * that is not named here fails until the corpus has a construct for it.
 */
const RULE_CONSTRUCT: Record<string, string> = {
    "core:dictionary_entry_headings": "dictionary-entry",
    "core:footnote_tail": "footnote",
    "core:cartouche_figures": "cartouche-span",
    "core:dictionary_list_rows": "definition-list",
    "core:heading_attributes": "heading-attributes",
    "core:heading_ids": "commonmark-basics",
    "inline:typographer": "typographic-punctuation",
    "core:heroiclands_image": "image-directive",
    "core:alert_markers": "alert-note",
    "core:verse_inline": "verse-plain",
    "block:verse_div": "verse-plain",
    "core:hl_preview_structure": "figure-code",
    "block:footnote_def": "footnote",
    "block:deflist": "definition-list",
    "block:hl_preview_table": "table-aligned",
    "block:hl_preview_container": "secret-block",
    "inline:heroiclands_icon": "icon",
    "inline:bracket_span": "name-marked",
    "core:first_use": "name-first-use",
    "inline:script_emphasis": "run-emphasis-script",
    "inline:footnote_inline": "footnote-inline",
    "inline:footnote_ref": "footnote",
    "inline:hl_preview_source": "wikilink-resolved",
};

/**
 * Stock rules a parser never reaches because one of its own comes first. Each
 * names the rule that takes its place.
 */
const SHADOWED: Record<string, Record<string, string>> = {
    preview: { "block:table": "block:hl_preview_table consumes every table before it" },
    indexed: {
        "block:table": "block:hl_preview_table consumes every table before it",
        "inline:image":
            "the image pass has written every picture as HTML before the parser reads it",
    },
    web: {
        "inline:image":
            "the image pass has written every picture as HTML before the parser reads it",
    },
};

/** Token rules a parser never renders because an earlier stage has written the markup. */
const PREWRITTEN: Record<string, Set<string>> = {
    indexed: new Set(["image"]),
    web: new Set(["image"]),
};

/** Every token type a parser produces from `source`, nested tokens included. */
function tokenTypes(md: any, source: string): Set<string> {
    const types = new Set<string>();
    const visit = (tokens: any[]) => {
        for (const token of tokens) {
            types.add(token.type);
            if (token.children) visit(token.children);
        }
    };
    visit(md.parse(source, {}));
    return types;
}

/** Run `render` with the parser observed; returns the rules that ran. */
function ran(md: any, render: () => void): Hits {
    const hits: Hits = new Set();
    const restore = observe(md, hits);
    try {
        render();
    } finally {
        restore();
    }
    return hits;
}

describe("every markdown-it rule a renderer registers runs on the corpus", () => {
    const parsers: Record<string, { md: () => any; hits: () => Hits }> = {};
    let previewParser: any;
    let indexedParser: any;
    let foundryParser: any;
    const hitsBy: Record<string, Hits> = {};

    beforeAll(async () => {
        const configPath = path.join(built.root, "package-build.config.yaml");
        const config = configFromData(YAML.parse(fs.readFileSync(configPath, "utf8")), configPath);
        // The Foundry parser reads the package's icon registry from the
        // configuration the process loaded, once. A fresh module graph, loaded
        // with the corpus package's configuration, is the parser a build of
        // that package uses.
        const saved = process.env.PACKAGE_BUILD_CONFIG;
        process.env.PACKAGE_BUILD_CONFIG = configPath;
        vi.resetModules();
        try {
            const helpers = await import("../engine/helpers.mjs");
            foundryParser = helpers.md;
            hitsBy.foundry = ran(foundryParser, () => {
                helpers.renderFoundryMarkdown(built.corpusBody);
            });
        } finally {
            if (saved === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
            else process.env.PACKAGE_BUILD_CONFIG = saved;
            vi.resetModules();
        }

        // The book's runs read the package's script and map notes, which set
        // what emphasis in a face is written as.
        const book = createParser(config.icons);
        hitsBy.book = ran(book, () => {
            markdownToTypst(built.corpusBody, {
                md: book,
                glyphs: new Map(),
                runs: runContext(config, noteRecords(built.root)),
                prepared: true,
            });
        });
        parsers.book = { md: () => book, hits: () => hitsBy.book };

        // The preview builds its parser per render; observe the one each view builds.
        const observePreview = (options: object): [any, Hits] => {
            const render = MarkdownIt.prototype.render;
            const hits: Hits = new Set();
            let parser: any;
            let restore: (() => void) | undefined;
            MarkdownIt.prototype.render = function (this: any, ...args: [string, object?]) {
                if (!restore) {
                    parser = this;
                    restore = observe(this, hits);
                }
                return render.apply(this, args);
            };
            try {
                renderPreview(built.corpusSource, { infobox: false, ...options });
            } finally {
                MarkdownIt.prototype.render = render;
                restore?.();
            }
            return [parser, hits];
        };
        [previewParser, hitsBy.preview] = observePreview({});
        [indexedParser, hitsBy.indexed] = observePreview({ index: previewIndexFor(built.root) });
        // The site renders what its build expanded, with the package's icons.
        const sqlTables = await prepareTreeSqlTables(config.paths.content, {
            skipDirectories: config.skipDirectories,
            config,
            audience: "public",
        });
        const site = buildSite({ config, sqlTables, write: false }).site;
        const corpus = site.pages.find((entry: any) => entry.page.fm.shortcode === "corpus");
        const web = createRenderer("web", { icons: config.icons });
        hitsBy.web = ran(web.md, () => {
            web.render(corpus.markdown, { runs: site.runs, figures: corpus.figures });
        });
        parsers.web = { md: () => web.md, hits: () => hitsBy.web };
        parsers.foundry = { md: () => foundryParser, hits: () => hitsBy.foundry };
        parsers.preview = { md: () => previewParser, hits: () => hitsBy.preview };
        parsers.indexed = { md: () => indexedParser, hits: () => hitsBy.indexed };
    });

    for (const name of ["foundry", "web", "preview", "indexed", "book"]) {
        describe(name, () => {
            it("names a construct for every rule a plugin adds", () => {
                const md = parsers[name].md();
                for (const chain of ["core", "block", "inline"] as const) {
                    const stock = new Set(ruleNames(STOCK, chain));
                    for (const rule of ruleNames(md, chain).filter((rule) => !stock.has(rule))) {
                        const key = `${chain}:${rule}`;
                        expect(
                            RULE_CONSTRUCT[key],
                            `${name} registers ${key}, which no construct is mapped to`,
                        ).toBeTruthy();
                        expect(
                            CONSTRUCTS[RULE_CONSTRUCT[key]],
                            `${key} maps to no construct`,
                        ).toBeTruthy();
                    }
                }
            });

            it("runs every block and inline rule on the corpus", () => {
                const md = parsers[name].md();
                const hits = parsers[name].hits();
                const missing: string[] = [];
                for (const chain of ["block", "inline"] as const) {
                    const rules = md[chain].ruler.__rules__.filter((rule: any) => rule.enabled);
                    for (const { name: rule } of rules) {
                        const key = `${chain}:${rule}`;
                        if (hits.has(key) || SHADOWED[name]?.[key]) continue;
                        if (
                            !md.options.html &&
                            ["block:html_block", "inline:html_inline"].includes(key)
                        )
                            continue;
                        if (!md.options.linkify && key === "inline:linkify") continue;
                        missing.push(key);
                    }
                }
                expect(missing, `${name} rules the corpus never exercises`).toEqual([]);
            });

            it("renders every token the parser has a rule for", () => {
                const md = parsers[name].md();
                const hits = parsers[name].hits();
                // The book walks the token stream itself and calls none of the
                // parser's HTML rules, so for it a rule is exercised when the
                // corpus produces the token the rule is for. The two footnote
                // helpers are named by the HTML rules and are not tokens.
                const typeless = new Set(["footnote_anchor_name", "footnote_caption"]);
                const types =
                    name === "book" ? tokenTypes(md, built.corpusBody) : new Set<string>();
                const missing: string[] = [];
                for (const rule of Object.keys(md.renderer.rules)) {
                    if (hits.has(`render:${rule}`)) continue;
                    if (!md.options.html && ["html_block", "html_inline"].includes(rule)) continue;
                    if (name === "book" && (types.has(rule) || typeless.has(rule))) continue;
                    if (PREWRITTEN[name]?.has(rule)) continue;
                    missing.push(rule);
                }
                expect(missing, `${name} token rules the corpus never renders`).toEqual([]);
            });
        });
    }
});

describe("the corpus note is the one place each construct is exercised", () => {
    it("holds the corpus in one note, with no frontmatter in the body the renderers read", () => {
        expect(bodyOf(built.corpusSource)).toBe(built.corpusBody);
        expect(built.corpusBody.startsWith("---")).toBe(false);
    });
});

it("retains the shared word separators in the public Teng Chou encoding note", () => {
    const context = runContext(fixtureConfig(built.root), noteRecords(built.root));
    expect(context.encodingFindings).toEqual([]);
    const encoding = context.encodings.get("tsutengenc");
    expect(encoding).toMatchObject({ language: "tsu", font: "teng-chou" });
    const source = "chen teng chou hing tan tsou dou rou";
    const native =
        "\u{F101F} \u{F1013} \u{F103E} \u{F1057} \u{F1014} \u{F102A} \u{F1036} \u{F10AA}";
    expect(encodeText(encoding, source)).toBe(native);
    expect(decodeText(encoding, native)).toBe(source);
});
