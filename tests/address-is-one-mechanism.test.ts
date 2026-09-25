/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An Address is read and written in one place.
 *
 * An Address is the four-tuple `<package>-<system>-<type>-<shortcode>`, and it
 * is the identity of everything this toolchain compiles: how a note names
 * another note, how a compendium entry is keyed, how a page's URL is derived,
 * how an asset's file is found, how a Foundry UUID is built, and what the
 * published index records. Three quarters of the engine touches it, so every
 * module that reads one by hand is a second grammar that can disagree with the
 * first — and the disagreements are quiet: a value the author wrote correctly
 * reported as naming nothing, or a short form silently resolving into the wrong
 * package.
 *
 * `engine/address.mjs` owns the grammar. This guard is what keeps that true:
 * it scans the modules the package ships for the three ways a module reads or
 * writes an Address without the parser — building one by template literal,
 * splitting one on the separator, and asking whether a value carries the
 * separator at all — and holds the result against an explicit list.
 *
 * **The list is asserted both ways.** A site the list does not name fails,
 * which is what stops an eighteenth module growing a private copy; a listed
 * site that no longer exists fails too, so converting one obliges deleting its
 * entry rather than leaving a stale claim behind.
 *
 * **It carries two kinds of entry, and they are not the same claim.** Most name
 * the packet that converts them, so the list reads as the remaining work and
 * empties as that work lands. The rest are finished: the value at that position
 * is a **shortcode** rather than an Address — a different data type, with its
 * own charset, resolved among one actor's embedded items where packages do not
 * exist — so reading it without the Address parser is correct and stays.
 *
 * The second half is the round trip: for each position's defaults, every
 * sub-format of one Address parses to the same tuple, and rendering that tuple
 * gives the canonical string.
 *
 * The third is the other way an Address gets read by hand, which no amount of
 * string-surgery scanning finds: a resolver that treats an omitted segment as a
 * **wildcard** and searches every key for candidates. The specification says an
 * omitted segment defaults from where the value is written, so a short form
 * expands to exactly one canonical Address and a lookup finds one entry or none.
 * That inventory is kept and asserted separately, because converting one of those
 * sites changes what resolves rather than only how it is spelled.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    acceptsType,
    parseAddress,
    readQualifier,
    renderAddress,
    CANONICAL_KEY_SEGMENTS,
} from "../engine/address.mjs";
import { NO_SYSTEM } from "../engine/systems.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.dirname(HERE);

/** The module that owns the grammar, and the only one exempt from the scan. */
const OWNER = "engine/address.mjs";

/**
 * The words that mark an expression as naming part of an Address.
 *
 * A hyphen joins plenty of things that are not addresses — a file name, a CSS
 * class, a cache key, a hashed id — so the scan asks what is being joined
 * rather than merely that a hyphen is there. `package` is deliberately absent:
 * a Foundry package id is hyphenated for its own reasons, and every address
 * built in this tree names a `type` or a `shortcode` beside it anyway.
 */
const ADDRESS_WORDS = new Set([
    "pkg",
    "system",
    "type",
    "shortcode",
    "ref",
    "canonical",
    "address",
    "to",
]);

/**
 * A template literal that is nothing but hyphen-joined address segments.
 *
 * Nothing but: a literal carrying a space, a quote, a dot or an angle bracket is
 * prose or a file name rather than an address, which is what keeps the diagnostic
 * messages that *spell out* the grammar from reading as violations of it.
 */
