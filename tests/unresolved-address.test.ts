/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An address that resolves to no note fails every build (#184).
 *
 * The tolerance was a property of the **bare** form. `[[Sunless Vault]]` was
 * read as a worldbuilding placeholder — a note somebody meant to write — so an
 * address landing nowhere was softened to a warning in one place and to nothing
 * at all in another. #180 retired that form, and #183 gave the intent it stood
 * for a real spelling: a `draft`-tagged note, which exists, resolves, and
 * renders marked. Nothing is left for the softening to protect.
 *
 * So the rule is now unconditional, and — more importantly — it is the *same*
 * rule in all three places a link is read. The three resolvers are:
 *
 * | resolver | module | what it produces |
 * | --- | --- | --- |
 * | the checker | `content-links.mjs` | `content-build links` findings |
 * | the pack build | `wikilinks.mjs` + `helpers.mjs` | a Foundry `@UUID` |
 * | the site build | `web-wikilinks.mjs` | a page URL |
 *
 * They used to disagree twice over. The site build failed an unresolved address
 * only once every linkable package had vendored a manifest, so the same
 * authored link was an error in two builds and silent in the third; and each
 * named the failure classes in its own words, so a reason string meant three
 * things. One vocabulary and one message table now serve all three, and the
 * agreement is asserted here rather than described in a comment.
 */

import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import {
    LINK_FINDING_REASONS,
    ambiguousAddressMessage,
    linkFindingMessage,
    unlabelledLinkMessage,
    unresolvedAddressMessage,
} from "../engine/wikilink-syntax.mjs";
import { buildWikilinkIndex, convertWikilinks } from "../engine/wikilinks.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { convertNoteWikilinks } from "../engine/helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "content-build.mjs");

/** A throwaway directory tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>, prefix = "unresolved-address-"): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return root;
}

/** A note with frontmatter and a body. */
function note(fm: Record<string, unknown>, body = ""): string {
    const lines = ["---"];
    for (const [k, v] of Object.entries(fm)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            lines.push(`${k}:`);
            for (const [k2, v2] of Object.entries(v as object)) lines.push(`  ${k2}: ${v2}`);
        } else {
            lines.push(`${k}: ${v}`);
        }
    }
    lines.push("---", "", body, "");
    return lines.join("\n");
}

/**
 * Audit a corpus, optionally against vendored manifests.
 *
 * `skipDirectories: []` because the default skips the vault scaffolding a real
 * tree carries and a fixture has none.
 */
function audit(files: Record<string, string>, manifests?: Record<string, unknown>) {
    const manifestDir = manifests ? tree(mapValues(manifests), "unresolved-manifests-") : undefined;
    const index = buildLinkIndex(tree(files), {
        skipDirectories: [],
        skipDirectories: [],
        ...(manifestDir ? { manifestDir } : {}),
    });
    return { index, ...auditLinks(index) };
}

/** `{ "thalorna.json": {...} }` → the same keys with JSON text. */
function mapValues(docs: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(docs).map(([k, v]) => [k, `${JSON.stringify(v, null, 2)}\n`]),
    );
}

/** A pack-only manifest: Foundry addresses and no pages, so it needs no base. */
function packOnlyManifest(pkg: string, type: string, shortcode: string, name: string) {
    return {
        version: 5,
        package: pkg,
        entries: {
            [`${pkg}-${type}-${shortcode}`]: {
                name,
                uuid: `Compendium.sohl-${pkg}.items.Item.aaaaaaaaaaaaaaa1`,
            },
        },
    };
}

/** A skill named "Climbing" and a sibling that cites whatever `body` says. */
const corpus = (body: string) => ({
    "Skills/Climbing.md": note({
        type: "skill",
        shortcode: "clmb",
        name: { full: "Climbing" },
    }),
    "Skills/Jumping.md": note({ type: "skill", shortcode: "jmp", name: { full: "Jumping" } }, body),
});

/* ---------------------------------------------------------------------- */
/*  The vocabulary, stated once                                           */
/* ---------------------------------------------------------------------- */

