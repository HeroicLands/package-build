/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps the consumer proof helpers out of the published package", () => {
    const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(output);
    const expected = "@heroiclands/package-build";
    const entries: [string, any][] =
        Array.isArray(parsed) ? parsed.map((value) => ["", value])
        : parsed && Array.isArray(parsed.files) ? [["", parsed]]
        : parsed && typeof parsed === "object" ? Object.entries(parsed)
        : [];
    const matching = entries.filter(
        ([key, value]) =>
            value &&
            typeof value === "object" &&
            (value.name === expected || key === expected || key.startsWith(`${expected}@`)),
    );
    expect(matching).toHaveLength(1);
    expect(Array.isArray(matching[0][1].files)).toBe(true);
    const paths = matching[0][1].files.map((file: { path: string }) => file.path);
    expect(paths).not.toContain("ci/consumer-proof.sh");
    expect(paths).not.toContain("ci/consumer-art-proof.mjs");
    expect(paths).not.toContain("ci/consumer-lock-guard.mjs");
    expect(paths).not.toContain("ci/consumer-lock-guard.test.mjs");
    expect(paths).not.toContain("ci/consumer-proof-memory.sh");
    expect(paths).not.toContain("ci/content-memory-diagnostics.mjs");
    expect(paths).not.toContain("ci/encoding-consumer-overlay.mjs");
    expect(paths).toContain("ci/prettier.mjs");
});
