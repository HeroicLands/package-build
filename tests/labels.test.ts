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

import { describe, it, expect } from "vitest";
import { checkLabelRegistry, documentedLabels, MAX_DESCRIPTION } from "../labels.mjs";

const registry = (...names: string[]) =>
    names.map((n) => `- name: ${n}\n  description: about ${n}\n`).join("");

const doc = (...names: string[]) =>
    ["## 3. Labels", "", "| label | meaning |", "| --- | --- |"]
        .concat(names.map((n) => `| \`${n}\` | what ${n} means |`))
        .concat(["", "## 4. Something else", ""])
        .join("\n");

describe("the label registry's two faces", () => {
    it("is silent when both name the same labels", () => {
        const r = checkLabelRegistry({
            registryText: registry("system", "content", "site"),
            docText: doc("system", "content", "site"),
        });
        expect(r.registry).toEqual([]);
        expect(r.doc).toEqual([]);
        expect(r.count).toBe(3);
    });

    it("reports a registry label the documentation omits, at its line", () => {
        const r = checkLabelRegistry({
            registryText: registry("system", "orphan"),
            docText: doc("system"),
        });
        expect(r.doc).toEqual([]);
        expect(r.registry).toHaveLength(1);
        expect(r.registry[0].message).toContain('"orphan" is in the registry');
        // `- name: orphan` is the third line of the generated registry.
        expect(r.registry[0].line).toBe(3);
        expect(r.registry[0].severity).toBe("error");
    });

    it("reports a documented label the registry omits, located in the doc", () => {
        const r = checkLabelRegistry({
            registryText: registry("system"),
            docText: doc("system", "invented"),
        });
        expect(r.registry).toEqual([]);
        expect(r.doc).toHaveLength(1);
        expect(r.doc[0].message).toContain("never synced");
        expect(r.doc[0].line).toBeGreaterThan(0);
    });

    it("names the file it was given, not a hardcoded path", () => {
        const r = checkLabelRegistry({
            registryText: registry("a"),
            docText: doc(),
            docPath: "docs/elsewhere.md",
        });
        expect(r.registry[0].message).toContain("docs/elsewhere.md");
    });

    it("catches an over-long description before the sync does", () => {
        // GitHub answers a 422 naming neither the label nor the limit, so this
        // is the only place the author learns which one is too long.
        const long = "x".repeat(MAX_DESCRIPTION + 1);
        const r = checkLabelRegistry({
            registryText: `- name: verbose\n  description: ${long}\n`,
            docText: doc("verbose"),
        });
        expect(r.registry).toHaveLength(1);
        expect(r.registry[0].message).toContain(`over ${MAX_DESCRIPTION}`);
    });

    it("treats a missing §3 as its own failure, not as every label drifting", () => {
        const r = checkLabelRegistry({
            registryText: registry("a", "b", "c"),
            docText: "# Issue reporting\n\nNo numbered sections here.\n",
        });
        expect(r.doc).toHaveLength(1);
        expect(r.doc[0].message).toContain("no §3 section");
        // Not three findings, one per label: the section is the defect.
        expect(r.registry).toEqual([]);
    });

    it("reports unparseable or misshapen registries rather than throwing", () => {
        expect(
            checkLabelRegistry({ registryText: "- name: [", docText: doc() }).registry[0].message,
        ).toContain("not valid YAML");
        expect(
            checkLabelRegistry({ registryText: "name: solo\n", docText: doc() }).registry[0]
                .message,
        ).toContain("must be a list");
    });
});

describe("reading the documented table", () => {
    it("stops at the next numbered section", () => {
        const text = [
            "## 3. Labels",
            "| `inside` | yes |",
            "## 4. After",
            "| `outside` | no |",
        ].join("\n");
        const { names, found } = documentedLabels(text);
        expect(found).toBe(true);
        expect([...names]).toEqual(["inside"]);
    });

    it("reads only backticked first cells, so prose and examples are not labels", () => {
        const text = ["## 3. Labels", "| Column | Meaning |", "| `real` | yes |"].join("\n");
        expect([...documentedLabels(text).names]).toEqual(["real"]);
    });

    it("says when there is no section at all", () => {
        expect(documentedLabels("nothing here").found).toBe(false);
    });
});
