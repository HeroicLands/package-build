/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The keys that mark a run, read from the scanner's own list.** Every key in
 * `RUN_KEYS` makes a span, a div and a verse fence a run, the list is exactly
 * `lang`, `font` and `enc`, and a verse fence, whose keys are closed, refuses
 * any other.
 */

import { describe, expect, it } from "vitest";

import { RUN_KEYS, scanRuns } from "../engine/content-scripts.mjs";
import { VERSE_KEYS, scanVerse } from "../engine/content-verse.mjs";

const VALUE: Record<string, string> = { lang: "en", font: "serif", enc: "demo" };

describe("the keys a run is marked with", () => {
    it("are lang, font and enc", () => {
        expect([...RUN_KEYS].sort()).toEqual(["enc", "font", "lang"]);
    });

    it.each(RUN_KEYS.map((key: string) => [key]))("%s= makes each construct a run", (key) => {
        const attr = `${key}=${VALUE[key] ?? "x"}`;
        const sources = [
            `[x]{${attr}}`,
            `::: {${attr}}\nx\n:::`,
            `\`\`\`verse {${attr}}\nx\n\`\`\``,
        ];
        for (const source of sources)
            expect(scanRuns(source, {}).runs.map((run: { kind: string }) => run.kind)).toHaveLength(
                1,
            );
    });

    it.each(RUN_KEYS.map((key: string) => [key]))("a verse fence accepts %s=", (key) => {
        const poem = `\`\`\`verse {${key}=${VALUE[key] ?? "x"}}\nx\n\`\`\``;
        expect(scanVerse(poem).errors).toEqual([]);
        expect(VERSE_KEYS).toContain(key);
    });

    it("leaves script= unread, and a verse fence refuses it as an unknown key", () => {
        expect(RUN_KEYS).not.toContain("script");
        expect(VERSE_KEYS).not.toContain("script");
        expect(scanRuns("[x]{script=semaron-kuriale}", {}).runs).toEqual([]);
        expect(
            scanVerse("```verse {script=semaron-kuriale}\nx\n```").errors.map(
                (error: { message: string }) => error.message,
            ),
        ).toEqual(["script= is not a verse attribute"]);
    });
});
