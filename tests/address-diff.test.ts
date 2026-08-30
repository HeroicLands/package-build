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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
    readItemAddresses,
    diffItemAddresses,
    noteFilesById,
    locateAddressFinding,
    formatAddressFinding,
} from "../engine/address-diff.mjs";

/** A compiled item document, in the shape a pack's JSON output has. */
function itemDoc(
    type: string,
    shortcode: string,
    id: string,
    name = shortcode,
): object {
    return { _id: id, type, name, system: { shortcode } };
}

let tmp: string;

function write(rel: string, data: unknown): string {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
        full,
        typeof data === "string" ? data : JSON.stringify(data, null, 2),
    );
    return full;
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "address-diff-"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("reading an address space out of compiled item JSON (#66)", () => {
    it("indexes every item by `(type, shortcode)`, carrying its document id", () => {
        write("items/Taburi_s5D6QJbw7ZbETxdN.json", {
            ...itemDoc("weapongear", "Tabri", "s5D6QJbw7ZbETxdN", "Tabûri"),
            _key: "!items!s5D6QJbw7ZbETxdN",
        });
        const space = readItemAddresses([path.join(tmp, "items")]);
        expect([...space.keys()]).toEqual(["weapongear:Tabri"]);
        expect(space.get("weapongear:Tabri")).toMatchObject({
            id: "s5D6QJbw7ZbETxdN",
            name: "Tabûri",
            type: "weapongear",
            shortcode: "Tabri",
        });
    });

    it("skips folder documents, non-JSON, and anything without an address", () => {
        write("items/folder_x.json", { name: "Weapons", _id: "f1" });
        write("items/README.md", "not json");
        write("items/NoCode_x.json", { _id: "x", type: "weapongear" });
        write("items/Ok_y.json", itemDoc("skill", "awar", "y"));
        const space = readItemAddresses([path.join(tmp, "items")]);
        expect([...space.keys()]).toEqual(["skill:awar"]);
    });

    it("reads several pack directories as one address space", () => {
        write("a/One_1.json", itemDoc("skill", "awar", "1"));
        write("b/Two_2.json", itemDoc("weapongear", "dagr", "2"));
        const space = readItemAddresses([
            path.join(tmp, "a"),
            path.join(tmp, "b"),
        ]);
        expect([...space.keys()].sort()).toEqual([
            "skill:awar",
            "weapongear:dagr",
        ]);
    });

    it("reports a directory that is not there rather than treating it as empty", () => {
        expect(() => readItemAddresses([path.join(tmp, "nope")])).toThrow(
            /does not exist/,
        );
    });
});

describe("diffing this build's addresses against a published release (#66)", () => {
    const baseline = () =>
        new Map(
            Object.entries({
                "weapongear:Tabri": {
                    id: "s5D6QJbw7ZbETxdN",
                    name: "Tabûri",
                    type: "weapongear",
                    shortcode: "Tabri",
                    file: "/cache/Taburi_s5D6QJbw7ZbETxdN.json",
                },
                "skill:awar": {
                    id: "aaa",
                    name: "Awareness",
                    type: "skill",
                    shortcode: "awar",
                    file: "/cache/Awareness_aaa.json",
                },
            }),
        );

    it("says nothing when every published address is still published", () => {
        const current = new Map(baseline());
        expect(
            diffItemAddresses(baseline(), current, { baseline: "sohl@0.8.2" }),
        ).toEqual([]);
    });

    it("says nothing about an address that merely arrived", () => {
        const current = new Map(baseline());
        current.set("weapongear:new", {
            id: "n",
            name: "New",
            type: "weapongear",
            shortcode: "new",
        });
        expect(
            diffItemAddresses(baseline(), current, { baseline: "sohl@0.8.2" }),
        ).toEqual([]);
    });

    /*
     * The whole point. `_id` is authored in the note's frontmatter and is not
     * derived from the shortcode, so it survives a rename — which makes this an
     * identity match rather than a guess at a similar-looking string.
     */
    it("calls a dropped address a rename when the same document is published elsewhere", () => {
        const current = new Map(baseline());
        current.delete("weapongear:Tabri");
        current.set("weapongear:Taburi", {
            id: "s5D6QJbw7ZbETxdN",
            name: "Tabûri",
            type: "weapongear",
            shortcode: "Taburi",
        });
        const findings = diffItemAddresses(baseline(), current, {
            baseline: "sohl@0.8.2",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            kind: "renamed",
            address: "weapongear:Tabri",
            to: "weapongear:Taburi",
            id: "s5D6QJbw7ZbETxdN",
            baseline: "sohl@0.8.2",
        });
    });

    it("calls it withdrawn when the document is published under no address at all", () => {
        const current = new Map(baseline());
        current.delete("skill:awar");
        const findings = diffItemAddresses(baseline(), current, {
            baseline: "sohl@0.8.2",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            kind: "withdrawn",
            address: "skill:awar",
            id: "aaa",
        });
        expect(findings[0].to).toBeUndefined();
    });

    it("does not call it a rename when a different document took the id's place", () => {
        // Same address gone, and an unrelated document arrived. Nothing ties
        // the two together, so nothing claims they are the same item.
        const current = new Map(baseline());
        current.delete("skill:awar");
        current.set("skill:climb", {
            id: "zzz",
            name: "Climbing",
            type: "skill",
            shortcode: "climb",
        });
        const findings = diffItemAddresses(baseline(), current, {
            baseline: "sohl@0.8.2",
        });
        expect(findings.map((f) => f.kind)).toEqual(["withdrawn"]);
    });

    /*
     * Not hypothetical: `sohl-kethira-basic@0.5.3` ships 307 items and not one
     * `system.shortcode`, so a diff against it reports a clean result no matter
     * what the current build publishes.
     */
    it("refuses a baseline that publishes no address at all", () => {
        expect(() =>
            diffItemAddresses(new Map(), new Map(), { baseline: "pkg@0.5.3" }),
        ).toThrow(/publishes no addressable item/);
    });

    it("reports findings in address order, so two runs read the same", () => {
        const current = new Map();
        const findings = diffItemAddresses(baseline(), current, {
            baseline: "sohl@0.8.2",
        });
        expect(findings.map((f) => f.address)).toEqual([
            "skill:awar",
            "weapongear:Tabri",
        ]);
    });
});

