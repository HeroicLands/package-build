/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (
    process.env.RELEASE_EVENT === "pull_request" &&
    process.env.RELEASE_HEAD === "changeset-release/main"
) {
    const cli = fileURLToPath(new URL("../bin/package-build.mjs", import.meta.url));
    const result = spawnSync(
        process.execPath,
        [path.resolve(cli), "changelog", "check", "--release"],
        { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
