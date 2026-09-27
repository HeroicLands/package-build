/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = path.join(
    path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    "bin/package-build.mjs",
);
let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "package-build-date-cli-"));
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "calendar-fixture", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: documentation
publish: { site: content }
`,
    );
    fs.writeFileSync(
        path.join(root, "assets/content/World.md"),
        `---
shortcode: world
name: { full: World }
type: place
subType: world
data:
  year: { days: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 }
---
`,
    );
    fs.writeFileSync(
        path.join(root, "assets/content/Calendar.md"),
        `---
shortcode: vrcal
name: { full: Common Calendar }
type: lore
subType: calendar
data:
  months: [{ name: First, days: 30 }, { name: Second, days: 31 }, { name: Third, days: 30 }, { name: Taranis, days: 31 }, { name: Fifth, days: 243 }]
  eras: [{ shortcode: founding, marker: VR, abbreviation: VR, start: 1.1 }]
---
`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(...args: string[]) {
    return spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
    });
}

describe("date conversion commands", () => {
    it("prints only the exact converted value", () => {
        const from = run("datefrom", "vrcal", "23 Taranis 326 VR");
        expect(from.status).toBe(0);
        expect(from.stdout).toBe("326.114\n");
        const to = run("dateto", "vrcal", "326.114");
        expect(to.status).toBe(0);
        expect(to.stdout).toBe("23 Taranis 326 VR\n");
    });

    it("rejects a date without a day", () => {
        const result = run("datefrom", "vrcal", "326 VR");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("precise to the day");
    });
});