describe("locating an address finding in the source it came from (#66)", () => {
    it("indexes content notes by the document id their frontmatter authors", () => {
        write(
            "content/Weapons/Taburi.md",
            "---\nname:\n  full: Tabûri\nid: s5D6QJbw7ZbETxdN\nshortcode: Taburi\ntype: weapongear\n---\n\nBody.\n",
        );
        const byId = noteFilesById(path.join(tmp, "content"), {
            skipDirectories: [],
        });
        expect(byId.get("s5D6QJbw7ZbETxdN")).toBe(
            path.join(tmp, "content", "Weapons", "Taburi.md"),
        );
    });

    /*
     * A rename is fixed in the note that made it, so that is where the reader
     * is sent — at the `shortcode:` line, not the top of the file.
     */
    it("points a rename at the `shortcode:` line of the note that now holds the id", () => {
        const file = write(
            "content/Weapons/Taburi.md",
            "---\nname:\n  full: Tabûri\nid: s5D6QJbw7ZbETxdN\nshortcode: Taburi\ntype: weapongear\n---\n",
        );
        const at = locateAddressFinding(
            {
                kind: "renamed",
                address: "weapongear:Tabri",
                to: "weapongear:Taburi",
                id: "s5D6QJbw7ZbETxdN",
                shortcode: "Tabri",
                baseline: "sohl@0.8.2",
            },
            new Map([["s5D6QJbw7ZbETxdN", file]]),
        );
        expect(at.file).toBe(file);
        // Line 5 of the file: `---`, `name:`, `  full:`, `id:`, `shortcode:`.
        expect(at.line).toBe(5);
        expect(at.column).toBeGreaterThan(0);
    });

    it("falls back to the baseline document when nothing here holds the id", () => {
        const baselineFile = write(
            "cache/Awareness_aaa.json",
            itemDoc("skill", "awar", "aaa", "Awareness"),
        );
        const at = locateAddressFinding(
            {
                kind: "withdrawn",
                address: "skill:awar",
                id: "aaa",
                shortcode: "awar",
                baselineFile,
                baseline: "sohl@0.8.2",
            },
            new Map(),
        );
        expect(at.file).toBe(baselineFile);
        expect(at.line).toBeGreaterThan(0);
    });

    it("drops the position rather than guessing one it cannot establish", () => {
        const at = locateAddressFinding(
            {
                kind: "withdrawn",
                address: "skill:awar",
                id: "aaa",
                shortcode: "awar",
                baseline: "sohl@0.8.2",
            },
            new Map(),
        );
        expect(at.line).toBeUndefined();
        expect(at.column).toBeUndefined();
    });
});

