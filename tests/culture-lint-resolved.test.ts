/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

/**
 * `package-build lint` reads each note from the index record, which carries the
 * resolved `data.culture`. A tree whose cultures resolve without conflict lints
 * clean of culture findings: a culture note that omits the field, one that
 * names itself, and a place two levels below a cultured root all carry a
 * resolved value the culture checks accept.
 */
const CLI = path.resolve(__dirname, "../bin/package-build.mjs");

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "culture-lint-resolved-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: preflightbuild00 }
packs:
  - { name: journals, type: JournalEntry, default: true }
publish: {}
pdf: { books: [{ id: core, title: Demo, document: book.yaml }] }
`,
    );
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/** Write a note under the content tree, its frontmatter the given lines. */
function note(rel: string, ...lines: string[]): void {
    const full = path.join(root, "assets/content", rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `---\n${lines.join("\n")}\n---\n\nBody.\n`);
}

/** A place, its `data:` written as a flow mapping. */
function place(shortcode: string, data: string): void {
    note(
        `Places/${shortcode}.md`,
        `name: { full: ${shortcode} }`,
        `shortcode: ${shortcode}`,
        "type: place",
        "subType: settlement",
        "description: A place.",
        `data: ${data}`,
    );
}

/** The tree every case lints: two culture notes and a three-level chain of places. */
function tree(): void {
    note(
        "Lore/Vedyari.md",
        "name: { full: Vedyari }",
        "shortcode: vedyari",
        "type: lore",
        "subType: culture",
        "description: A culture that omits its own culture.",
    );
    note(
        "Lore/Osket.md",
        "name: { full: Osket }",
        "shortcode: osket",
        "type: lore",
        "subType: culture",
        "description: A culture that names itself.",
        "data: { culture: lore-osket }",
    );
    place("realm", "{ culture: lore-vedyari }");
    place("shire", "{ parents: [realm] }");
    place("village", "{ parents: [shire] }");
}

/** Run `package-build lint` in the tree, returning every line it printed. */
function lint(): string[] {
    const result = spawnSync(process.execPath, [CLI, "lint"], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n");
}

/** The diagnostic lines that concern a culture. */
const cultureFindings = (lines: string[]) =>
    lines.filter((line) => /: (error|warning): /.test(line) && /culture/i.test(line));

describe("lint reads resolved cultures", () => {
    it(
        "reports no culture finding on culture notes or inheriting places",
        () => {
            tree();
            expect(cultureFindings(lint())).toEqual([]);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "still reports a culture that names lore of another subType",
        () => {
            tree();
            note(
                "Lore/Saga.md",
                "name: { full: Saga }",
                "shortcode: saga",
                "type: lore",
                "subType: history",
                "description: Lore that is not a culture.",
            );
            place("hamlet", "{ culture: lore-saga }");
            const findings = cultureFindings(lint());
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatch(
                /^assets\/content\/Places\/hamlet\.md:\d+:\d+: error: data\.culture .*names lore whose subType is not culture/,
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
