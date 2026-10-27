/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `changelog group` turns Changesets' output into the final release section:
 * no `### <Bump> Changes` headings, one block per label, the order
 * `changelog.labels` declares, and `**Miscellaneous**` last.
 *
 * The fixture (`tests/fixtures/changelog/changesets-output.md`) is shaped like
 * real Changesets output — a `## 2.0.0` heading, then `### Major Changes`,
 * `### Minor Changes` and `### Patch Changes`, each holding the summaries
 * `changelog.cjs` writes — with labels repeated across all three. An older
 * `## 1.9.0` section follows and must never be touched.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { lintReleaseText } from "../engine/changelog-lint.mjs";
import { groupChangelogText } from "../engine/changelog-group.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "tests", "fixtures", "changelog");
const INPUT = fs.readFileSync(path.join(FIXTURES, "changesets-output.md"), "utf8");

const LABELS = ["Verse", "Rendering"];

/** The `## 1.9.0` section onward — everything `group` must never touch. */
function olderSections(text: string): string {
    const at = text.indexOf("## 1.9.0");
    if (at === -1) throw new Error('fixture does not contain "## 1.9.0"');
    return text.slice(at);
}

const EXPECTED_NEWEST = `# acme

## 2.0.0

**Verse**

- A verse fence keeps its line breaks.
- A stanza break renders as a blank line.

**Rendering**

- Every page carries its section in the contents list.
- The search page lists the newest notes first.
- A table of contents appears on long pages.
- A page without a title keeps its place in the contents list.

**Scenery**

- The harbor map gains a lighthouse marker.

**Miscellaneous**

- The tool prints a notice when a page has no title.
- An empty search no longer fails.

`;

describe("changelog group — the final shape", () => {
    it("removes every `### … Changes` heading from the newest release", () => {
        const { text } = groupChangelogText(INPUT, { labels: LABELS });
        const newest = text.slice(0, text.indexOf("## 1.9.0"));
        expect(newest).not.toMatch(/^### /m);
    });

    it("writes one block per label, in declared order, undeclared next, Miscellaneous last", () => {
        const { text } = groupChangelogText(INPUT, { labels: LABELS });
        expect(text.slice(0, text.indexOf("## 1.9.0"))).toBe(EXPECTED_NEWEST);
    });

    it("names the undeclared label in a warning", () => {
        const { findings } = groupChangelogText(INPUT, { labels: LABELS });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
        expect(findings[0].message).toContain('"Scenery"');
        expect(findings[0].message).toContain("labels");
    });

    it("never reports Miscellaneous as undeclared", () => {
        const { findings } = groupChangelogText(INPUT, { labels: [...LABELS, "Scenery"] });
        expect(findings).toEqual([]);
    });

    it("with no labels declared, orders by first appearance and Miscellaneous last", () => {
        const { text, findings } = groupChangelogText(INPUT, {});
        const newest = text.slice(0, text.indexOf("## 1.9.0"));
        const order = [...newest.matchAll(/^\*\*(\w+)\*\*$/gm)].map((m) => m[1]);
        expect(order).toEqual(["Rendering", "Verse", "Scenery", "Miscellaneous"]);
        expect(findings).toEqual([]);
    });

    it("leaves every older release byte for byte as it was", () => {
        const { text } = groupChangelogText(INPUT, { labels: LABELS });
        expect(olderSections(text)).toBe(olderSections(INPUT));
    });

    it("is a no-op on its own output", () => {
        const once = groupChangelogText(INPUT, { labels: LABELS });
        const twice = groupChangelogText(once.text, { labels: LABELS });
        expect(twice.text).toBe(once.text);
    });

    it("writes a release that `changelog check --release` accepts", () => {
        const { text } = groupChangelogText(INPUT, { labels: [...LABELS, "Scenery"] });
        const { findings } = lintReleaseText(text, { labels: [...LABELS, "Scenery"] });
        expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    });

    it("keeps a wrapped bullet whole", () => {
        const input =
            "## 1.0.0\n\n### Patch Changes\n\n**Verse**\n\n- A bullet that wraps\n  onto a second line.\n\n" +
            "### Minor Changes\n\n**Verse**\n\n- Another.\n";
        const { text } = groupChangelogText(input, { labels: LABELS });
        expect(text).toBe(
            "## 1.0.0\n\n**Verse**\n\n- A bullet that wraps\n  onto a second line.\n- Another.\n",
        );
    });

    it("drops an exact-duplicate bullet once", () => {
        const input =
            "## 1.0.0\n\n### Patch Changes\n\n**Verse**\n\n- Same.\n\n**Verse**\n\n- Same.\n- Other.\n";
        const { text } = groupChangelogText(input, { labels: LABELS });
        expect(text).toBe("## 1.0.0\n\n**Verse**\n\n- Same.\n- Other.\n");
    });

    it("does not read a `### … Changes` line inside a code fence as a heading", () => {
        const input =
            "## 1.0.0\n\n### Patch Changes\n\n**Verse**\n\n- Shows:\n\n  ```\n  ### Patch Changes\n  ```\n";
        const { text } = groupChangelogText(input, { labels: LABELS });
        expect(text).toContain("  ### Patch Changes");
        expect(text.match(/^### /gm) ?? []).toHaveLength(0);
    });

    it("leaves a changelog with no release section alone", () => {
        const input = "# acme\n";
        expect(groupChangelogText(input, { labels: LABELS }).text).toBe(input);
    });
});
