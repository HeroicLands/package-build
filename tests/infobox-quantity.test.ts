/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A number in a profile reads as a reader reads it: in full with separators
 * under a million, and in words from a million up.
 */

import { describe, expect, it } from "vitest";
import { formatQuantity } from "../engine/infobox.mjs";

describe("formatQuantity", () => {
    it("writes a number under a million in full, with thousands separators", () => {
        expect(formatQuantity(0)).toBe("0");
        expect(formatQuantity(850)).toBe("850");
        expect(formatQuantity(12500)).toBe("12,500");
        expect(formatQuantity(999999)).toBe("999,999");
        expect(formatQuantity(-15000)).toBe("-15,000");
    });

    it("keeps the decimals a smaller number was written with", () => {
        expect(formatQuantity(1.1)).toBe("1.1");
        expect(formatQuantity(1234.5)).toBe("1,234.5");
    });

    it("writes a million and up in words, with at most one decimal", () => {
        expect(formatQuantity(1000000)).toBe("1 million");
        expect(formatQuantity(11000000)).toBe("11 million");
        expect(formatQuantity(1250000)).toBe("1.3 million");
        expect(formatQuantity(2.4e9)).toBe("2.4 billion");
    });

    it("calls a figure that rounds to a thousand million a billion", () => {
        expect(formatQuantity(999949999)).toBe("999.9 million");
        expect(formatQuantity(999950000)).toBe("1 billion");
    });

    it("leaves a value that is not a number as written", () => {
        expect(formatQuantity("about a hundred" as unknown as number)).toBe("about a hundred");
    });
});
