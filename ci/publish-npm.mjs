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

/**
 * Publish this package to npm, with provenance wherever it can be generated.
 *
 * `publishConfig.provenance` is `true`, and npm refuses a publish with
 * `Automatic provenance generation not supported for provider: null` anywhere
 * that cannot mint a Sigstore identity. That is a CI runner holding an OIDC
 * token: GitHub Actions with `id-token: write`, which exposes
 * `ACTIONS_ID_TOKEN_REQUEST_URL`, or GitLab CI with `SIGSTORE_ID_TOKEN`.
 * Everywhere else — a desk — this passes `--provenance=false`, so the publish
 * goes ahead unattested rather than failing.
 *
 * Arguments after `--` reach `npm publish` unchanged, so
 * `npm run deploy:npm -- --dry-run` shows the tarball without publishing it.
 * `prepack` builds the declarations and the asset index on the way.
 *
 * Not a `package-build` subcommand: it publishes this package and no other.
 */

import { spawnSync } from "node:child_process";

const env = process.env;
const provenance =
    (env.GITHUB_ACTIONS === "true" && Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL)) ||
    (env.GITLAB_CI === "true" && Boolean(env.SIGSTORE_ID_TOKEN));

if (!provenance) {
    console.log("deploy:npm: no OIDC identity here; publishing without provenance.");
}

const args = ["publish", ...(provenance ? ["--provenance"] : ["--provenance=false"])];
const result = spawnSync("npm", [...args, ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: process.platform === "win32",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
