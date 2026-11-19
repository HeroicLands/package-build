#!/usr/bin/env node
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

/** Report the installed version without loading command dependencies. */
import fs from "node:fs";

if (process.argv.length === 3 && process.argv[2] === "--version") {
    const manifest = JSON.parse(
        fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    console.log(manifest.version);
} else {
    await import("./package-build-commands.mjs");
}
