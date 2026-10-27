/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The labels are the options of the changelog entry in `.changeset/config.json`. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, it, expect } from "vitest";

import { readChangelogLabels } from "../engine/changelog-labels.mjs";

const dirs: string[] = [];

function repoWith(config: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-labels-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, ".changeset"));
    fs.writeFileSync(
        path.join(dir, ".changeset", "config.json"),
        typeof config === "string" ? config : JSON.stringify(config),
    );
    return dir;
}

const entry = (options: unknown) => ({
    changelog: ["@heroiclands/package-build/changelog", options],
});

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("readChangelogLabels", () => {
    it("reads the labels in declared order from the changelog options", () => {
        const dir = repoWith(entry({ labels: ["Verse", "Rendering"] }));
        expect(readChangelogLabels(dir)).toEqual(["Verse", "Rendering"]);
    });

    it("is null with no file, a bare generator name, no options or no labels", () => {
        expect(
            readChangelogLabels(fs.mkdtempSync(path.join(os.tmpdir(), "no-config-"))),
        ).toBeNull();
        expect(
            readChangelogLabels(repoWith({ changelog: "@heroiclands/package-build/changelog" })),
        ).toBeNull();
        expect(readChangelogLabels(repoWith(entry({})))).toBeNull();
        expect(readChangelogLabels(repoWith({ changelog: ["x"] }))).toBeNull();
    });

    it("refuses a value that is not an array of distinct non-empty strings", () => {
        for (const labels of ["Verse", [1], [""], ["Verse", "Verse"]]) {
            expect(() => readChangelogLabels(repoWith(entry({ labels })))).toThrow(
                ".changeset/config.json",
            );
        }
    });

    it("refuses a declared Miscellaneous", () => {
        expect(() =>
            readChangelogLabels(repoWith(entry({ labels: ["Verse", "Miscellaneous"] }))),
        ).toThrow(/Miscellaneous.*always available/);
    });

    it("refuses a config.json that is not JSON", () => {
        expect(() => readChangelogLabels(repoWith("{"))).toThrow("not valid JSON");
    });
});