describe("one vocabulary of link findings", () => {
    it("is a closed set the three resolvers draw from", () => {
        expect([...LINK_FINDING_REASONS].sort()).toEqual([
            "ambiguous",
            "not-an-address",
            "unknown-anchor",
            "unknown-type",
            "unlabelled",
            "unresolved",
        ]);
    });

    it("has a message for every reason, and each names the target", () => {
        for (const reason of LINK_FINDING_REASONS) {
            const message = linkFindingMessage({ reason, target: "skill-nosuch" });
            expect(message, reason).toContain("skill-nosuch");
            expect(message.length, reason).toBeGreaterThan(20);
        }
    });

    it("names both corrections for an unresolved address", () => {
        // An address may resolve nowhere because the shortcode is wrong, or
        // because the package that publishes it has no manifest vendored here.
        // The author cannot tell which from the link, so the message says both.
        const message = unresolvedAddressMessage("thalorna-creature-grkrahk");
        expect(message).toContain("thalorna-creature-grkrahk");
        expect(message).toMatch(/shortcode/);
        expect(message).toMatch(/manifest/);
    });

    it("names the claiming packages for an ambiguous address", () => {
        const message = ambiguousAddressMessage("creature-wolf", ["kethira", "thalorna"]);
        expect(message).toContain("kethira");
        expect(message).toContain("thalorna");
        // The correction is mechanical, so the message says the form to write.
        expect(message).toContain("package");
    });

    it("delegates the unlabelled case rather than restating it", () => {
        expect(linkFindingMessage({ reason: "unlabelled", target: "Climbing" })).toBe(
            unlabelledLinkMessage("Climbing"),
        );
    });
});

/* ---------------------------------------------------------------------- */
/*  The checker                                                           */
/* ---------------------------------------------------------------------- */

describe("the checker fails an address that resolves to no note", () => {
    it("reports a labelled address nothing answers", () => {
        const r = audit(corpus("See [[skill-nosuch|Nothing]]."));
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0]).toMatchObject({ reason: "unresolved", target: "skill-nosuch" });
        expect(r.deadAddresses[0].note.rel).toBe("Skills/Jumping.md");
    });

    it("keeps a resolving address clean", () => {
        const r = audit(corpus("See [[skill-clmb|Climbing]]."));
        expect(r.deadAddresses).toEqual([]);
    });

    it("reports a qualified target naming no known type", () => {
        const r = audit(corpus("See [[nosuchtype/x|Nothing]]."));
        expect(r.deadAddresses[0]).toMatchObject({ reason: "unknown-type" });
    });

    it("reports a target that is not an address at all", () => {
        const r = audit(corpus("See [[Sunless Vault|the vault]]."));
        expect(r.deadAddresses[0]).toMatchObject({ reason: "not-an-address" });
    });

    it("resolves an address one foreign manifest publishes", () => {
        const r = audit(corpus("See [[creature-wolf|a wolf]]."), {
            "thalorna.json": packOnlyManifest("thalorna", "creature", "wolf", "Dire Wolf"),
        });
        expect(r.deadAddresses).toEqual([]);
        expect([...r.usedManifest]).toEqual(["creature-wolf"]);
    });

    it("reports an address two foreign packages both publish as ambiguous", () => {
        // Not "no document has that identity" — two do, which is a different
        // mistake with a different fix: write the package-qualified form.
        const r = audit(corpus("See [[creature-wolf|a wolf]]."), {
            "thalorna.json": packOnlyManifest("thalorna", "creature", "wolf", "Dire Wolf"),
            "kethira.json": packOnlyManifest("kethira", "creature", "wolf", "Grey Wolf"),
        });
        expect(r.deadAddresses).toHaveLength(1);
        expect(r.deadAddresses[0]).toMatchObject({ reason: "ambiguous" });
        expect([...r.deadAddresses[0].packages].sort()).toEqual(["kethira", "thalorna"]);
    });

    it("resolves the package-qualified form the ambiguity message asks for", () => {
        const r = audit(corpus("See [[thalorna-creature-wolf|a wolf]]."), {
            "thalorna.json": packOnlyManifest("thalorna", "creature", "wolf", "Dire Wolf"),
            "kethira.json": packOnlyManifest("kethira", "creature", "wolf", "Grey Wolf"),
        });
        expect(r.deadAddresses).toEqual([]);
    });
});

