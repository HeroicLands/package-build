/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Emitting a link manifest from configuration (#58).
 *
 * `writeManifests` could always write one; nothing could *derive* one, so every
 * publishing repository wrote the walk itself and the two that did drifted. The
 * cases here pin the derivation: the address scheme each consumer needs, the
 * anchors that must never be silently dropped, and the two independent halves
 * of an entry's address — a `path` only where the build publishes pages, a
 * `uuid` only where the note compiles into a document.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import {
    collectManifestEntries,
    emitLinkManifest,
    manifestContext,
    anchorsOf,
    LEAD_ANCHOR,
} from "../engine/manifest-emit.mjs";
import { packageAddress } from "../engine/content-address.mjs";
import { readCanonicalKey } from "../engine/kb-manifest.mjs";

/** The manifest document's shape — see the note in `kb-manifest.test.ts`. */
interface Manifest {
    version: number;
    package: string;
    foundryPackage?: string;
    entries: Record<
        string,
        {
            path?: string;
            name: string;
            uuid?: string;
            doc?: string;
            anchors?: Record<string, string>;
        }
    >;
}

let root: string;

/** A note file, written into the sandbox tree. */
function note(rel: string, frontmatter: string, body = "") {
    const file = path.join(root, "assets/content", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${frontmatter.trim()}\n---\n\n${body}`);
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-manifest-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );

    // An ordinary item note: two documents, so two entries.
    note(
        "Gear/Dagger.md",
        `type: weapongear
shortcode: dagger
id: aaaaaaaaaaaaaaaa
name:
    full: Dagger`,
        "Lead prose.\n\n## Crafting {#crafting}\n\nHow it is made.\n",
    );

    // A `doc` note routes by its subtype, and owns its own anchors.
    note(
        "Rules/Combat.md",
        `type: doc
subType: rules
shortcode: combat
id: bbbbbbbbbbbbbbbb
name:
    full: Combat`,
        "Opening.\n\n## Melee {#melee}\n\nSwinging.\n",
    );

    // A section landing page under the `readme` rule.
    note(
        "Rules/README.md",
        `type: doc
subType: rules
shortcode: rulesidx
id: cccccccccccccccc
name:
    full: The Rules`,
    );

    // A collection note — a page under `readme`, a landing page under
    // `collection`.
    note(
        "Creatures.md",
        `type: doc
subType: collection
section: creature
shortcode: creatures
id: dddddddddddddddd
name:
    full: Creatures`,
    );

    // No section: a `doc` with no subtype has no address at all.
    note(
        "Rules/Homeless.md",
        `type: doc
shortcode: homeless
id: 1111111111111111
name:
    full: Homeless`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function configFor(publish: Record<string, unknown>) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo-module",
        packageKind: "modules",
        stats: {
            lastModifiedBy: "demobuilder0000",
        },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish,
    });
}

function emit(publish: Record<string, unknown>): Manifest {
    const config = configFor(publish);
    const out = path.join(root, "out", String(Math.random()).slice(2));
    emitLinkManifest({ config, outDir: out });
    return JSON.parse(fs.readFileSync(path.join(out, "demo.json"), "utf8")) as Manifest;
}

const WEB = {
    site: "content",
    manifests: { publish: true, consume: false },
};

describe("the address scheme is configuration, and both live rules work", () => {
    it("addresses a page by `(type, shortcode)`, whatever the tree mounts at", () => {
        // The prefix says where the content *tree* sits inside the package, so
        // it addresses the section landings; an ordinary page is addressed by a
        // package-wide identity and takes no mount at all (#181).
        const doc = emit({ ...WEB, address: { prefix: "kb/" } });
        expect(doc.entries["demo-weapongear-dagger"].path).toBe("weapongear-dagger/");
        expect(doc.entries["demo-doc-combat"].path).toBe("doc-combat/");
    });

    it("addresses it identically when there is no prefix", () => {
        const doc = emit({ ...WEB });
        expect(doc.entries["demo-weapongear-dagger"].path).toBe("weapongear-dagger/");
    });

    it("`readme`: a README addresses its section, a collection is a page", () => {
        const doc = emit({ ...WEB, address: { landing: "readme", prefix: "kb/" } });
        expect(doc.entries["demo-doc-rulesidx"].path).toBe("kb/rules/");
        // The rule `sohl` relies on: its eleven collection notes are ordinary
        // pages rather than landing pages, so they take an address.
        expect(doc.entries["demo-doc-creatures"].path).toBe("doc-creatures/");
    });

    it("`collection`: a collection note addresses its authored section", () => {
        const doc = emit({ ...WEB, address: { landing: "collection" } });
        expect(doc.entries["demo-doc-creatures"].path).toBe("creature/");
        // And the README is then an ordinary page, so the two rules really are
        // alternatives rather than a pair that could both be applied.
        expect(doc.entries["demo-doc-rulesidx"].path).toBe("doc-rulesidx/");
    });

    it("a collection note naming no section is reported, never guessed", () => {
        note(
            "Nowhere.md",
            `type: doc
subType: collection
shortcode: nowhere
id: 2222222222222222
name:
    full: Nowhere`,
        );
        const ctx = manifestContext(configFor({ ...WEB, address: { landing: "collection" } }));
        const { skipped } = collectManifestEntries(path.join(root, "assets/content"), ctx);
        expect(skipped.map((s) => s.file)).toContain("Nowhere.md");
        expect(skipped.find((s) => s.file === "Nowhere.md")?.reason).toMatch(/lands nowhere/);
        fs.rmSync(path.join(root, "assets/content/Nowhere.md"));
    });
});

describe("what is published, and what is not", () => {
    it("skips a note with no section", () => {
        const doc = emit({ ...WEB });
        expect(Object.keys(doc.entries)).not.toContain("demo-doc-homeless");
    });

    it("refuses a note declaring `package:`, rather than skipping it", () => {
        // It used to be filtered out in silence, which is how a whole tree
        // could be excluded from a manifest that then claimed the package
        // publishes nothing (#56). `tests/note-package.test.ts` owns the rest
        // of that contract; here it only has to be loud in this pipeline.
        note(
            "Gear/Declares.md",
            `package: demo
type: weapongear
shortcode: declares
id: ffffffffffffffff
name:
    full: Declaring Blade`,
        );
        try {
            expect(() => emit({ ...WEB })).toThrow(/retired/);
        } finally {
            fs.rmSync(path.join(root, "assets/content/Gear/Declares.md"));
        }
    });

    it("refuses a note declaring `draft:`, rather than skipping it", () => {
        // It used to be dropped in silence, which left every wikilink into it
        // indistinguishable from a link to a note that does not exist — the
        // one state the manifest exists to prevent (#69).
        note(
            "Gear/Drafted.md",
            `type: weapongear
shortcode: drafted
draft: true
id: eeeeeeeeeeeeeeee
name:
    full: Drafted Blade`,
        );
        try {
            expect(() => emit({ ...WEB })).toThrow(/`draft:` is a retired/);
        } finally {
            fs.rmSync(path.join(root, "assets/content/Gear/Drafted.md"));
        }
    });

    it("reports an unaddressable note rather than dropping it silently", () => {
        const ctx = manifestContext(configFor(WEB));
        const { skipped } = collectManifestEntries(path.join(root, "assets/content"), ctx);
        expect(skipped.map((s) => s.file)).toContain(path.join("Rules", "Homeless.md"));
    });

    it("gives an item note two entries, the item pointing at its docs", () => {
        const doc = emit({ ...WEB });
        const item = doc.entries["demo-weapongear-dagger"];
        expect(item.doc).toBe("demo-docweapongear-dagger");
        // The doc entry owns the documentation UUID; the item does not repeat
        // it (#1499).
        expect(item.uuid).toBe("Compendium.demo-module.items.Item.aaaaaaaaaaaaaaaa");
        expect(doc.entries["demo-docweapongear-dagger"].uuid).toMatch(
            /^Compendium\.demo-module\.journals\.JournalEntry\./,
        );
    });
});

describe("anchors are computed, never approximated", () => {
    it("maps every named section to a whole page UUID", () => {
        const doc = emit({ ...WEB });
        const anchors = doc.entries["demo-docweapongear-dagger"].anchors!;
        expect(Object.keys(anchors).sort()).toEqual([LEAD_ANCHOR, "crafting"]);
        // Whole UUIDs, so a consumer resolves a section link by lookup rather
        // than by reimplementing the page-id hash.
        expect(anchors.crafting).toMatch(
            /^Compendium\.demo-module\.journals\.JournalEntry\.[^.]+\.JournalEntryPage\./,
        );
        expect(anchors.crafting).not.toBe(anchors[LEAD_ANCHOR]);
    });

    it("puts a `doc` note's anchors on its own entry", () => {
        const doc = emit({ ...WEB });
        expect(Object.keys(doc.entries["demo-doc-combat"].anchors!)).toContain("melee");
    });

    it("names the lead page, which carries no authored slug of its own", () => {
        const anchors = anchorsOf("Compendium.p.j.JournalEntry.x", "x", "Prose.", "N");
        expect(anchors[LEAD_ANCHOR]).toBe(
            "Compendium.p.j.JournalEntry.x.JournalEntryPage." +
                Object.values(anchors)[0].split(".").pop(),
        );
    });

    it("has nothing to anchor when a note has no prose", () => {
        // `splitPages` yields no pages for an empty body, so there is no lead
        // page and therefore no `$lead`. Asserting the absence rather than
        // papering over it: inventing an anchor here would publish a page UUID
        // for a page the journals compiler never emitted.
        expect(anchorsOf("Compendium.p.j.JournalEntry.x", "x", "", "N")).toEqual({});
    });
});

describe("both addresses are optional, independently (#1516)", () => {
    it("emits no `path` when the build publishes only a homepage", () => {
        const doc = emit({ site: "homepage", manifests: { publish: true } });
        for (const entry of Object.values(doc.entries)) {
            expect(entry.path).toBeUndefined();
        }
        // …but the Foundry addresses are still there, which is the whole point
        // of a pack-only manifest.
        expect(doc.entries["demo-weapongear-dagger"].uuid).toBeDefined();
    });

    it("emits no `uuid` for a note that compiles into no document", () => {
        note(
            "Gear/Idless.md",
            `type: weapongear
shortcode: idless
name:
    full: Idless Blade`,
        );
        const doc = emit({ ...WEB });
        const entry = doc.entries["demo-weapongear-idless"];
        expect(entry.path).toBe("weapongear-idless/");
        expect(entry.uuid).toBeUndefined();
        expect(doc.entries["demo-docweapongear-idless"].uuid).toBeUndefined();
        fs.rmSync(path.join(root, "assets/content/Gear/Idless.md"));
    });
});

describe("the manifest names the package the configuration declares", () => {
    it("emits exactly one, for `contentPackage`", () => {
        const config = configFor(WEB);
        const out = path.join(root, "out-one");
        const { written } = emitLinkManifest({ config, outDir: out });
        expect(written.map((w) => w.package)).toEqual(["demo"]);
        expect(fs.readdirSync(out)).toEqual(["demo.json"]);
    });

    it("records the Foundry package the documents ship in", () => {
        expect(emit(WEB).foundryPackage).toBe("demo-module");
    });

    it("refuses to claim a package publishes nothing", () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cb-empty-"));
        expect(() =>
            emitLinkManifest({
                config: configFor(WEB),
                contentBase: empty,
                outDir: path.join(root, "out-empty"),
            }),
        ).toThrow(/publishes nothing/);
        fs.rmSync(empty, { recursive: true, force: true });
    });

    it("refuses to emit one the repository has not declared it publishes", () => {
        // The switch is a declaration, not a preference: the file is vendored
        // by consumers and read as authoritative. Enforced in the library, so a
        // caller that bypasses the command cannot bypass the declaration.
        expect(() =>
            emitLinkManifest({
                config: configFor({ site: "content" }),
                outDir: path.join(root, "out-undeclared"),
            }),
        ).toThrow(/does not publish a link manifest/);
        expect(fs.existsSync(path.join(root, "out-undeclared"))).toBe(false);
    });

    it("refuses a content tree that is not there", () => {
        expect(() =>
            emitLinkManifest({
                config: configFor(WEB),
                contentBase: path.join(root, "absent"),
                outDir: path.join(root, "out-absent"),
            }),
        ).toThrow(/no content tree/);
    });
});

describe("the emitted address is the one the site publishes", () => {
    it("is derived by the same function, so the two cannot drift", () => {
        // Not a tautology: the point is that nothing in the emitter composes an
        // address of its own. A page built from `packageAddress` under the same
        // scheme is the string the manifest records, character for character.
        const fm = { type: "weapongear", shortcode: "dagger" };
        const scheme = { prefix: "kb/", landing: "readme" };
        expect(packageAddress(fm, { scheme })).toBe(
            emit({ ...WEB, address: scheme }).entries["demo-weapongear-dagger"].path,
        );
    });

    it("is derivable from the key it is filed under (#181)", () => {
        // The manifest still writes `path` — a landing page is the one entry
        // that is not derivable, and an absent `path` already means something
        // else — but for every ordinary page a consumer can compute it from the
        // key alone, with no knowledge of the emitting repository's scheme.
        const doc = emit({ ...WEB, address: { prefix: "kb/", landing: "readme" } });
        // A landing page addresses the section it *is*, under the content
        // mount, so it is the one entry whose path is not its address.
        const landings = new Set(["demo-doc-rulesidx"]);
        for (const [key, entry] of Object.entries(doc.entries)) {
            if (landings.has(key)) continue;
            const parts = readCanonicalKey(key)!;
            // On the web an item note renders as one page which *is* its
            // documentation, so `docweapongear-dagger` resolves to the item's
            // own address — a pre-existing aliasing of two Foundry documents
            // onto one page, not an exception to the rule.
            const type = parts.type.replace(/^doc(?=.)/, "");
            expect(entry.path, key).toBe(`${type}-${parts.shortcode}/`);
        }
    });

    it("is stable across a rename, because no part of it is a name", () => {
        const before = emit({ ...WEB }).entries["demo-weapongear-dagger"].path;
        const file = path.join(root, "assets/content/Gear/Dagger.md");
        const original = fs.readFileSync(file, "utf8");
        try {
            fs.writeFileSync(file, original.replace("full: Dagger", "full: A Very Fine Dagger"));
            const after = emit({ ...WEB }).entries["demo-weapongear-dagger"];
            expect(after.path).toBe(before);
            // The name moved, which is the only thing a rename is allowed to
            // move: it labels an inbound link and titles the page.
            expect(after.name).toBe("A Very Fine Dagger");
        } finally {
            fs.writeFileSync(file, original);
        }
    });
});
