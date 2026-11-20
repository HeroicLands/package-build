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

import fs from "node:fs";
import path from "node:path";
import { channel } from "node:diagnostics_channel";
import { getHeapStatistics } from "node:v8";
import { threadId } from "node:worker_threads";

// Preloaded only by the consumer proof's full compile and its Node children.
const directory = process.env.CONSUMER_PROOF_MEMORY_DIR;
if (!directory) throw new Error("CONSUMER_PROOF_MEMORY_DIR is required");
const destination = path.join(directory, `node-${process.pid}-${threadId}.jsonl`);
const command = path.basename(process.argv[1] ?? "node");
let stage = "startup";
const record = (event) => {
    fs.appendFileSync(
        destination,
        `${JSON.stringify({
            time: new Date().toISOString(),
            pid: process.pid,
            ppid: process.ppid,
            threadId,
            command,
            stage,
            ...event,
            heapLimitBytes: getHeapStatistics().heap_size_limit,
            ...process.memoryUsage(),
            maxRssKiB: process.resourceUsage().maxRSS,
        })}\n`,
        { mode: 0o600 },
    );
};

channel("heroiclands.content.stage").subscribe((event) => {
    stage = event.stage;
    record(event);
});
record({ phase: "startup" });
setInterval(() => record({ phase: "sample" }), 10_000).unref();
process.on("exit", (code) => record({ phase: "exit", code }));
