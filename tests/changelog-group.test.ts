/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `changelog group` folds a release section's changeset blocks together by
 * their bold label — `@heroiclands/package-build/changelog` writes one
 * block per changeset, so three pull requests each touching compendium
 * content leave three separate `**Compendiums**` blocks instead of one.
 *
 * The fixture (`tests/fixtures/changelog/ungrouped.md`) carries a newest
 * `## 0.1.0` section with, in file order: three `**Compendiums**` blocks,
 * an unlabelled lead paragraph, one `**Website**` block, one
 * `**Characters**` block, and one `**Scenery**` block — a label
 * `changelog.labels` below never declares. An older `## 0.0.9` section
 * follows, carrying its own `**Compendiums**` bullet that duplicates text
 * in the newest section, to prove `group` never reaches across a release
 * boundary.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { groupChangelogText } from "../engine/changelog-group.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "tests", "fixtures", "changelog");

const UNGROUPED = fs.readFileSync(path.join(FIXTURES, "ungrouped.md"), "utf8");
const GROUPED_WITH_LABELS = fs.readFileSync(path.join(FIXTURES, "grouped-with-labels.md"), "utf8");
const GROUPED_NO_LABELS = fs.readFileSync(path.join(FIXTURES, "grouped-no-labels.md"), "utf8");
const WRAPPED_PARAGRAPH_22_4_3 = fs.readFileSync(
    path.join(FIXTURES, "wrapped-paragraph-22.4.3.md"),
    "utf8",
);

const LABELS = ["Compendiums", "Characters", "Website"];

/** The `## 0.0.9` section onward — everything `group` must never touch. */
function olderSections(text: string): string {
    const at = text.indexOf("## 0.0.9");
    if (at === -1) throw new Error('fixture does not contain "## 0.0.9"');
    return text.slice(at);
}

describe("changelog group — merges, orders and labels", () => {
    it("merges the three `**Compendiums**` blocks into one, bullets in file order, an exact duplicate once", () => {
        const { text } = groupChangelogText(UNGROUPED, { labels: LABELS });
        const match = /\*\*Compendiums\*\*\n\n((?:- .+\n?)+)/.exec(text);
        expect(match, "expected one merged `**Compendiums**` block").not.toBeNull();
        const bullets = match![1].trim().split("\n");
        expect(bullets).toEqual([
            "- Adds the Ranger's Lodge pack to the compendium.",
            "- Fixes a broken link in the Windwatch camp journal.",
            "- Retitles the Elven ranger set to match the catalog.",
            "- Adds cover art to three journal entries.",
        ]);
        // Only one `**Compendiums**` heading in the newest section — the
        // three are merged into one, not left as three consecutive blocks.
        const newest = text.slice(0, text.indexOf("## 0.0.9"));
        expect(newest.match(/\*\*Compendiums\*\*/g)).toHaveLength(1);
    });

    it("orders [lead, Compendiums, Characters, Website], `**Scenery**` last with a warning naming it", () => {
        const { text, findings } = groupChangelogText(UNGROUPED, { labels: LABELS });
        const newest = text.slice(0, text.indexOf("## 0.0.9"));
        const order = [...newest.matchAll(/^\*\*(\w+)\*\*$/gm)].map((m) => m[1]);
        expect(order).toEqual(["Compendiums", "Characters", "Website", "Scenery"]);
        // The lead paragraph sorts ahead of every labelled block.
        expect(newest.indexOf("This release folds")).toBeLessThan(
            newest.indexOf("**Compendiums**"),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
        expect(findings[0].message).toContain('"Scenery"');
        expect(findings[0].message).toContain("changelog.labels");
    });

    it("matches the rendered fixture byte for byte", () => {
        const { text } = groupChangelogText(UNGROUPED, { labels: LABELS });
        expect(text).toBe(GROUPED_WITH_LABELS);
    });

    it("with no `changelog.labels`, orders every group by first appearance, lead first", () => {
        const { text, findings } = groupChangelogText(UNGROUPED, {});
        expect(text).toBe(GROUPED_NO_LABELS);
        expect(findings).toEqual([]);

        const newest = text.slice(0, text.indexOf("## 0.0.9"));
        const order = [...newest.matchAll(/^\*\*(\w+)\*\*$/gm)].map((m) => m[1]);
        // First appearance in the ungrouped fixture: Compendiums, then
        // (after the lead paragraph) Website, Characters, Scenery.
        expect(order).toEqual(["Compendiums", "Website", "Characters", "Scenery"]);
        expect(newest.indexOf("This release folds")).toBeLessThan(
            newest.indexOf("**Compendiums**"),
        );
    });

    it("running group twice is a no-op — byte-identical output", () => {
        const once = groupChangelogText(UNGROUPED, { labels: LABELS });
        const twice = groupChangelogText(once.text, { labels: LABELS });
        expect(twice.text).toBe(once.text);
        // The warning survives the second pass too — `Scenery` is still not
        // declared — reported at wherever it now sits in the regrouped file.
        expect(twice.findings).toHaveLength(1);
        expect(twice.findings[0].message).toBe(once.findings[0].message);
    });

    it("running group twice with no `changelog.labels` is also a no-op", () => {
        const once = groupChangelogText(UNGROUPED, {});
        const twice = groupChangelogText(once.text, {});
        expect(twice.text).toBe(once.text);
    });

    it("leaves the older `## 0.0.9` section byte-identical", () => {
        const { text } = groupChangelogText(UNGROUPED, { labels: LABELS });
        expect(olderSections(text)).toBe(olderSections(UNGROUPED));
    });

    it("a changelog with no `## <version>` heading passes through unchanged", () => {
        const text = "Just some prose, no release section at all.\n";
        expect(groupChangelogText(text, { labels: LABELS })).toEqual({ text, findings: [] });
    });

    it("leaves a section of two already-grouped, hard-wrapped blocks byte-identical", () => {
        // The real `## 22.4.3` section `changeset version` wrote before
        // `changelog group` ran on it: two bold-label blocks, each a
        // hard-wrapped paragraph at column 0. Already grouped and ordered —
        // `group` must not fragment the wrapped lines into blocks of their
        // own and reorder them.
        const { text, findings } = groupChangelogText(WRAPPED_PARAGRAPH_22_4_3, {});
        expect(text).toBe(WRAPPED_PARAGRAPH_22_4_3);
        expect(findings).toEqual([]);
    });
});
