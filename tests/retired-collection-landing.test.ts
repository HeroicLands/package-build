/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The `collection` landing rule is retired (#202).
 *
 * A section is landed by its `README.md`, and that is now the only rule. The
 * second one — a `doc` note whose `subType` was `collection`, addressing the
 * section named by an authored top-level `section:` — had no user left in any
 * content tree, and two things kept it from being harmless while it stayed:
 *
 * - **The two builds that must agree about an address did not implement it.**
 *   `engine/content-address.mjs` branched on the configured rule while
 *   `engine/site-build.mjs` never read it, so under `landing: collection` the
 *   link manifest and the site would have disagreed about where a page is.
 * - **`section:` was read by that branch and by nothing else**, and no schema
 *   or vocabulary declared it — so under `readme` a note declaring it was
 *   ignored in silence.
 *
 * Both halves are therefore *refused* rather than ignored, the way `draft:`
 * (#69), `package:` (#56) and `aliases:` (#180) are: a retired thing left
 * merely ignored reads to its author as though it still works.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";
import { LANDING_RULES, packageAddress } from "../engine/content-address.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { assertNoSectionField, sectionRetiredMessage } from "../engine/retired-fields.mjs";
import { NOTE_LEVEL_KEYS } from "../engine/content-format-check.mjs";

/** The smallest configuration `defineConfig` accepts. */
function minimal(): ContentBuildConfigInput {
    return {
        rootDir: "/repo",
        contentPackage: "sohl",
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: { lastModifiedBy: "sohlbuilder00000" },
        packs: [{ name: "items", type: "Item" }],
        compatibility: { minimum: "14.359", verified: "14.359" },
    };
}

const address = (value: unknown) =>
    defineConfig({ ...minimal(), publish: { site: "content", address: value } }).publish.address;

describe("`landing: collection` is refused, not merely unrecognized (#202)", () => {
    it("leaves `readme` alone — it is the rule, and both live consumers declare it", () => {
        // The whole point of keeping the key: `sohl` and `sohl-thalorna` both
        // write `landing: readme` today, and neither should have to change to
        // take this release.
        expect(address({ landing: "readme" }).landing).toBe("readme");
        expect(address({}).landing).toBe("readme");
    });

    it("says the rule is retired and how a section is landed now", () => {
        // Not a bare "must be one of readme": that names the value to correct
        // and leaves the author to work out that the mechanism is gone.
        let thrown: any;
        try {
            address({ landing: "collection" });
        } catch (err) {
            thrown = err;
        }
        expect(thrown, "should have refused the value").toBeDefined();
        expect(thrown.message).toMatch(/retired/);
        // Names what an introduction page is now, rather than a value to fix.
        expect(thrown.message).toMatch(/doc-<type>/);
        // The locator the loader resolves to a line and column (#95).
        expect(thrown.field).toBe("publish.address.landing");
    });

    it("still names the rules for a value that is simply misspelt", () => {
        // A typo is a different finding from a retirement, and keeps the
        // did-you-mean shape it always had — now with one rule to name.
        expect(() => address({ landing: "readmes" })).toThrow(/readme/);
        expect(() => address({ landing: "readmes" })).not.toThrow(/retired/);
    });

    it("leaves one landing rule in the vocabulary", () => {
        expect([...LANDING_RULES]).toEqual(["readme"]);
    });
});

describe("`section:` is a retired frontmatter field (#202)", () => {
    let tmp: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retired-section-"));
    });

    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    /** A note file whose frontmatter the caller supplies verbatim. */
    function write(name: string, frontmatter: string[]): string {
        const file = path.join(tmp, `${name}.md`);
        fs.writeFileSync(file, `---\n${frontmatter.join("\n")}\n---\n\nProse.\n`, "utf8");
        return file;
    }

    it("passes a note that does not declare it", () => {
        expect(() => assertNoSectionField({ type: "doc", shortcode: "clean" })).not.toThrow();
        expect(() => assertNoSectionField(null)).not.toThrow();
        expect(() => assertNoSectionField(undefined)).not.toThrow();
    });

    it("refuses the field, whatever its value", () => {
        // Presence is the whole test: no value makes declaring it right, since
        // nothing reads it any more.
        expect(() => assertNoSectionField({ type: "doc", section: "being" })).toThrow(
            /retired frontmatter field/,
        );
        expect(() => assertNoSectionField({ type: "doc", section: "" })).toThrow(
            /retired frontmatter field/,
        );
    });

    it("locates the offending line, for a caller that emits a diagnostic", () => {
        const file = write("located", [
            "type: doc",
            "subType: rules",
            "shortcode: located",
            "section: being",
        ]);
        try {
            assertNoSectionField({ type: "doc", section: "being" }, { absPath: file });
            expect.unreachable("should have refused the note");
        } catch (err) {
            expect((err as any).position).toEqual({ line: 5, column: 1 });
        }
    });

    it("says what the field did and what an introduction page is instead", () => {
        const message = sectionRetiredMessage();
        expect(message).toContain("retired");
        expect(message).toContain("doc-<type>");
        // The path is named only where the caller has no locator of its own.
        expect(sectionRetiredMessage("Rules/Gear.md")).toContain("Rules/Gear.md");
    });

    it("is reported by the frontmatter lint as well as refused at compile", () => {
        const raw = [
            "---",
            "type: doc",
            "subType: rules",
            "shortcode: linted",
            "section: being",
            "---",
            "",
            "Prose.",
        ].join("\n");
        const findings = lintNote(
            {
                fm: { type: "doc", subType: "rules", shortcode: "linted", section: "being" },
                file: "Rules/Linted.md",
                raw,
            } as any,
            { schemas: {} },
        );
        const hits = findings.filter((f: any) => /retired frontmatter field/.test(f.message));
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ file: "Rules/Linted.md", line: 5, severity: "error" });
    });

    it("is not one of the note-level keys the format names", () => {
        expect(NOTE_LEVEL_KEYS.has("section")).toBe(false);
    });
});

describe("what survives the retirement in `packageAddress` (#202)", () => {
    it("lands no README at a section, because there are no landings (#204)", () => {
        // The surviving rule went the same way one release later: a `README.md`
        // is an ordinary note, addressed like every other.
        const fm = { type: "doc", subType: "rules", shortcode: "rulesintro" };
        expect(packageAddress(fm, { scheme: { prefix: "kb/" } })).toBe("doc-rulesintro/");
    });

    it("no longer reads `section:` for anyone", () => {
        // The note is an ordinary page addressed by `(type, shortcode)`; the
        // retired key names nothing and moves nothing.
        const fm = { type: "doc", subType: "rules", shortcode: "gearrules", section: "being" };
        expect(packageAddress(fm, { scheme: { prefix: "kb/" } })).toBe("doc-gearrules/");
    });
});
