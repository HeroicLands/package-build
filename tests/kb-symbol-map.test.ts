/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The `sohlKb` pass's TypeDoc symbol map (#75).
 *
 * The map is the only thing standing between a `{@link}` tag and a code span,
 * and it used to be read with a cwd-relative path inside a bare `catch` that
 * returned `{}`. Missing file, malformed JSON, permissions error and typo were
 * indistinguishable from each other *and* from a correctly configured build
 * with no symbols — so the failure had no observable state at all, and the
 * first observer was a reader with nothing to click.
 *
 * The cases below pin the three configured states the acceptance criteria name
 * — unconfigured, configured-and-valid, configured-and-broken — plus the one a
 * unit test most easily misses: that a repo-relative path resolves to the same
 * file whatever directory the build was invoked from.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "loglevel";

import { sohlKbPass } from "../sohl/kb-passes.mjs";

/** A repository root holding a symbol map at the configured relative path. */
let root: string;
/** A directory that is emphatically not the repository root. */
let elsewhere: string;
/** The cwd the suite started in, restored after every chdir. */
const startCwd = process.cwd();

const MAP_REL = "kb/data/api-symbols.json";
const API_BASE = "/sohl/api/";

/** The one tag every case renders, so the assertions compare like with like. */
const BODY = "See {@link SohlActor} for the document.\n";
/** What a resolved map renders it as. */
const LINKED = "[SohlActor](/sohl/api/classes/SohlActor.html)";
/** What an empty map degrades it to. */
const DEGRADED = "`SohlActor`";

function writeMap(dir: string, rel: string, text: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

/** Runs `fn` with the process cwd set to `dir`, then puts it back. */
function inDirectory<T>(dir: string, fn: () => T): T {
    process.chdir(dir);
    try {
        return fn();
    } finally {
        process.chdir(startCwd);
    }
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-symbols-"));
    elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elsewhere-"));
    writeMap(root, MAP_REL, JSON.stringify({ SohlActor: "classes/SohlActor.html" }));
});

afterAll(() => {
    process.chdir(startCwd);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
});

describe("an unconfigured symbol map is the legitimate empty case", () => {
    it("builds, degrades every tag, and says nothing", () => {
        const info = vi.spyOn(log, "info").mockImplementation(() => {});
        try {
            const pass = sohlKbPass({ repoRoot: root, apiBase: API_BASE });
            expect(pass.beforeLinks(BODY)).toContain(DEGRADED);
            expect(info).not.toHaveBeenCalled();
        } finally {
            info.mockRestore();
        }
    });
});

describe("a configured, valid symbol map resolves its tags", () => {
    it("links a symbol the map knows", () => {
        const pass = sohlKbPass({
            repoRoot: root,
            apiBase: API_BASE,
            symbolMap: MAP_REL,
        });
        expect(pass.beforeLinks(BODY)).toContain(LINKED);
    });

    it("reports the count, so a loaded-but-empty map is distinguishable", () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cb-empty-"));
        writeMap(empty, MAP_REL, "{}");
        const lines: string[] = [];
        const info = vi.spyOn(log, "info").mockImplementation((...args: unknown[]) => {
            lines.push(args.join(" "));
        });
        try {
            sohlKbPass({
                repoRoot: empty,
                apiBase: API_BASE,
                symbolMap: MAP_REL,
            });
            expect(lines.join("\n")).toMatch(/\b0\b/);
            expect(lines.join("\n")).toContain(MAP_REL);
        } finally {
            info.mockRestore();
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });
});

describe("a configured symbol map that cannot be used fails the build", () => {
    it("refuses a path that is not there, naming it", () => {
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), "cb-bare-"));
        try {
            expect(() =>
                sohlKbPass({
                    repoRoot: bare,
                    apiBase: API_BASE,
                    symbolMap: MAP_REL,
                }),
            ).toThrow(new RegExp(path.join(bare, MAP_REL).replace(/\\/g, "/")));
        } finally {
            fs.rmSync(bare, { recursive: true, force: true });
        }
    });

    it("refuses a file that is not JSON, naming the reason", () => {
        const bad = fs.mkdtempSync(path.join(os.tmpdir(), "cb-bad-"));
        writeMap(bad, MAP_REL, "{ not json");
        try {
            expect(() =>
                sohlKbPass({
                    repoRoot: bad,
                    apiBase: API_BASE,
                    symbolMap: MAP_REL,
                }),
            ).toThrow(/JSON/);
        } finally {
            fs.rmSync(bad, { recursive: true, force: true });
        }
    });

    it("refuses JSON that is not a name → page mapping", () => {
        // `[]` and `"x"` parse, and then every lookup silently misses — the
        // exact outcome the bare `catch` produced, reached a different way.
        const list = fs.mkdtempSync(path.join(os.tmpdir(), "cb-list-"));
        writeMap(list, MAP_REL, "[]");
        try {
            expect(() =>
                sohlKbPass({
                    repoRoot: list,
                    apiBase: API_BASE,
                    symbolMap: MAP_REL,
                }),
            ).toThrow(/object/);
        } finally {
            fs.rmSync(list, { recursive: true, force: true });
        }
    });
});

describe("the map resolves against the repository, not the cwd", () => {
    it("reads the same file from the root and from anywhere else", () => {
        const options = {
            repoRoot: root,
            apiBase: API_BASE,
            symbolMap: MAP_REL,
        };
        const fromRoot = inDirectory(root, () => sohlKbPass(options).beforeLinks(BODY));
        const fromElsewhere = inDirectory(elsewhere, () => sohlKbPass(options).beforeLinks(BODY));
        expect(fromRoot).toContain(LINKED);
        expect(fromElsewhere).toBe(fromRoot);
    });

    it("does not read a same-named map that happens to sit in the cwd", () => {
        // The decisive case: the cwd holds a *different* map at the same
        // relative path. A cwd-relative read finds it and silently publishes
        // the wrong links; a repo-relative read never sees it.
        const decoy = fs.mkdtempSync(path.join(os.tmpdir(), "cb-decoy-"));
        writeMap(decoy, MAP_REL, JSON.stringify({ SohlActor: "WRONG/decoy.html" }));
        try {
            const out = inDirectory(decoy, () =>
                sohlKbPass({
                    repoRoot: root,
                    apiBase: API_BASE,
                    symbolMap: MAP_REL,
                }).beforeLinks(BODY),
            );
            expect(out).toContain(LINKED);
            expect(out).not.toContain("decoy");
        } finally {
            fs.rmSync(decoy, { recursive: true, force: true });
        }
    });

    it("refuses a relative map with no repository root to resolve it against", () => {
        // Falling back to the cwd here is how the defect would return.
        expect(() => sohlKbPass({ symbolMap: MAP_REL } as never)).toThrow(/repoRoot/);
    });
});