const BUILDS = /`(?:\$\{[^{}`]*\}|[a-z0-9]+)(?:-(?:\$\{[^{}`]*\}|[a-z0-9]+))+`/g;

/** A split on the address separator. */
const SPLITS = /\.split\((["'])-\1\)/g;

/** A question about whether a value carries the address separator. */
const INSPECTS = /\.(?:includes|indexOf|lastIndexOf)\((["'])-\1\)/g;

/**
 * The words an expression is made of, with `_` and camel-case humps treated as
 * boundaries, so `FOLDER_TYPE` and `defaultType` both yield `type` while
 * `packageId` yields `package` and `id` rather than either alone.
 */
function words(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

/**
 * Whether a matched template literal *builds* an Address.
 *
 * It has to interpolate something — a literal with no `${}` in it names one
 * address rather than composing any, which is what a message quoting the
 * grammar back at an author does — and what it interpolates has to be part of an
 * Address.
 */
function buildsAnAddress(match: string): boolean {
    if (!match.includes("${")) return false;
    return words(match).some((word) => ADDRESS_WORDS.has(word));
}

/**
 * The lines of a source file a scan may read — code, with comments dropped.
 *
 * Every module here documents the address grammar in prose, and that prose is
 * full of backticked examples. Scanning them would report the specification as
 * a violation of itself.
 */
function codeLines(source: string): string[] {
    const out: string[] = [];
    let inBlock = false;
    for (const raw of source.split("\n")) {
        const text = raw.trim();
        if (inBlock) {
            if (text.includes("*/")) inBlock = false;
            continue;
        }
        if (text.startsWith("/*")) {
            if (!text.includes("*/")) inBlock = true;
            continue;
        }
        if (text.startsWith("//") || text.startsWith("*")) continue;
        out.push(raw);
    }
    return out;
}

/** Every `.mjs` the package ships, package-relative and sorted. */
function shippedModules(): string[] {
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
        files: string[];
    };
    const walk = (full: string): string[] => {
        if (!fs.existsSync(full)) return [];
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            return fs.readdirSync(full).flatMap((entry) => walk(path.join(full, entry)));
        }
        return full.endsWith(".mjs") ? [path.relative(PKG_ROOT, full)] : [];
    };
    return manifest.files
        .flatMap((entry) => walk(path.join(PKG_ROOT, entry)))
        .sort()
        .map((rel) => rel.split(path.sep).join("/"));
}

/** One site: a file, the source fragment found there, and how many times. */
type Site = { file: string; snippet: string; count: number };

/** Every hand-rolled Address site in one file. */
function sitesIn(file: string): Map<string, number> {
    const source = codeLines(fs.readFileSync(path.join(PKG_ROOT, file), "utf8")).join("\n");
    const found = new Map<string, number>();
    const tally = (snippet: string) => found.set(snippet, (found.get(snippet) ?? 0) + 1);
    for (const [match] of source.matchAll(BUILDS)) {
        if (buildsAnAddress(match)) tally(match);
    }
    for (const [match] of source.matchAll(SPLITS)) tally(match);
    for (const [match] of source.matchAll(INSPECTS)) tally(match);
    return found;
}

/** Every hand-rolled Address site outside the module that owns the grammar. */
function scan(): Site[] {
    return shippedModules()
        .filter((file) => file !== OWNER)
        .flatMap((file) =>
            [...sitesIn(file)].map(([snippet, count]) => ({ file, snippet, count })),
        );
}

/** A site as one comparable line. */
const render = (site: Site) => `${site.file}  ${site.snippet}  ×${site.count}`;

/**
 * A listed site: where it is, what was found, and why it is still there.
 *
 * `converts` is the packet that removes the site. It is `null` where there is
 * nothing to convert, because the value at that position is a **shortcode**
 * rather than an Address — a different data type, with its own charset and its
 * own rule, resolved among one actor's embedded items where packages do not
 * exist. The two kinds must not be read as one: a shortcode site is finished,
 * and a pending site is work.
 */
type Exemption = Site & { converts: number | null; why: string };

/** The sites that still read or write an Address by hand. */
const EXEMPT: readonly Exemption[] = [
    {
        file: "engine/art-fields.mjs",
        snippet: '.includes("-")',
        count: 1,
        converts: 688,
        why: "an art slot decides whether its value is already qualified",
    },
    {
        file: "engine/art-fields.mjs",
        snippet: "`${defaultType}-${written}`",
        count: 1,
        converts: 688,
        why: "an art slot prepends its declared type instead of passing it as a default",
    },
    {
        file: "engine/content-address.mjs",
        snippet: "`${type}-${shortcode}`",
        count: 1,
        converts: 690,
        why: "the page slug, an Address's last two segments with no system segment at all",
    },
    {
        file: "engine/folder-notes.mjs",
        snippet: "`${FOLDER_TYPE}-${folder.shortcode}`",
        count: 1,
        converts: 690,
        why: "a folder's own address, keyed beside the one it publishes under",
    },
    {
        file: "engine/frontmatter-lint.mjs",
        snippet: "`${field.ref}-${value}`",
        count: 1,
        converts: 687,
        why:
            "one concatenation serves both kinds of reference — correct for the " +
            "shortcode fields and wrong for the Address ones, which is why it " +
            "looks reasonable. The packet splits the declaration, and whether a " +
            "concatenation survives for the shortcode half is its call to make",
    },
    {
        file: "engine/holdings.mjs",
        snippet: '.split("-")',
        count: 2,
        converts: 690,
        why: "the last segment is the shortcode, twice",
    },
    {
        file: "engine/map-places.mjs",
        snippet: '.split("-")',
        count: 2,
        converts: 690,
        why: "a pin's target read segment by segment",
    },
    {
        file: "engine/populations.mjs",
        snippet: '.split("-")',
        count: 1,
        converts: 690,
        why: "the last segment is the shortcode",
    },
    {
        file: "engine/populations.mjs",
        snippet: "`${node.type}-${node.shortcode}`",
        count: 1,
        converts: 690,
        why: "a settlement's address rebuilt to key a lookup",
    },
    {
        file: "engine/scenes.mjs",
        snippet: "`${fm.type}-${fm.shortcode}`",
        count: 1,
        converts: 690,
        why: "a scene's address rebuilt to key a lookup",
    },
    {
        file: "engine/site-index.mjs",
        snippet: '.includes("-")',
        count: 1,
        converts: 690,
        why: "an infobox reference decides whether it is already qualified",
    },
    {
        file: "engine/site-index.mjs",
        snippet: '.split("-")',
        count: 2,
        converts: 690,
        why: "an infobox reference and a published key, each read segment by segment",
    },
    {
        file: "engine/wikilinks.mjs",
        snippet: '.includes("-")',
        count: 1,
        converts: 690,
        why: "a reference hint decides whether it is already qualified",
    },
    {
        file: "engine/wikilinks.mjs",
        snippet: '.split("-")',
        count: 1,
        converts: 690,
        why: "a reference hint read segment by segment",
    },
    {
        file: "sohl/infobox.mjs",
        snippet: '.split("-")',
        count: 1,
        converts: 690,
        why:
            "an embedded item's `model`, which is an Address, read here for the " +
            "type and shortcode a runtime lookup takes",
    },
];

describe("an Address is read and written in one place", () => {
    it("scans the modules the package ships", () => {
        const modules = shippedModules();
        expect(modules).toContain(OWNER);
        expect(modules.length).toBeGreaterThan(80);
    });

    it("detects each way an Address is read or written by hand", () => {
        // Guards the guard: were the detectors broken, every case below would
        // pass by finding nothing anywhere. They are given samples rather than a
        // file, because the module that owns the grammar splits on
        // `ADDRESS_SEPARATOR` — which is exactly why a bare `"-"` elsewhere is
        // worth finding.
        const sample = [
            "const key = `${pkg}-${system}-${type}-${shortcode}`;",
            'const parts = value.split("-");',
            'if (written.includes("-")) return written;',
            // Not an address: a file name, a CSS class, and a hashed id.
            "const out = `${safe}-${version}.pdf`;",
            "cls(`${prefix}-fw`);",
            "hash(`${noteId}-${anchorSlug}`);",
        ].join("\n");
        const found = [...sample.matchAll(BUILDS)]
            .map(([match]) => match)
            .filter(buildsAnAddress)
            .concat([...sample.matchAll(SPLITS)].map(([match]) => match))
            .concat([...sample.matchAll(INSPECTS)].map(([match]) => match));
        expect(found).toEqual([
            "`${pkg}-${system}-${type}-${shortcode}`",
            '.split("-")',
            '.includes("-")',
        ]);
    });

    it("finds the renderer in the module that owns the grammar", () => {
        const owner = sitesIn(OWNER);
        expect([...owner.keys()].some((snippet) => buildsAnAddress(snippet))).toBe(true);
    });

    it("names every site that reads or writes an Address by hand", () => {
        const found = scan().map(render).sort();
        const listed = EXEMPT.map(render).sort();
        expect(found).toEqual(listed);
    });

    it("says of every listed site either what converts it or that it is finished", () => {
        for (const site of EXEMPT) {
            expect(site.why.length, render(site)).toBeGreaterThan(10);
            if (site.converts !== null) expect(site.converts, render(site)).toBeGreaterThan(0);
        }
    });

    it("lists no site twice", () => {
        // A tuple key, so the pair cannot be collapsed by a separator that
        // turns up in a path or in a code fragment.
        const keys = EXEMPT.map((site) => JSON.stringify([site.file, site.snippet]));
        expect(new Set(keys).size).toBe(keys.length);
    });
});

/**
 * A segment comparison a resolver **skips** when the written value omitted that
 * segment — the candidate search.
 *
 * `if (q.package && parts.package !== …) return false` inside a filter is the
 * shape: it turns an omitted segment into a wildcard and resolution into a
 * search over every key. The specification says the opposite — a short form
 * expands from the position's defaults to exactly one canonical Address, so a
 * lookup finds one entry or none — and the detector is narrow enough to find
 * only that shape: the same segment guarded and compared on one line, ending in
 * the filter's `return false`.
 */
const WILDCARDS = /\b\w+\.(package|system)\s*&&\s*\w+\.\1\s*!==[^\n]*return false/g;

/**
 * Where an Address still resolves by searching candidates rather than by one
 * exact lookup.
 *
 * `packet` is the packet that converts the site, and `null` means **no packet is
 * cut for it yet** — unlike the list above, where `null` means the site is
 * finished. Converting one of these removes a candidate search and therefore
 * changes what resolves, so it needs its own measurement and cannot ride along
 * with a mechanical conversion.
 */
const CANDIDATE_SEARCH: readonly (Site & { packet: number | null; why: string })[] = [
    {
        file: "engine/content-links.mjs",
        snippet: "q.package && parts.package !==",
        count: 1,
        packet: null,
        why:
            "the package comparison is skipped for a short form, so a reference " +
            "resolves in any reachable package and the first key walked wins",
    },
    {
        file: "engine/content-links.mjs",
        snippet: "q.system && parts.system !==",
        count: 1,
        packet: null,
        why: "the system comparison is skipped for a form that states no system",
    },
];

describe("an Address resolves by one exact lookup", () => {
    it("detects a segment comparison a resolver skips", () => {
        const sample = [
            "if (q.package && parts.package !== String(q.package).toLowerCase()) return false;",
            // Not a candidate search: a pack filter that continues, and an exact
            // package comparison guarding a branch rather than a filter.
            "if (system != null && pack.system && pack.system !== system) continue;",
            "if (read.package && read.package !== contentPackage()) {",
        ].join("\n");
        expect([...sample.matchAll(WILDCARDS)].map(([, segment]) => segment)).toEqual(["package"]);
    });

    it("names every resolver that still searches candidates", () => {
        const found = shippedModules().flatMap((file) => {
            const source = codeLines(fs.readFileSync(path.join(PKG_ROOT, file), "utf8")).join("\n");
            const tally = new Map<string, number>();
            for (const [, segment] of source.matchAll(WILDCARDS)) {
                const snippet = `q.${segment} && parts.${segment} !==`;
                tally.set(snippet, (tally.get(snippet) ?? 0) + 1);
            }
            return [...tally].map(([snippet, count]) => ({ file, snippet, count }));
        });
        expect(found.map(render).sort()).toEqual(CANDIDATE_SEARCH.map(render).sort());
    });

    it("says why every listed resolver is still there", () => {
        for (const site of CANDIDATE_SEARCH) {
            expect(site.why.length, render(site)).toBeGreaterThan(10);
        }
    });

    it("expands every part from the defaults, leaving nothing unconstrained", () => {
        // The parser's own answer to the same question: a complete tuple, never
        // a partial one, so nothing downstream has a segment to wildcard.
        const tuple = parseAddress("skill-wpnc", {
            package: "thalorna",
            system: "sohl",
            types: new Set(["skill"]),
            packages: new Set(["thalorna"]),
        }) as Record<string, string>;
        for (const segment of ["package", "system", "type", "shortcode"]) {
            expect(tuple[segment], segment).toBeTruthy();
        }
    });
});

/**
 * The positions an Address is written at, each with the defaults it supplies.
 *
 * `type` is the segment a position may fill in; a position that accepts more
 * than one type declares none, and an omitted `<type>` segment is then a parse
 * failure rather than a guess.
 */
const POSITIONS = [
    {
        name: "body prose, which belongs to no system block",
        types: new Set(["skill", "place", "lore", "weapongear"]),
        packages: new Set(["thalorna", "sohl", "kethira"]),
        defaults: { package: "thalorna", system: NO_SYSTEM },
        // A type whose own document lives at `none` whatever it is reached
        // from, so the written forms differ only in how much they state.
        example: "place",
    },
    {
        // A being's `sohl.items[].model`, the position the corpus writes at both
        // lengths most heavily, and the one where the system default is the
        // enclosing block rather than `none`.
        name: "an embedded item's `model`, inside a `sohl:` block",
        types: new Set(["skill", "place", "lore", "weapongear"]),
        packages: new Set(["thalorna", "sohl", "kethira"]),
        defaults: { package: "thalorna", system: "sohl" },
        example: "weapongear",
    },
    {
        name: "an art slot, which fills in its own type",
        types: new Set(["icon", "image", "skill"]),
        packages: new Set(["thalorna", "sohl"]),
        defaults: { package: "thalorna", system: NO_SYSTEM, type: "icon" },
        example: "icon",
    },
] as const;

describe("every sub-format of one Address parses to one tuple", () => {
    for (const position of POSITIONS) {
        const vocabulary = { types: position.types, packages: position.packages };
        const where = { ...position.defaults, ...vocabulary };

        it(`round-trips at ${position.name}`, () => {
            const type = position.example;
            const shortcode = "vylar";
            const full = [
                position.defaults.package,
                position.defaults.system,
                type,
                shortcode,
            ].join("-");

            const forms = [
                `${type}-${shortcode}`,
                `${position.defaults.system}-${type}-${shortcode}`,
                full,
            ];
            const tuples = forms.map((written) => parseAddress(written, where));
            for (const [index, tuple] of tuples.entries()) {
                // One value, whatever the author wrote: the tuple carries the
                // four segments and no memory of the form it was read from.
                expect(tuple, forms[index]).toEqual(tuples[0]);
                expect(Object.keys(tuple).sort(), forms[index]).toEqual([
                    "package",
                    "shortcode",
                    "system",
                    "type",
                ]);
                expect(renderAddress(tuple as never), forms[index]).toBe(full);
            }
            expect(full.split("-")).toHaveLength(CANONICAL_KEY_SEGMENTS);
        });

        it(`fills in an omitted type only where one is declared at ${position.name}`, () => {
            const parsed = parseAddress("vylar", where);
            if ("type" in position.defaults) {
                expect(parsed).toMatchObject({ type: "icon", shortcode: "vylar" });
            } else {
                // Nothing says what the value names, so it is refused rather
                // than guessed at — and never read as a bare shortcode, which
                // is a different data type this module does not take.
                expect(parsed).toEqual({ reason: "no-type" });
            }
        });
    }

    it("reads one written string as two Addresses at two positions", () => {
        // The defaults-per-part rule, which is why the written form cannot be
        // the value: `skill-wpnc` under `sohl.items` names the Item, and the
        // same string in body prose names the page that documents it.
        const vocabulary = {
            types: new Set(["skill"]),
            packages: new Set(["thalorna", "sohl"]),
        };
        const inBlock = parseAddress("skill-wpnc", {
            package: "thalorna",
            system: "sohl",
            ...vocabulary,
        });
        const inProse = parseAddress("skill-wpnc", {
            package: "thalorna",
            system: NO_SYSTEM,
            ...vocabulary,
        });
        expect(inBlock).not.toEqual(inProse);
        expect(renderAddress(inBlock as never)).toBe("thalorna-sohl-skill-wpnc");
        expect(renderAddress(inProse as never)).toBe("thalorna-none-docskill-wpnc");
        // Both name a skill, so a position accepting `skill` takes either.
        expect(acceptsType(inBlock as never, ["skill"])).toBe(true);
        expect(acceptsType(inProse as never, ["skill"])).toBe(true);
    });

    it("gives a documentation journal one tuple however it is written", () => {
        const where = {
            package: "sohl",
            system: NO_SYSTEM,
            types: new Set(["weapongear"]),
            packages: new Set(["sohl"]),
        };
        const named = parseAddress("docweapongear-dgr", where);
        const reached = parseAddress("weapongear-dgr", where);
        // Two spellings of one Address, so one value: the tuple remembers
        // nothing about which was written.
        expect(named).toEqual(reached);
        expect(named).toEqual({
            package: "sohl",
            system: NO_SYSTEM,
            type: "docweapongear",
            shortcode: "dgr",
        });
        expect(renderAddress(named as never)).toBe("sohl-none-docweapongear-dgr");
        // A position accepting `weapongear` accepts the journal documenting one.
        expect(acceptsType(named as never, ["weapongear"])).toBe(true);
        expect(acceptsType(named as never, ["skill"])).toBe(false);
    });

    it("keeps a stated system, so an item is not reached as its journal", () => {
        const tuple = parseAddress("sohl-weapongear-dgr", {
            package: "sohl",
            system: NO_SYSTEM,
            types: new Set(["weapongear"]),
            packages: new Set(["sohl"]),
        });
        expect(renderAddress(tuple as never)).toBe("sohl-sohl-weapongear-dgr");
    });

    it("reads the partial form the resolvers match on", () => {
        const types = new Set(["place"]);
        const packages = new Set(["thalorna"]);
        expect(readQualifier("place-vylar", types, packages)).toEqual({
            type: "place",
            shortcode: "vylar",
            itemDoc: false,
        });
        expect(readQualifier("Shock State", types, packages)).toBeNull();
    });
});
