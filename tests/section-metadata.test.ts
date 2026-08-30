/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * What a section may say about itself, and how it reaches the page.
 *
 * A generated section landing is the only place a section can describe itself:
 * `sohl` has no authored `_index.md` for `weapongear` or `affliction`, so the
 * file the theme reads is the one this build writes. Until #91 the vocabulary
 * was two keys — `title` and `banner` — declared in *two* places that had to be
 * kept in step by hand: `SECTION_META_KEYS`, which decides what a configuration
 * may say, and the two writers, which each named the keys they transcribed.
 *
 * The pair is the defect. The schema is the bound worth having; the transcription
 * is not, because a key added to one and forgotten in the other validates and
 * then goes nowhere. So the writers stop naming keys and emit what the section
 * declared, and the vocabulary is extended in the schema alone.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    pageFrontmatter,
    writeSectionLandings,
} from "../engine/site-build.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";

/** A throwaway mount directory. */
function mount(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "pb-sect-"));
}

/** The smallest data configuration that resolves, plus a `site` block. */
function resolveWithSite(site: Record<string, unknown>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-sect-cfg-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    return configFromData(
        {
            contentPackage: "sohl",
            packageKind: "systems",
            compatibility: { minimum: "14.359" },
            stats: { systemId: "sohl", lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            site: { out: "kb/content", ...site },
        },
        path.join(root, `${CONFIG_BASENAME}.yaml`),
    );
}

describe("a section can describe itself", () => {
    it("carries a declared description into the generated landing", () => {
        // `partials/hero-banner.html` already renders `description` as the hero
        // standfirst on any page that has one, so before this every generated
        // section landing rendered a hero with a heading and no standfirst —
        // and could not be given one, at any level, by any consumer (#91).
        const out = mount();
        writeSectionLandings(out, {
            sections: {
                affliction: {
                    title: "Afflictions",
                    banner: "banners/affliction.webp",
                    description: "Ailments, poisons and the diseases they run.",
                },
            },
        });
        expect(
            fs.readFileSync(path.join(out, "affliction/_index.md"), "utf8"),
        ).toBe(
            "---\ntitle: Afflictions\nbanner: banners/affliction.webp\n" +
                "description: 'Ailments, poisons and the diseases they run.'\n" +
                "---\n\n",
        );
        fs.rmSync(out, { recursive: true });
    });

    it("carries it onto a README-backed section landing too", () => {
        // The three prose cards on `/sohl/kb/` are README-backed sections, and
        // they are exactly the ones whose descriptions live only in local
        // templating today. A fix that reached the generated landings and not
        // these would leave that half unmovable.
        const page = {
            kind: "tree",
            rel: "README.md",
            sec: "dev-docs",
            name: "README",
            isReadme: true,
            fm: {},
        };
        const data = pageFrontmatter(page as never, {
            readmeSections: {
                "dev-docs": {
                    title: "Developer Documentation",
                    banner: "banners/dev-docs.webp",
                    description: "Architecture, extension points, testing.",
                },
            },
        });
        expect(data.description).toBe(
            "Architecture, extension points, testing.",
        );
    });

    it("carries it onto a content section's own README", () => {
        const data = pageFrontmatter(
            {
                kind: "content",
                sec: "rules",
                name: "README",
                slug: "rules",
                pkg: "sohl",
                folder: "rules",
                isReadme: true,
                fm: {},
            } as never,
            {
                readmeSections: {
                    rules: {
                        title: "Rules",
                        description: "How play resolves.",
                    },
                },
            },
        );
        expect(data.title).toBe("Rules");
        expect(data.description).toBe("How play resolves.");
    });
});

describe("the writers emit what the section declared", () => {
    it("does not transcribe a named list of keys", () => {
        // The anti-drift guarantee, stated at the seam it protects: whatever
        // the schema lets a section declare reaches the file without this
        // function being edited. The bound is `SECTION_META_KEYS`, asserted
        // below — not a second list here.
        const out = mount();
        writeSectionLandings(out, {
            sections: { being: { title: "Beings", group: "Actors" } },
        });
        expect(
            fs.readFileSync(path.join(out, "being/_index.md"), "utf8"),
        ).toContain("group: Actors");
        fs.rmSync(out, { recursive: true });
    });

    it("still writes a title first, and omits an absent value", () => {
        // `banner: undefined` is not a value YAML can carry, and `title` leads
        // the block on every landing the build has ever written.
        const out = mount();
        writeSectionLandings(out, {
            sections: {
                credits: {
                    banner: undefined,
                    description: "Attributions.",
                    title: "Credits",
                },
            },
        });
        expect(
            fs.readFileSync(path.join(out, "credits/_index.md"), "utf8"),
        ).toBe("---\ntitle: Credits\ndescription: Attributions.\n---\n\n");
        fs.rmSync(out, { recursive: true });
    });
});

describe("a section that declares nothing new emits what it always did", () => {
    // The proof that this is additive. These are the exact bytes the build
    // wrote before #91, for the only two shapes any of the six consuming
    // packages declares today.
    it("writes a title-and-banner section byte for byte as before", () => {
        const out = mount();
        writeSectionLandings(out, {
            sections: {
                being: { title: "Beings", banner: "banners/creature.webp" },
                credits: { title: "Credits" },
            },
            landing: { title: "Knowledgebase", type: "knowledgebase" },
        });
        expect(fs.readFileSync(path.join(out, "_index.md"), "utf8")).toBe(
            "---\ntitle: Knowledgebase\ntype: knowledgebase\n---\n\n",
        );
        expect(fs.readFileSync(path.join(out, "being/_index.md"), "utf8")).toBe(
            "---\ntitle: Beings\nbanner: banners/creature.webp\n---\n\n",
        );
        expect(
            fs.readFileSync(path.join(out, "credits/_index.md"), "utf8"),
        ).toBe("---\ntitle: Credits\n---\n\n");
        fs.rmSync(out, { recursive: true });
    });

    it("backfills a section no configuration supplies, unchanged", () => {
        const out = mount();
        fs.mkdirSync(path.join(out, "macro"), { recursive: true });
        writeSectionLandings(out, { sectionTitle: (n: string) => n });
        expect(fs.readFileSync(path.join(out, "macro/_index.md"), "utf8")).toBe(
            "---\ntitle: macro\n---\n\n",
        );
        fs.rmSync(out, { recursive: true });
    });
});

describe("the configuration is where the vocabulary is bounded", () => {
    it("accepts a description under a declared section", () => {
        const config = resolveWithSite({
            sections: {
                affliction: { title: "Afflictions", description: "Ailments." },
            },
        });
        expect(config.site.sections.affliction.description).toBe("Ailments.");
    });

    it("accepts one under a README-backed section as well", () => {
        const config = resolveWithSite({
            readmeSections: {
                "dev-docs": {
                    title: "Developer Documentation",
                    description: "Docs.",
                },
            },
        });
        expect(config.site.readmeSections["dev-docs"].description).toBe(
            "Docs.",
        );
    });

    it("refuses an empty description rather than emitting a blank standfirst", () => {
        expect(() =>
            resolveWithSite({
                sections: { x: { title: "X", description: "" } },
            }),
        ).toThrow(
            /`site\.sections\.x\.description` must be a non-empty string/,
        );
    });

    it("still refuses a key it does not recognise, naming its path", () => {
        // Deliberate, and unchanged by #91. The writers are now a passthrough,
        // so this is the *only* thing standing between a mistyped `descrption:`
        // and a key that publishes into front matter and is read by nobody —
        // which is the failure this issue was filed about, one step downstream.
        expect(() =>
            resolveWithSite({
                sections: { x: { title: "X", descrption: "typo" } },
            }),
        ).toThrow(/site\.sections\.x\.descrption/);
    });

    it("names the vocabulary in the refusal, so the fix is in the message", () => {
        expect(() =>
            resolveWithSite({ sections: { x: { title: "X", nope: 1 } } }),
        ).toThrow(/expected one of: title, banner, description/);
    });
});
