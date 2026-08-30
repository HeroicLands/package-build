/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Declaring a system and requiring one are separate decisions (#48).
 *
 * `relationships.systems` is a *restriction*: Foundry's `supportsSystem` drops
 * a module from any world whose system it does not name. It was also the only
 * place to state a system version, so a module shipping content for two systems
 * had to choose between naming them and staying loadable — and choosing the
 * second meant stamping **no** system version on content that certainly has
 * one.
 *
 * `harn-ensemble` is that module, and it is not hypothetical: it declares an
 * `actors-hm3` pack and an `actors-sohl` pack, and stamps `systemId: null,
 * systemVersion: null` on both. These tests pin the split that fixes it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { statsForPack } from "../engine/helpers.mjs";

function repoDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-sys-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "harn-ensemble", version: "0.0.1" }),
        "utf8",
    );
    return root;
}

const resolveIn = (root: string, data: Record<string, unknown>) =>
    configFromData(data, path.join(root, `${CONFIG_BASENAME}.yaml`));

/** The `harn-ensemble` shape: two Actor packs, one per system. */
function twoSystems(extra: Record<string, unknown> = {}) {
    return {
        contentPackage: "harnensemble",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "sohlbuilder00000" },
        systems: {
            hm3: { compatibility: { minimum: "1.6.3", verified: "1.6.3" } },
            sohl: { compatibility: { minimum: "0.8.2", verified: "0.8.2" } },
        },
        packs: [
            { name: "actors-hm3", type: "Actor", system: "hm3" },
            { name: "actors-sohl", type: "Actor", system: "sohl" },
            { name: "journals", type: "JournalEntry" },
        ],
        ...extra,
    };
}

describe("declaring a system does not restrict where the package loads", () => {
    it("accepts two declared systems with no relationship emitted", () => {
        const config = resolveIn(repoDir(), twoSystems());
        expect(Object.keys(config.systems)).toEqual(["hm3", "sohl"]);
        expect(config.requiresSystem).toBeNull();
        // The gate is what would hide the module; nothing here sets one.
        expect(config.relationships.systems).toBeUndefined();
    });

    // The defect the issue names: one `_stats` block for the whole package, so
    // every document in every pack was stamped identically — or, for a module
    // that declined to name a system at all, not stamped.
    it("stamps each pack with the system that pack is for", () => {
        const config = resolveIn(repoDir(), twoSystems());
        const hm3 = statsForPack("hm3", config);
        const sohl = statsForPack("sohl", config);

        expect(hm3.systemId).toBe("hm3");
        expect(hm3.systemVersion).toBe("1.6.3");
        expect(sohl.systemId).toBe("sohl");
        expect(sohl.systemVersion).toBe("0.8.2");
    });

    // `systemId` travels with `systemVersion`: stamping a per-pack version
    // against a package-wide id would emit `systemId: sohl, systemVersion:
    // 1.6.3` on HM3 documents — a plausible lie, worse than an absence.
    it("omits both on a pack that names no system", () => {
        const config = resolveIn(repoDir(), twoSystems());
        const neutral = statsForPack(null, config);
        expect(neutral.systemId).toBeNull();
        expect(neutral.systemVersion).toBeNull();
    });

    // With one system and no gate there is an unambiguous package-wide answer,
    // which is what every package that worked before this existed relies on.
    it("derives the package-wide version from a single declared system", () => {
        const config = resolveIn(
            repoDir(),
            twoSystems({
                systems: {
                    sohl: { compatibility: { verified: "0.8.2" } },
                },
                packs: [{ name: "journals", type: "JournalEntry" }],
            }),
        );
        expect(config.stats.systemVersion).toBe("0.8.2");
    });
});

describe("requiring a system is the separate, optional gate", () => {
    it("emits the relationship that Foundry's supportsSystem reads", () => {
        const config = resolveIn(
            repoDir(),
            twoSystems({
                systems: {
                    sohl: {
                        manifest: "https://example.org/system.json",
                        compatibility: { minimum: "0.8.2", verified: "0.8.2" },
                    },
                },
                requiresSystem: "sohl",
                packs: [{ name: "actors-sohl", type: "Actor", system: "sohl" }],
            }),
        );
        expect(config.requiresSystem).toBe("sohl");
        // The declaration is reused rather than restated, so the two cannot
        // disagree the way a transcription can.
        expect(config.systems.sohl.compatibility.verified).toBe("0.8.2");
        expect(config.systems.sohl.manifest).toBe(
            "https://example.org/system.json",
        );
    });
});

describe("a name that resolves to nothing is an error, not a fall-through", () => {
    it("refuses requiresSystem naming an undeclared system", () => {
        expect(() =>
            resolveIn(repoDir(), twoSystems({ requiresSystem: "hm4" })),
        ).toThrow(/requiresSystem.*hm4.*does not declare/s);
    });

    it("refuses a pack naming an undeclared system", () => {
        expect(() =>
            resolveIn(
                repoDir(),
                twoSystems({
                    packs: [{ name: "a", type: "Actor", system: "nope" }],
                }),
            ),
        ).toThrow(/nope.*does not declare/s);
    });

    // A pack for another system could never be seen: Foundry hides the whole
    // package from any world whose system the gate does not name, so the pack
    // would ship and be unreachable.
    it("refuses a pack whose system the gate excludes", () => {
        expect(() =>
            resolveIn(repoDir(), twoSystems({ requiresSystem: "sohl" })),
        ).toThrow(/could never be seen/s);
    });

    it("requires a verified version on every declared system", () => {
        expect(() =>
            resolveIn(
                repoDir(),
                twoSystems({
                    systems: { sohl: { compatibility: { minimum: "0.8.2" } } },
                    packs: [{ name: "j", type: "JournalEntry" }],
                }),
            ),
        ).toThrow(/systems\.sohl\.compatibility\.verified/s);
    });
});
