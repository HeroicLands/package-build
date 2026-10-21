/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const DIRS = ["engine", "sohl", "hm3", "bin", "site-theme", "docs"];
const EXTENSIONS = /\.(mjs|js|md|css|yaml|yml|html|json)$/;
const WORDING = /retired|renamed|no longer|formerly|legacy|\bused to\b|previously/i;

/**
 * Lines that carry retirement wording and are allowed to: each names a live
 * identifier or a rule that holds now. `file` is a path relative to the
 * repository root; `line` matches the offending line.
 */
/**
 * A language's `data.retired` by name: the key, its entries, its declaration,
 * its keys and columns, its rows and its relation, and nothing said around them.
 */
const RETIRED_KEY =
    /`retired`|`data\.retired|data\.retired\b|`retired\[\]|\bRETIRED_(?:FIELDS|KEYS|COLUMNS)\b|\bretiredRows\b|\"retired\"|^\s*- retired$|^\s*retired:( \{|$)|\bFROM retired\b/;

const ALLOWLIST: { file: string; line: RegExp; reason: string }[] = [
    {
        file: "engine/address-diff.mjs",
        line: /renamed|is no longer/,
        reason:
            "`renamed` is the live finding kind of `addresses diff`, and " +
            "the message states the current fact that an address is not published",
    },
    {
        file: "bin/content-commands.mjs",
        line: /renamed|are no longer/,
        reason: "the `addresses diff` summary names the `renamed` finding kind",
    },
    {
        file: "docs/commands.md",
        line: /no longer|renamed/,
        reason: "documents the `addresses diff` command and its `renamed` kind",
    },
    {
        file: "docs/diagnostics.md",
        line: /withdrawn or renamed/,
        reason: "documents the `addresses diff` `renamed` kind",
    },
    {
        file: "docs/guides/release-and-deploy.md",
        line: /\*\*renamed\*\*/,
        reason: "documents the `addresses diff` `renamed` kind",
    },
    {
        file: "engine/language-terms.mjs",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
    {
        file: "engine/language-rows.mjs",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
    {
        file: "engine/content-format.yaml",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
    {
        file: "docs/authoring/links-and-markup.md",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
    {
        file: "docs/content-format.md",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
    {
        file: "docs/reference/format-details.md",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
    {
        file: "docs/reference/note-types.md",
        line: RETIRED_KEY,
        reason: "names a language's `data.retired` key, its declaration or its relation",
    },
];

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (EXTENSIONS.test(name)) out.push(path);
    }
    return out;
}

function hits(): { file: string; n: number; text: string }[] {
    const found: { file: string; n: number; text: string }[] = [];
    for (const dir of DIRS) {
        for (const path of walk(join(ROOT, dir))) {
            const file = relative(ROOT, path);
            readFileSync(path, "utf8")
                .split("\n")
                .forEach((text, i) => {
                    if (WORDING.test(text)) found.push({ file, n: i + 1, text });
                });
        }
    }
    return found;
}

describe("shipped prose carries no retirement wording", () => {
    const all = hits();
    const allowed = (h: { file: string; text: string }) =>
        ALLOWLIST.some((a) => a.file === h.file && a.line.test(h.text));

    it("has no hit outside the allowlist", () => {
        const bad = all
            .filter((h) => !allowed(h))
            .map((h) => `${h.file}:${h.n}: ${h.text.trim().slice(0, 100)}`);
        expect(bad).toEqual([]);
    });

    it("has no allowlist entry that matches nothing", () => {
        const stale = ALLOWLIST.filter(
            (a) => !all.some((h) => h.file === a.file && a.line.test(h.text)),
        ).map((a) => `${a.file}: ${a.line}`);
        expect(stale).toEqual([]);
    });
});