describe("the diagnostic an address finding prints (#66)", () => {
    it("names the rename, the identity it matched on, and where it went", () => {
        const line = formatAddressFinding(
            {
                kind: "renamed",
                address: "weapongear:Tabri",
                to: "weapongear:Taburi",
                id: "s5D6QJbw7ZbETxdN",
                shortcode: "Tabri",
                name: "Tabûri",
                baseline: "sohl@0.8.2",
            },
            {
                file: "assets/content/Weapons/Melee/Taburi.md",
                line: 5,
                column: 1,
            },
        );
        expect(line).toBe(
            "assets/content/Weapons/Melee/Taburi.md:5:1: warning: since sohl@0.8.2, " +
                "weapongear:Tabri is no longer published; the same document " +
                "(s5D6QJbw7ZbETxdN) is now published as weapongear:Taburi. Every " +
                "package that resolves weapongear:Tabri breaks when it moves past " +
                "sohl@0.8.2",
        );
    });

    it("states a withdrawal as exactly that, claiming no successor", () => {
        const line = formatAddressFinding(
            {
                kind: "withdrawn",
                address: "skill:awar",
                id: "aaa",
                shortcode: "awar",
                name: "Awareness",
                baseline: "sohl@0.8.2",
            },
            {},
        );
        expect(line).toBe(
            "warning: since sohl@0.8.2, skill:awar is no longer published, and " +
                "its document (aaa) is published under no other address",
        );
    });

    it("promotes a finding to an error when the caller is gating on it", () => {
        const line = formatAddressFinding(
            {
                kind: "withdrawn",
                address: "skill:awar",
                id: "aaa",
                shortcode: "awar",
                baseline: "sohl@0.8.2",
            },
            {},
            "error",
        );
        expect(line.startsWith("error: ")).toBe(true);
    });
});

describe("the `addresses` command's own guards (#66)", () => {
    /*
     * Driven as a subprocess, and from a directory with no configuration at or
     * above it: every guard here must fire while parsing argv, before any
     * handler resolves a config. A guard that only fires afterwards is one a
     * misconfigured repository never reaches.
     */
    const BIN = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "bin",
        "content-build.mjs",
    );

    function run(...args: string[]) {
        const env = { ...process.env };
        delete env.PACKAGE_BUILD_CONFIG;
        const r = spawnSync(process.execPath, [BIN, ...args], {
            cwd: tmp,
            env,
            encoding: "utf8",
        });
        return { code: r.status, shown: (r.stdout ?? "") + (r.stderr ?? "") };
    }

    it("is listed among the commands", () => {
        // Matched on the usage form, not the bare word: `lint`'s description
        // already says "addresses", so a substring check passes vacuously.
        expect(run().shown).toMatch(/addresses <action>/);
    });

    it("rejects `addresses` with no action, naming the one it takes", () => {
        const { code, shown } = run("addresses");
        expect(code).not.toBe(0);
        expect(shown).toContain("diff");
    });

    it("rejects an action it does not have", () => {
        expect(run("addresses", "compare").code).not.toBe(0);
    });

    it("refuses to diff against a baseline nobody named", () => {
        // Without this it would resolve a config, compile nothing, and have to
        // invent what "the previous release" is.
        const { code, shown } = run("addresses", "diff");
        expect(code).not.toBe(0);
        expect(shown).toContain("--from");
    });
});

describe("the live Tabri → Taburi rename (#66, sohl#1239)", () => {
    /*
     * The case the issue was raised from, reproduced from the real values: the
     * note kept `id: s5D6QJbw7ZbETxdN` and changed only `shortcode`, two days
     * after the `v0.8.2` tag that both satellites pin. Nothing in either
     * repository reported it.
     */
    it("is reported as a rename against the pinned v0.8.2 catalogue", () => {
        write(
            "released/Taburi_s5D6QJbw7ZbETxdN.json",
            itemDoc("weapongear", "Tabri", "s5D6QJbw7ZbETxdN", "Tabûri"),
        );
        write(
            "compiled/Taburi_s5D6QJbw7ZbETxdN.json",
            itemDoc("weapongear", "Taburi", "s5D6QJbw7ZbETxdN", "Tabûri"),
        );
        const findings = diffItemAddresses(
            readItemAddresses([path.join(tmp, "released")]),
            readItemAddresses([path.join(tmp, "compiled")]),
            { baseline: "sohl@0.8.2" },
        );
        expect(findings).toHaveLength(1);
        expect(formatAddressFinding(findings[0], {})).toContain(
            "weapongear:Tabri is no longer published; the same document " +
                "(s5D6QJbw7ZbETxdN) is now published as weapongear:Taburi",
        );
    });
});
