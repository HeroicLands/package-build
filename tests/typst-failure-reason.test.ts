// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * A Typst that dies without printing anything still gives the book a reason:
 * the signal that killed it, or the exit code it returned.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileTypst } from "../engine/pdf-build.mjs";
import { readEntryPages } from "../engine/pdf-pages.mjs";

let dir: string;
let killed: string;
let silent: string;
let loud: string;

/**
 * Write an executable stand-in for the compiler.
 *
 * @param name - The file name.
 * @param body - The node program it runs.
 * @returns The path to the stand-in.
 */
function standIn(name: string, body: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
    return file;
}

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typst-failure-"));
    killed = standIn("killed", "process.kill(process.pid, 'SIGKILL');");
    silent = standIn("silent", "process.exit(3);");
    loud = standIn("loud", "console.error('error: no such font'); process.exit(1);");
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("a compiler killed by a signal", () => {
    it("is named by the compile", () => {
        const result = compileTypst("book.typ", "book.pdf", { binary: killed });
        expect(result.ok).toBe(false);
        expect(result.message).toContain("was killed by SIGKILL");
        expect(result.message).toContain("memory limit");
    });

    it("is named by the page measurement", () => {
        const result = readEntryPages("book.typ", [], killed);
        expect(result.ok).toBe(false);
        expect(result.message).toContain("was killed by SIGKILL");
        expect(result.message).toContain("memory limit");
    });

    it("names a signal that is not usually the memory limit without saying so", () => {
        const term = standIn("term", "process.kill(process.pid, 'SIGTERM');");
        const result = compileTypst("book.typ", "book.pdf", { binary: term });
        expect(result.message).toContain("was killed by SIGTERM");
        expect(result.message).not.toContain("memory limit");
    });
});

describe("a compiler that exits non-zero", () => {
    it("reports the exit code when it printed nothing", () => {
        expect(compileTypst("book.typ", "book.pdf", { binary: silent }).message).toContain(
            "exited with code 3",
        );
        expect(readEntryPages("book.typ", [], silent).message).toContain("exited with code 3");
    });

    it("reports the first line it printed", () => {
        const result = compileTypst("book.typ", "book.pdf", { binary: loud });
        expect(result.message).toContain("failed: error: no such font");
    });
});
