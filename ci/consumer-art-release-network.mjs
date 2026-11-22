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
import assert from "node:assert/strict";
import fs from "node:fs";

/** Observe real archive requests, refusing the warm phase before network access. */
export function archiveFetch(fetch, urls, phase, record) {
    assert.ok(["cold", "warm"].includes(phase));
    const archives = new Set(urls);
    return async (input, options) => {
        const url =
            typeof input === "string" ? input
            : input instanceof URL ? input.href
            : input.url;
        if (archives.has(url)) {
            record(url);
            assert.notEqual(phase, "warm", "warm artwork cache attempted an archive download");
        }
        return fetch(input, options);
    };
}

if (process.env.ART_RELEASE_PROOF_NETWORK) {
    assert.ok(
        process.env.GITHUB_ACTIONS === "true" || process.env.GITEA_ACTIONS === "true",
        "CI only",
    );
    const { urls, phase, log } = JSON.parse(
        fs.readFileSync(process.env.ART_RELEASE_PROOF_NETWORK, "utf8"),
    );
    globalThis.fetch = archiveFetch(globalThis.fetch.bind(globalThis), urls, phase, (url) => {
        fs.appendFileSync(log, JSON.stringify({ phase, url }) + "\n");
    });
}
