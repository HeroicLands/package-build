/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { composePortrait } from "../engine/portrait-compose.mjs";
import {
    checkPortraitPrompt,
    portraitFromData,
    resolvePortraitItems,
} from "../engine/portrait-prompt.mjs";

/**
 * `data.portrait.prompt` holds the exact text a portrait was generated from.
 * A being with no `portrait` block has no portrait yet and is valid.
 */

const file = "assets/content/Beings/Someone.md";

function being(dataLines: string[]) {
    const raw = [
        "---",
        "shortcode: someone",
        'name: { full: "Someone" }',
        "type: being",
        "subType: creature",
        "data:",
        ...dataLines,
        "---",
        "",
        "Someone stands in the road and looks at the travellers as they pass by the inn door.",
        "",
    ].join("\n");
    return { file, raw, type: "being", fm: YAML.parse(raw.split("---\n")[1]) };
}

const lint = (note: ReturnType<typeof being>) =>
    lintNote(note as any, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY } as any);

describe("a being's portrait prompt", () => {
    it("is valid when absent: no portrait block, no diagnostics", () => {
        expect(lint(being(["    gender: female", "    frame: light"]))).toEqual([]);
        expect(lint(being(["    gender: female"]))).toEqual([]);
    });

    it("accepts declared portrait settings without a portrait", () => {
        const note = being([
            "    portraitSettings:",
            "        model: sdxl",
            "        extras: [stormy shore]",
            "        seed: sample",
            "        ageBand: adult",
        ]);
        expect(lint(note)).toEqual([]);
    });

    it("checks settings field types and closed choices", () => {
        for (const lines of [
            ["        model: other", "        seed: sample", "        ageBand: adult"],
            ["        model: sdxl", "        seed: sample", "        ageBand: unknown"],
            [
                "        model: sdxl",
                "        seed: sample",
                "        ageBand: adult",
                "        extras: not-a-list",
            ],
        ]) {
            const findings = lint(being(["    portraitSettings:", ...lines]));
            expect(
                findings.some((finding: any) => finding.message.includes("portraitSettings")),
            ).toBe(true);
        }
    });

    it("locates invalid settings and directions before a portrait exists", () => {
        const settings = (lines: string[]) => being(["    portraitSettings:", ...lines]);
        for (const lines of [
            ["        model: sdxl", "        ageBand: adult"],
            ["        model: sdxl", "        seed: sample"],
        ])
            expect(
                lint(settings(lines)).some(
                    (f: any) => f.severity === "error" && /seed|ageBand/.test(f.message),
                ),
            ).toBe(true);
        expect(
            lint(being(["    portraitSettings: []"])).some((f: any) => /seed/.test(f.message)),
        ).toBe(true);
        const numeric = settings([
            "        model: sdxl",
            "        seed: 42",
            "        ageBand: adult",
        ]);
        expect(lint(numeric)).toEqual([]);
        expect(portraitFromData(numeric.fm.data)).toEqual(
            portraitFromData({
                ...numeric.fm.data,
                portraitSettings: { ...numeric.fm.data.portraitSettings, seed: "42" },
            }),
        );
        const bad = settings([
            "        model: sdxl",
            "        seed: sample",
            "        ageBand: adult",
            "        extras:",
            "            - stormy shore",
            "            - full-body pose",
        ]);
        expect(
            lint(bad).some(
                (f: any) =>
                    f.severity === "error" &&
                    f.line === 13 &&
                    /portraitSettings\.extras\[1\].*full-body/.test(f.message),
            ),
        ).toBe(true);
    });
    it.each([
        "cartoons",
        "ink drawings",
        "ink sketches",
        "ink illustrations",
        "fullbody",
        "full_body",
        "full–body",
        "flatcolor",
    ])("locates excluded direction %s", (value) => {
        const note = being([
            "    portraitSettings:",
            "        model: sdxl",
            "        seed: sample",
            "        ageBand: adult",
            "        extras:",
            `            - ${value}`,
        ]);
        expect(
            lint(note).some(
                (f: any) =>
                    f.severity === "error" &&
                    f.line === 12 &&
                    f.message.includes("portraitSettings.extras[0]"),
            ),
        ).toBe(true);
    });

    it("locates excluded directions in appearance and inline items without a portrait", () => {
        const base = ["    portraitSettings: {model: sdxl, seed: sample, ageBand: adult}"];
        const feature = being([
            ...base,
            "    appearance:",
            "        extra_features:",
            "            - full-body pose",
        ]);
        expect(
            lint(feature).some(
                (f: any) =>
                    f.severity === "error" &&
                    f.line === 10 &&
                    /appearance\.extra_features\[0\].*full-body/.test(f.message),
            ),
        ).toBe(true);
        const item = being([
            ...base,
            "    items:",
            "        - {kind: miscgear, name: flat colors}",
        ]);
        expect(
            lint(item).some(
                (f: any) =>
                    f.severity === "error" &&
                    f.line === 9 &&
                    /items\[0\]\.name.*flat colors/.test(f.message),
            ),
        ).toBe(true);
    });

    it("treats empty portrait maps and empty-list maps alike", () => {
        for (const value of ["{}", "[]"]) {
            const findings = lint(being([`    portrait: ${value}`]));
            expect(
                findings.some(
                    (finding: any) =>
                        finding.severity === "error" &&
                        finding.line === 7 &&
                        /portrait\.prompt/.test(finding.message),
                ),
            ).toBe(true);
        }
    });

    it("reports one seed shape error and normalizes parsed numeric seeds", () => {
        const make = (seed: string) =>
            being([
                "    portraitSettings:",
                "        model: sdxl",
                `        seed: ${seed}`,
                "        ageBand: adult",
            ]);
        const findings = lint(make("[1]"));
        expect(
            findings.filter((finding: any) => /portraitSettings\.seed/.test(finding.message)),
        ).toHaveLength(1);
        for (const [numeric, normalized] of [
            ["42.0", "42"],
            ["1e3", "1000"],
        ]) {
            const number = make(numeric);
            expect(lint(number)).toEqual([]);
            expect(portraitFromData(number.fm.data)).toEqual(
                portraitFromData(make(`"${normalized}"`).fm.data),
            );
        }
        for (const seed of ["''", ".inf"])
            expect(lint(make(seed)).some((finding: any) => /seed/.test(finding.message))).toBe(
                true,
            );
    });

    it("locates a missing prompt at the portrait key", () => {
        const findings = lint(being(["    portrait:", "        negativePrompt: text"]));
        expect(
            findings.some((f: any) => f.severity === "error" && f.line === 7 && f.column === 5),
        ).toBe(true);
    });

    it("accepts the text a portrait was made from, multi-line text included", () => {
        const note = being([
            "    portrait:",
            "        prompt: >-",
            "            A weathered woman with braided dark hair, an angular face",
            "            and a thin mouth, head and shoulders.",
        ]);
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
        expect(findings[0].message).toContain("portraitSettings");
        expect(note.fm.data.portrait.prompt).toContain("angular face and a thin mouth");
    });

    it("compares both stored channels with the reproducible prompt", () => {
        const generated = composePortrait({ style: "sdxl", seed: "sample", ageBand: "adult" });
        const note = being([
            "    portraitSettings:",
            "        model: sdxl",
            "        seed: sample",
            "        ageBand: adult",
            "    portrait:",
            `        prompt: ${JSON.stringify(generated.positive)}`,
            `        negativePrompt: ${JSON.stringify(generated.negative)}`,
        ]);
        expect(lint(note)).toEqual([]);
        note.fm.data.portrait.negativePrompt = "old negative";
        expect(lint(note).some((finding: any) => /stale.*negative/i.test(finding.message))).toBe(
            true,
        );
        note.fm.data.portrait.negativePrompt = generated.negative;
        note.fm.data.portrait.prompt = "old positive";
        expect(lint(note).some((finding: any) => /stale.*positive/i.test(finding.message))).toBe(
            true,
        );
    });

    it("resolves item model defaults and entry overrides from the index", () => {
        const data = {
            items: [
                { model: "miscgear-lamp", name: "iron lamp" },
                { kind: "clothing", name: "linen coat" },
            ],
        };
        const index = {
            contentPackage: "demo",
            types: new Set(["miscgear"]),
            packages: new Set(["demo"]),
            addressHit: () => ({ fm: { data: { kind: "miscgear", name: "lamp" } } }),
        };
        expect(resolvePortraitItems(data, index)).toEqual([
            expect.objectContaining({ kind: "miscgear", name: "iron lamp" }),
            { kind: "clothing", name: "linen coat" },
        ]);
        const named = {
            ...index,
            addressHit: () => ({ fm: { name: { full: "Lamp" }, data: { kind: "miscgear" } } }),
        };
        expect(resolvePortraitItems({ items: [{ model: "miscgear-lamp" }] }, named)[0].name).toBe(
            "Lamp",
        );
        expect(() => resolvePortraitItems(data, { ...index, addressHit: () => undefined })).toThrow(
            /miscgear-lamp/,
        );
    });

    it("compares staleness against resolved item model changes", () => {
        const note = being([
            "    portraitSettings: {model: flux-dev, seed: sample, ageBand: adult}",
            "    items: [{model: miscgear-lamp}]",
        ]);
        let itemName = "lamp";
        const index = {
            contentPackage: "demo",
            types: new Set(["miscgear"]),
            packages: new Set(["demo"]),
            addressHit: () => ({ fm: { data: { kind: "miscgear", name: itemName } } }),
        };
        const channels = portraitFromData(note.fm.data, resolvePortraitItems(note.fm.data, index));
        note.fm.data.portrait = { prompt: channels.positive };
        expect(checkPortraitPrompt(note, { index })).toEqual([]);
        itemName = "lantern";
        expect(checkPortraitPrompt(note, { index })[0].message).toContain("stale");
    });

    it("uses authored entries instead of cached resolved defaults when checking staleness", () => {
        const note = being([
            "    portraitSettings: {model: flux-dev, seed: sample, ageBand: adult}",
            "    items: [{model: miscgear-lamp, kind: miscgear, name: lamp}]",
        ]);
        const index = {
            contentPackage: "demo",
            types: new Set(["miscgear"]),
            packages: new Set(["demo"]),
            addressHit: () => ({ fm: { data: { kind: "miscgear", name: "lantern" } } }),
        };
        const frozen = portraitFromData(note.fm.data, [{ kind: "miscgear", name: "lamp" }]);
        note.fm.data.portrait = { prompt: frozen.positive };
        const indexed = { ...note, authoredItems: [{ model: "miscgear-lamp" }] };
        expect(checkPortraitPrompt(indexed, { index })[0].message).toContain("stale");
    });

    it("requires a positive channel when the portrait block exists", () => {
        const findings = lint(being(["    portrait:", "        negativePrompt: text"]));
        expect(findings.some((finding: any) => /portrait.prompt/.test(finding.message))).toBe(true);
    });

    it("refuses a blank prompt at the value", () => {
        const note = being(["    portrait:", '        prompt: "  "']);
        const findings = lint(note);
        expect(findings).toHaveLength(1);
        expect(formatDiagnostic(findings[0])).toMatch(
            new RegExp(`^${file}:8:17: error: .*data\\.portrait\\.prompt`),
        );
    });

    it("refuses a prompt that is not text, and a key the block does not declare", () => {
        const notText = lint(being(["    portrait:", "        prompt: [one, two]"]));
        expect(notText.some((f: any) => f.message.includes("portrait.prompt"))).toBe(true);
        const stray = lint(
            being(["    portrait:", "        prompt: A face.", "        model: flux"]),
        );
        expect(stray.some((f: any) => f.message.includes('"model"'))).toBe(true);
    });
});
