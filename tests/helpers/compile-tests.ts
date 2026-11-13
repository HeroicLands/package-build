// SPDX-License-Identifier: GPL-3.0-or-later

import { spawnSync } from "node:child_process";

/** Enable real compiler fixtures only with explicit opt-in and an available compiler. */
export function compileTestsEnabled(
    optIn = process.env.PACKAGE_BUILD_COMPILE_TESTS,
    available = () => spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0,
): boolean {
    return optIn === "1" && available();
}
