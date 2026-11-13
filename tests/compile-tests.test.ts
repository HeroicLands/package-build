// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import { compileTestsEnabled } from "./helpers/compile-tests.js";

describe("compiler fixture selection", () => {
    it.each([undefined, "", "0", "true"])("does not probe without opt-in: %s", (value) => {
        const available = vi.fn(() => true);
        expect(compileTestsEnabled(value ?? "", available)).toBe(false);
        expect(available).not.toHaveBeenCalled();
    });

    it.each([true, false])("requires compiler availability: %s", (present) => {
        const available = vi.fn(() => present);
        expect(compileTestsEnabled("1", available)).toBe(present);
        expect(available).toHaveBeenCalledOnce();
    });
});
