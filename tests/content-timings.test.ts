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
import { channel } from "node:diagnostics_channel";
import { describe, expect, it } from "vitest";
import { createContentTimings } from "../engine/content-timings.mjs";

describe("content timings", () => {
    it("publishes nested stage transitions and records hits and durations", async () => {
        const events: unknown[] = [];
        const stages = channel("heroiclands.content.stage");
        const record = (event: unknown) => events.push(event);
        stages.subscribe(record);
        try {
            const timings = createContentTimings();
            const result = await timings.measure("outer", async () => {
                timings.hit("note");
                timings.hit("note");
                return timings.sync("inner", () => 42);
            });
            expect(result).toBe(42);
            expect(events).toEqual([
                { phase: "start", stage: "outer" },
                { phase: "start", stage: "inner" },
                { phase: "end", stage: "outer", completed: "inner" },
                { phase: "end", stage: "orchestration", completed: "outer" },
            ]);
            const snapshot = timings.snapshot();
            expect(snapshot.hits).toEqual({ note: 2 });
            expect(Object.keys(snapshot.stages)).toEqual(
                expect.arrayContaining(["orchestration", "outer", "inner"]),
            );
            expect(Object.values(snapshot.stages).every((duration) => duration >= 0)).toBe(true);
            expect(snapshot.totalMs).toBeGreaterThanOrEqual(0);
        } finally {
            stages.unsubscribe(record);
        }
    });

    it("ends a failed stage and ignores a nested stop after its parent ends", () => {
        const events: unknown[] = [];
        const stages = channel("heroiclands.content.stage");
        const record = (event: unknown) => events.push(event);
        stages.subscribe(record);
        try {
            const timings = createContentTimings();
            let stopInner = () => {};
            expect(() =>
                timings.sync("outer", () => {
                    stopInner = timings.start("inner");
                    throw new Error("failure");
                }),
            ).toThrow("failure");
            stopInner();
            expect(events).toEqual([
                { phase: "start", stage: "outer" },
                { phase: "start", stage: "inner" },
                { phase: "end", stage: "orchestration", completed: "outer" },
            ]);
        } finally {
            stages.unsubscribe(record);
        }
    });
});
