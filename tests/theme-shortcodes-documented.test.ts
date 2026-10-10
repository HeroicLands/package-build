/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `docs/authoring/links-and-markup.md` documents every shortcode the Hugo
 * theme defines.
 *
 * The shortcode names are the files in `hugo-theme/layouts/shortcodes/`,
 * listed at run time, so a shortcode added to the theme is a shortcode the
 * reference must describe. Each needs a heading naming it in code and a worked
 * `{{< name … >}}` call.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHORTCODES_DIR = path.join(ROOT, "hugo-theme/layouts/shortcodes");
const DOC = fs.readFileSync(path.join(ROOT, "docs/authoring/links-and-markup.md"), "utf8");

const names = fs
    .readdirSync(SHORTCODES_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .sort();

describe("theme shortcodes are documented", () => {
    it("finds the theme's shortcodes", () => {
        expect(names.length).toBeGreaterThan(0);
    });

    for (const name of names) {
        it(`${name} has a heading`, () => {
            const heading = new RegExp(`^#{2,4} .*\`${name}\``, "m");
            expect(DOC, `no heading naming \`${name}\``).toMatch(heading);
        });

        it(`${name} has a worked call`, () => {
            const call = new RegExp(`\\{\\{< ${name}[ >]`);
            expect(DOC, `no {{< ${name} … >}} example`).toMatch(call);
        });
    }
});
