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
 * Publish this package's own content index, for the readers that are not this
 * process.
 *
 * Run by `prepack`, beside the declaration build and for the same reason: the
 * artifact is derived from what the tree already holds, so it belongs in the
 * tarball and not in the repository. A build inside this process never reads
 * it — {@link module:engine/packagebuild-index.packageBuildRecords} walks the
 * shipped tree — so an absent file makes nothing fail, and anything reading the
 * published form gets the same records the walk produces.
 *
 * Not a `package-build` subcommand: no consuming repository has a reason to run
 * it, and a CLI that offers one would be surface nobody asked for.
 */

import { emitPackageBuildIndex } from "../engine/packagebuild-index.mjs";

const { file, assets, bytes } = emitPackageBuildIndex();
console.log(`package-build: ${file} (${assets} asset(s), ${bytes} bytes)`);