/* ---------------------------------------------------------------------- */
/*  The pack build                                                        */
/* ---------------------------------------------------------------------- */

describe("the pack build fails an address that resolves to no note", () => {
    const DOCS = [
        { type: "skill", id: "aaaaaaaaaaaaaaa1", shortcode: "clmb", name: "Climbing" },
        { type: "skill", id: "aaaaaaaaaaaaaaa2", shortcode: "jmp", name: "Jumping" },
    ];
    const from = (foreign?: Map<string, object>) => ({
        type: "skill",
        id: "aaaaaaaaaaaaaaa2",
        index: buildWikilinkIndex(DOCS, "sohl", foreign),
    });

    it("names the unresolved case with the shared reason", () => {
        const { unresolved } = convertWikilinks("[[skill-nosuch|Nothing]]", from());
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({ reason: "unresolved", target: "skill-nosuch" });
    });

    it("reports an address two foreign packages both publish as ambiguous", () => {
        const foreign = new Map<string, object>([
            [
                "thalorna-creature-wolf",
                { name: "Dire Wolf", type: "creature", package: "thalorna", uuid: "C.a.b.Item.c" },
            ],
            [
                "kethira-creature-wolf",
                { name: "Grey Wolf", type: "creature", package: "kethira", uuid: "C.a.b.Item.d" },
            ],
        ]);
        const { unresolved } = convertWikilinks("[[creature-wolf|a wolf]]", from(foreign));
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({ reason: "ambiguous" });
        expect([...unresolved[0].packages].sort()).toEqual(["kethira", "thalorna"]);
    });

    it("fails the note with the shared message", () => {
        const at = { ...from(), name: "Jumping", file: "Skills/Jumping.md" };
        let message = "";
        try {
            convertNoteWikilinks("[[skill-nosuch|Nothing]]", at);
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain(unresolvedAddressMessage("skill-nosuch"));
        // The note is still named: a compiler diagnostic locates the file, and
        // the message says which document failed to compile.
        expect(message).toContain("Jumping");
    });
});

/* ---------------------------------------------------------------------- */
/*  The site build                                                        */
/* ---------------------------------------------------------------------- */

describe("the site build fails an address that resolves to no note", () => {
    const climbing = { url: "/kb/skill/climbing/", name: "Climbing" };
    const ctx = (overrides: Record<string, unknown> = {}) => ({
        index: new Map<string, object>([["skill/clmb", climbing]]),
        collide: new Set<string>(),
        sections: new Set<string>(["kb"]),
        contentTypes: new Set<string>(["skill", "creature"]),
        foreign: new Map<string, object>(),
        type: "skill",
        errors: [] as Record<string, unknown>[],
        src: "Skills/Jumping.md",
        file: "/tmp/tree/Skills/Jumping.md",
        ...overrides,
    });

    it("fails even with no manifest vendored — the softening is gone", () => {
        // This is the promotion #184 asks for. The gate used to be
        // `manifestsComplete`: while any linkable package was invisible, a dead
        // address was indistinguishable from a legitimate cross-package one, so
        // the site build let both through. The other two builds never did.
        const c = ctx();
        const out = resolveWebWikilinks("see [[creature-notreal|Nope]]", c as never);
        expect(out).toContain("sohl-unresolved-link");
        expect(c.errors).toHaveLength(1);
        expect(c.errors[0]).toMatchObject({ reason: "unresolved", target: "creature-notreal" });
    });

    it("ignores a manifestsComplete flag entirely", () => {
        // Passed by an older consumer, it must not re-soften anything.
        const c = ctx({ manifestsComplete: false });
        resolveWebWikilinks("[[creature-notreal|Nope]]", c as never);
        expect(c.errors).toHaveLength(1);
    });

    it("carries the authored link and its occurrence, so a diagnostic can locate it", () => {
        const c = ctx();
        resolveWebWikilinks(
            "[[creature-notreal|Nope]] and again [[creature-notreal|Nope]]",
            c as never,
        );
        expect(c.errors).toHaveLength(2);
        expect(c.errors[0]).toMatchObject({
            link: "[[creature-notreal|Nope]]",
            occurrence: 1,
            file: "/tmp/tree/Skills/Jumping.md",
        });
        expect(c.errors[1]).toMatchObject({ occurrence: 2 });
    });

    it("falls back to the source path when the caller supplies no file", () => {
        const c = ctx({ file: undefined });
        resolveWebWikilinks("[[creature-notreal|Nope]]", c as never);
        expect(c.errors[0]).toMatchObject({ file: "Skills/Jumping.md" });
    });

    it("reports a qualified target naming no known type", () => {
        const c = ctx();
        resolveWebWikilinks("[[nosuchtype/x|Nothing]]", c as never);
        expect(c.errors[0]).toMatchObject({ reason: "unknown-type" });
    });

    it("reports a target that is not an address at all", () => {
        const c = ctx();
        resolveWebWikilinks("[[Sunless Vault|the vault]]", c as never);
        expect(c.errors[0]).toMatchObject({ reason: "not-an-address" });
    });

    it("reports a site-section address whose page does not exist", () => {
        const c = ctx();
        resolveWebWikilinks("[[kb/nosuch|Nothing]]", c as never);
        expect(c.errors[0]).toMatchObject({ reason: "unresolved" });
    });

    it("reports an address two packages publish as ambiguous", () => {
        const c = ctx({ collide: new Set<string>(["creature/wolf"]) });
        resolveWebWikilinks("[[creature-wolf|a wolf]]", c as never);
        expect(c.errors[0]).toMatchObject({ reason: "ambiguous" });
    });

    it("still passes an address that resolved to a package with no page", () => {
        // A pack-only package (#1516) publishes Foundry addresses and no pages,
        // so the address is real and there is simply nothing to link to. It was
        // never the unresolved case and must not become one.
        const c = ctx({
            foreign: new Map<string, object>([["creature/wolf", { name: "Dire Wolf" }]]),
        });
        expect(resolveWebWikilinks("a [[creature-wolf|]] howls", c as never)).toBe(
            "a Dire Wolf howls",
        );
        expect(c.errors).toEqual([]);
    });
});

/* ---------------------------------------------------------------------- */
/*  The agreement itself                                                  */
/* ---------------------------------------------------------------------- */

describe("the three resolvers agree on severity", () => {
    /**
     * One authored link per failure class, read by all three resolvers.
     *
     * The corpus is the same in each: a `skill` note `skill-clmb` exists and
     * nothing else does. Each row asserts the class every resolver assigns —
     * so a resolver that softens one, or names it differently, fails here
     * rather than in a consumer's build.
     */
    const CLASSES: Array<{ link: string; reason: string }> = [
        { link: "[[skill-clmb]]", reason: "unlabelled" },
        { link: "[[Sunless Vault|the vault]]", reason: "not-an-address" },
        { link: "[[nosuchtype/x|Nothing]]", reason: "unknown-type" },
        { link: "[[skill-nosuch|Nothing]]", reason: "unresolved" },
    ];

    const DOCS = [{ type: "skill", id: "aaaaaaaaaaaaaaa1", shortcode: "clmb", name: "Climbing" }];

    for (const { link, reason } of CLASSES) {
        it(`treats ${link} as "${reason}" in all three`, () => {
            // 1 — the checker.
            const r = audit(corpus(`See ${link}.`));
            const checkerFindings = [
                ...r.deadAddresses.map((d: any) => d.reason),
                ...r.unlabelledLinks.map(() => "unlabelled"),
            ];
            expect(checkerFindings, "checker").toEqual([reason]);

            // 2 — the pack build.
            const packIndex = buildWikilinkIndex(DOCS, "sohl");
            const pack = convertWikilinks(link, {
                type: "skill",
                id: "aaaaaaaaaaaaaaa2",
                index: packIndex,
            });
            expect(
                pack.unresolved.map((u: any) => u.reason),
                "pack build",
            ).toEqual([reason]);

            // 3 — the site build.
            const errors: Record<string, unknown>[] = [];
            resolveWebWikilinks(link, {
                index: new Map<string, object>([
                    ["skill/clmb", { url: "/kb/skill/climbing/", name: "Climbing" }],
                ]),
                collide: new Set<string>(),
                sections: new Set<string>(["kb"]),
                contentTypes: new Set<string>(["skill"]),
                foreign: new Map<string, object>(),
                type: "skill",
                errors,
                src: "Skills/Jumping.md",
            } as never);
            expect(
                errors.map((e) => e.reason),
                "site build",
            ).toEqual([reason]);
        });
    }

    it("passes a link that resolves, in all three", () => {
        const link = "[[skill-clmb|Climbing]]";
        const r = audit(corpus(`See ${link}.`));
        expect(r.deadAddresses).toEqual([]);
        expect(r.unlabelledLinks).toEqual([]);

        const pack = convertWikilinks(link, {
            type: "skill",
            id: "aaaaaaaaaaaaaaa2",
            index: buildWikilinkIndex(DOCS, "sohl"),
        });
        expect(pack.unresolved).toEqual([]);

        const errors: Record<string, unknown>[] = [];
        resolveWebWikilinks(link, {
            index: new Map<string, object>([
                ["skill/clmb", { url: "/kb/skill/climbing/", name: "Climbing" }],
            ]),
            collide: new Set<string>(),
            sections: new Set<string>(["kb"]),
            contentTypes: new Set<string>(["skill"]),
            foreign: new Map<string, object>(),
            type: "skill",
            errors,
            src: "Skills/Jumping.md",
        } as never);
        expect(errors).toEqual([]);
    });
});

/* ---------------------------------------------------------------------- */
/*  The command line                                                      */
/* ---------------------------------------------------------------------- */

describe("`content-build links` refuses a tree with an unresolved address", () => {
    /**
     * A throwaway consumer repository: the smallest configuration that
     * resolves, plus a content tree with one dead address.
     */
    function repo(body: string): string {
        return tree(
            {
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
                "assets/content/Skills/Climbing.md": note({
                    type: "skill",
                    shortcode: "clmb",
                    name: { full: "Climbing" },
                }),
                "assets/content/Skills/Jumping.md": note(
                    { type: "skill", shortcode: "jmp", name: { full: "Jumping" } },
                    body,
                ),
            },
            "unresolved-cli-",
        );
    }

    function links(root: string) {
        const env = { ...process.env };
        env.PACKAGE_BUILD_CONFIG = path.join(root, "package-build.config.yaml");
        const r = spawnSync(process.execPath, [BIN, "links"], {
            cwd: root,
            env,
            encoding: "utf8",
        });
        return { code: r.status, shown: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    }

    it("exits non-zero, with a compiler-parseable diagnostic naming note and link", () => {
        const { code, shown } = links(repo("See [[skill-nosuch|Nothing]] here."));
        expect(code).not.toBe(0);
        // `file:line:column: error: message`, the path starting the line.
        const line = shown
            .split("\n")
            .find((l) => l.includes("skill-nosuch") && l.includes("error:"));
        expect(line).toBeDefined();
        // The path may be relative or absolute — a temporary directory reached
        // through a symlink relativizes to neither cleanly — but it starts the
        // line either way, which is the rule a parser depends on.
        expect(line).toMatch(
            /^\S*assets\/content\/Skills\/Jumping\.md:\d+:\d+: error: .*skill-nosuch/,
        );
    });

    it("exits zero on a tree whose every address resolves", () => {
        const { code } = links(repo("See [[skill-clmb|Climbing]] here."));
        expect(code).toBe(0);
    });
});
