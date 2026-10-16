/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { checkStandings } from "../engine/standings.mjs";
import { positionOfYamlPath } from "../engine/diagnostics.mjs";

const index = {
    contentPackage: "demo",
    types: new Set(["being", "affiliation"]),
    packages: new Set(["demo"]),
    addressHit: () => ({
        fm: {
            data: {
                governance: {
                    ranks: [{ level: 1, title: "Member" }],
                    offices: { Keeper: "Keeps the roll." },
                },
            },
        },
    }),
};

function note(rank: number, office: string) {
    const fm = {
        type: "being",
        shortcode: "positionprobe",
        data: { affiliations: { circle: { rank, office } } },
    };
    return { fm, file: "Probe.md", raw: `---\n${YAML.stringify(fm)}---\n\nProse.\n` };
}

afterEach(() => vi.restoreAllMocks());

describe("finding position work", () => {
    it("parses no position document for valid body, rank and office", () => {
        const valid = note(1, "Keeper");
        const parse = vi.spyOn(YAML, "parseDocument");
        expect(checkStandings(valid, { index })).toEqual([]);
        expect(parse).not.toHaveBeenCalled();
    });

    it("parses the note once for several located findings", () => {
        const invalid = note(9, "Absent");
        const parse = vi.spyOn(YAML, "parseDocument");
        const findings = checkStandings(invalid, { index });
        expect(findings).toHaveLength(2);
        for (const finding of findings) {
            expect(finding.line).toBeGreaterThan(0);
            expect(finding.column).toBeGreaterThan(0);
        }
        expect(parse).toHaveBeenCalledTimes(1);
    });

    it("shares a document across paths and key/value lookups, and refreshes changed text", () => {
        const parse = vi.spyOn(YAML, "parseDocument");
        const text = "positionProbe: { first: one, second: two }\n";
        expect(positionOfYamlPath(text, ["positionProbe", "first"], { key: true })).toEqual({
            line: 1,
            column: 18,
        });
        expect(positionOfYamlPath(text, ["positionProbe", "first"])).toEqual({
            line: 1,
            column: 25,
        });
        expect(positionOfYamlPath(text, ["positionProbe", "second"])).toEqual({
            line: 1,
            column: 38,
        });
        expect(parse).toHaveBeenCalledTimes(1);
        expect(positionOfYamlPath(`\n${text}`, ["positionProbe", "first"])).toEqual({
            line: 2,
            column: 25,
        });
        expect(parse).toHaveBeenCalledTimes(2);
    });
});
