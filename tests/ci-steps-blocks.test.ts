/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { stepsIn } from "../ci/ci-steps.mjs";

describe("CI workflow block steps", () => {
    it("keeps a block as one script with shell control flow and nested indentation", () => {
        const dir = mkdtempSync(join(tmpdir(), "ci-steps-block-"));
        const file = join(dir, "workflow.yml");
        try {
            writeFileSync(
                file,
                [
                    "steps:",
                    "  - name: Conditional",
                    "    run: |",
                    "      set -euo pipefail",
                    '      if [ -n "$VALUE" ]; then',
                    "        echo yes",
                    "      fi",
                    "  - name: Inline",
                    "    run: echo done",
                ].join("\n"),
            );
            const steps = stepsIn(file).run;
            expect(steps).toHaveLength(2);
            expect(steps[0].run).toBe(
                'set -euo pipefail\nif [ -n "$VALUE" ]; then\n  echo yes\nfi',
            );
            expect(steps[1]).toEqual({ name: "Inline", run: "echo done" });
            const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", steps[0].run], {
                encoding: "utf8",
                env: { ...process.env, VALUE: "set" },
            });
            expect(result.status).toBe(0);
            expect(result.stdout.trim()).toBe("yes");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
