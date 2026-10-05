/*
 * This file is part of the Heroic Lands shared Hugo theme.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * CI guard: every banner `data/banners.yaml` declares must actually be published.
 *
 * `partials/hero-banner.html` needs to know which banner images exist, and Hugo
 * cannot ask a remote asset host that question at build time — so the answer is
 * declared in `data/banners.yaml` instead. A declaration nothing
 * checks is kept in step by hope, and the hole it was written to close reopens
 * the first time it drifts. It already had: when this check was written, four
 * names present in a local working copy of the artwork repository were not
 * published, and three that were published appeared in no local copy at all.
 *
 * So this fetches every declared name and fails on any non-200. It is the test
 * the template cannot make, moved to the one place that can make it.
 *
 * Usage:
 *   node utils/check-banners.mjs [--base <url>] [--concurrency <n>]
 *
 * The host defaults to the Heroic Lands CDN and can be pointed anywhere with
 * `--base` or `BANNER_BASE_URL`, so a consumer publishing its own artwork set
 * can run the same check against its own `data/banners.yaml`.
 *
 * A network failure is reported as a failure rather than skipped: a check that
 * passes when it could not reach the host is worse than no check at all.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(HERE, "..", "hugo-theme", "data", "banners.yaml");
const DEFAULT_BASE = "https://cdn.heroiclands.org";

function parseArgs(argv) {
    const opts = {
        base: process.env.BANNER_BASE_URL || DEFAULT_BASE,
        concurrency: 8,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--base") opts.base = argv[(i += 1)];
        else if (arg === "--concurrency") opts.concurrency = Number(argv[(i += 1)]);
        else {
            console.error(`check-banners: unrecognised argument ${arg}`);
            process.exit(2);
        }
    }
    if (!opts.base) {
        console.error("check-banners: no asset host; pass --base or set BANNER_BASE_URL");
        process.exit(2);
    }
    if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
        console.error("check-banners: --concurrency must be a positive integer");
        process.exit(2);
    }
    return opts;
}

/** Diagnostics carry the fields they can know and drop the ones they cannot. */
function diag(line, message) {
    const where = line ? `${DATA_FILE}:${line}` : DATA_FILE;
    console.error(`${where}: error: ${message}`);
}

function fail(message, line) {
    diag(line, message);
    process.exit(1);
}

/** Line number of a declared name, so an editor can jump straight to it. */
function lineOf(source, name) {
    const index = source
        .split("\n")
        .findIndex((l) => l.trim() === `- ${name}` || l.trim() === `- "${name}"`);
    return index === -1 ? 0 : index + 1;
}

/** Read and validate the inventory, so a malformed file fails loudly. */
function readInventory() {
    const source = readFileSync(DATA_FILE, "utf8");
    const data = parse(source);
    const dir = data?.dir;
    const fallback = data?.fallback;
    const available = data?.available;

    if (typeof dir !== "string" || !dir) fail("`dir` must be a non-empty string");
    if (typeof fallback !== "string" || !fallback) fail("`fallback` must be a non-empty string");
    if (!Array.isArray(available) || available.length === 0)
        fail("`available` must be a non-empty list");
    if (available.some((n) => typeof n !== "string" || !n))
        fail("`available` must hold only non-empty strings");

    const dupes = [...new Set(available.filter((n, i) => available.indexOf(n) !== i))];
    if (dupes.length) fail(`duplicate names: ${dupes.join(", ")}`, lineOf(source, dupes[0]));

    const unsorted = available.findIndex((n, i) => i > 0 && available[i - 1] > n);
    if (unsorted !== -1)
        fail(
            "`available` must be sorted, so a diff shows what changed",
            lineOf(source, available[unsorted]),
        );

    // The fallback is what every unlisted name resolves to, so its absence would
    // turn one dead URL into every dead URL.
    const fallbackName = fallback.replace(/\.[^./]+$/, "");
    if (!available.includes(fallbackName))
        fail(`the fallback ${fallback} is not itself listed in \`available\``);

    return { source, dir, available };
}

async function probe(url) {
    try {
        // HEAD first — it is what the question actually is. Some object stores
        // answer 405 to it, so fall back to a ranged GET rather than reporting a
        // published file as missing.
        let res = await fetch(url, { method: "HEAD", redirect: "follow" });
        if (res.status === 405 || res.status === 501) {
            res = await fetch(url, {
                headers: { Range: "bytes=0-0" },
                redirect: "follow",
            });
        }
        return {
            ok: res.status === 200 || res.status === 206,
            status: String(res.status),
        };
    } catch (err) {
        return { ok: false, status: `network error: ${err.message}` };
    }
}

async function main() {
    const { base, concurrency } = parseArgs(process.argv.slice(2));
    const { source, dir, available } = readInventory();
    const root = `${base.replace(/\/$/, "")}/${dir.replace(/^\//, "")}`;

    const failures = [];
    const queue = [...available];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
            const url = `${root}/${name}.webp`;
            const { ok, status } = await probe(url);
            if (!ok) failures.push({ name, url, status });
        }
    });
    await Promise.all(workers);

    if (failures.length) {
        failures.sort((a, b) => a.name.localeCompare(b.name));
        for (const { name, url, status } of failures) {
            diag(
                lineOf(source, name),
                `declared banner ${name} is not published (${status}): ${url}`,
            );
        }
        console.error(
            `check-banners: ${failures.length} of ${available.length} declared banners are missing from ${base}.`,
        );
        console.error(
            "Publish the artwork, or drop the name — an undrawn name here is a 404 on every page that resolves to it.",
        );
        process.exit(1);
    }

    console.log(`check-banners: all ${available.length} declared banners resolve at ${base}`);
}

await main();
