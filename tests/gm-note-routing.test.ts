/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPackRouter } from "../engine/pack-router.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { entriesForNote } from "../engine/foundry-entries.mjs";
import { GM_TAG, isGmNote, declaredTags } from "../engine/note-vocabulary.mjs";

const packs = [
    { name: "journals", type: "JournalEntry", default: true, private: false },
    { name: "gm-journals", type: "JournalEntry", private: true },
];
const router = createPackRouter(packs);

class JournalPass extends BasePackCompiler {
    override selects() {
        return true;
    }
    override buildEntry() {
        return {};
    }
}

describe("GM note routing", () => {
    it("reserves the tag for every note type", () => {
        expect(GM_TAG).toBe("gm");
        expect(isGmNote({ tags: ["gm"] })).toBe(true);
        expect(isGmNote({ tags: ["draft"] })).toBe(false);
        expect(declaredTags("doc")).toContain("gm");
        expect(declaredTags("being")).toContain("gm");
    });

    it("emits a GM journal only into a private compendium and publishes only its real UUID", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "gm-route-"));
        try {
            const pass = (packName: string) =>
                new JournalPass({
                    contentBase: root,
                    skipDirectories: [],
                    dest: path.join(root, "out"),
                    packName,
                    docType: "JournalEntry",
                    router,
                });
            const fm = {
                type: "doc",
                subType: "concept",
                shortcode: "secret",
                id: "aaaaaaaaaaaaaaaa",
                tags: ["gm"],
            };
            expect(pass("journals").routesHere(fm)).toBe(false);
            expect(
                entriesForNote(fm, "Secret", "doc-secret", "Secret prose.", {
                    contentPackage: "demo",
                    foundryPackageId: "demo",
                    packRouter: router,
                })[0].uuid,
            ).toBeUndefined();

            const privateFm = { ...fm, data: { pack: "gm-journals" } };
            expect(pass("journals").routesHere(privateFm)).toBe(false);
            expect(pass("gm-journals").routesHere(privateFm)).toBe(true);
            expect(
                entriesForNote(privateFm, "Secret", "doc-secret", "Secret prose.", {
                    contentPackage: "demo",
                    foundryPackageId: "demo",
                    packRouter: router,
                })[0].uuid,
            ).toContain("gm-journals");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("routes a GM item's derived journal to the private journal pack", () => {
        const itemRouter = createPackRouter([
            ...packs,
            { name: "items", type: "Item", default: true },
            { name: "gm-items", type: "Item", private: true },
        ]);
        const fm = {
            type: "skill",
            shortcode: "secret",
            id: "aaaaaaaaaaaaaaaa",
            tags: ["gm"],
            data: { pack: "gm-items" },
            sohl: { system: {} },
        };
        expect(itemRouter.resolve(fm, "Item")).toBe("gm-items");
        expect(itemRouter.resolve(fm, "JournalEntry")).toBe("gm-journals");
        const entries = entriesForNote(fm, "Secret", "skill-secret", "Prose.", {
            contentPackage: "demo",
            foundryPackageId: "demo",
            packRouter: itemRouter,
        });
        expect(entries[0].uuid).toContain("gm-items");
        expect(entries[1].uuid).toContain("gm-journals");
    });
});
