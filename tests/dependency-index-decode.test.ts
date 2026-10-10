/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { loadForeignIndexes, metadataFileName } from "../engine/metadata-index.mjs";

const SOURCE = { package: "sohl", file: "build/cache/metadata/sohl@0.8.7/sohl-metadata.jsonl" };

const record = (over: Record<string, unknown> = {}) => ({
    package: "sohl",
    type: "being",
    shortcode: "aurochs",
    address: { slug: "being-aurochs", canonical: "sohl-note-being-aurochs" },
    anchors: [],
    documentation: null,
    ...over,
});

function failure(rec: Record<string, unknown>) {
    try {
        decodeIndexAddresses(rec, { package: "sohl" }, SOURCE);
    } catch (error) {
        return error as Error & { located?: boolean };
    }
    throw new Error("decodeIndexAddresses accepted the record");
}

describe("a dependency's index in a shape this package-build does not read", () => {
    it.each([
        ["anchors[].link", { anchors: [{ id: "appearance", link: "being-aurochs#appearance" }] }],
        ["documentation", { documentation: "being-aurochs" }],
        ["documents", { documents: "being-aurochs" }],
        ["address.canonical", { address: { slug: "being-aurochs", canonical: "being-aurochs" } }],
    ])("names the dependency, the index file and the remedy for %s", (field, over) => {
        const error = failure(record(over));
        expect(error.located).toBe(true);
        expect(error.message).toMatch(
            /^build\/cache\/metadata\/sohl@0\.8\.7\/sohl-metadata\.jsonl: error: /,
        );
        expect(error.message).toContain("sohl");
        expect(error.message).toContain(field);
        expect(error.message).toContain("aurochs");
        expect(error.message).toContain("package-build deps fetch");
        expect(error.message).toContain("built with this package-build");
    });

    it("carries the record's line when the caller knows it", () => {
        let message = "";
        try {
            decodeIndexAddresses(
                record({ anchors: [{ id: "a", link: "x#a" }] }),
                { package: "sohl" },
                { ...SOURCE, line: 12 },
            );
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toMatch(
            /^build\/cache\/metadata\/sohl@0\.8\.7\/sohl-metadata\.jsonl:12: error: /,
        );
    });

    it("leaves an index without a source on its plain message", () => {
        expect(() =>
            decodeIndexAddresses(record({ anchors: [{ id: "a", link: "x#a" }] }), {
                package: "sohl",
            }),
        ).toThrow(/^Index anchor link is not an Address/);
    });
});

describe("loading a cached dependency index in that shape", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-stale-idx-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("fails at the record's line, naming the cached file", () => {
        const dir = path.join(root, "sohl@0.8.7");
        fs.mkdirSync(dir, { recursive: true });
        const good = record({ shortcode: "good" });
        const bad = record({ anchors: [{ id: "appearance", link: "being-aurochs#appearance" }] });
        fs.writeFileSync(
            path.join(dir, metadataFileName("sohl")),
            [good, bad].map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        fs.writeFileSync(path.join(dir, ".complete"), "");
        const config = {
            paths: { metadataCache: root },
            relationships: { systems: [{ id: "sohl", manifest: "https://example.org/s.json" }] },
        } as never;
        let message = "";
        try {
            loadForeignIndexes(config, ["thalorna"]);
        } catch (error) {
            message = (error as Error).message;
        }
        const file = path.join(root, "sohl@0.8.7", "sohl-metadata.jsonl");
        const shown = path.relative(process.cwd(), file);
        expect(message.startsWith(`${shown.startsWith("..") ? file : shown}:2: error: `)).toBe(
            true,
        );
        expect(message).toContain("deps fetch");
    });
});
