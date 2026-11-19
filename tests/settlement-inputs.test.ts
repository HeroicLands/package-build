/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createContentSession } from "../engine/content-session.mjs";
import { settlementMembership } from "../engine/settlement-tables.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("settlement membership from a content session", () => {
    it("resolves direct subordinates, a seat and a governed settlement by address", async () => {
        const input = fixture();
        roots.push(input.root);
        const content = input.config.paths.content;
        const add = (filename: string, fm: object) => write(path.join(content, filename), note(fm));
        add("Crown.md", {
            type: "affiliation",
            subType: "polity",
            shortcode: "crown",
            name: { full: "Crown" },
            data: { seat: "place-capital", territorial_population: 1000 },
        });
        add("Council.md", {
            type: "affiliation",
            subType: "polity",
            shortcode: "council",
            name: { full: "Council" },
            data: { parents: ["affiliation-crown"] },
        });
        add("Capital.md", {
            type: "place",
            subType: "settlement",
            shortcode: "capital",
            name: { full: "Capital" },
            data: { government: "affiliation-crown", population: 0 },
        });
        const session = await createContentSession({ config: input.config });
        try {
            const crown = session.records.find((record: any) => record.shortcode === "crown")!;
            const membership = settlementMembership(crown, session.records);
            expect(membership.polities.map((entry: any) => entry.address)).toEqual([
                "sessionproof-note-affiliation-council",
            ]);
            expect(membership.settlements.map((entry: any) => entry.address)).toEqual([
                "sessionproof-note-place-capital",
            ]);
            expect(membership.settlements[0].record.data.population).toBe(0);
        } finally {
            session.dispose();
        }
    });
});
