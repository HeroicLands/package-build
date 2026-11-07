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

import path from "node:path";
import { fileURLToPath } from "node:url";

/** The shared phonetic sheet, faces and notices, rooted for a publishing target.
 * @param {string} root Target directory; relative paths remain relative.
 * @param {string} [styles="styles"] The target's stylesheet directory.
 * @returns {Array<[string,string]>} Installed source and output destination pairs.
 */
export function phoneticAssetEntries(root, styles = "styles") {
    const assets = fileURLToPath(new URL("../assets/", import.meta.url));
    return [
        [
            path.join(assets, "styles/phonetic.css"),
            path.join(root, styles, "package-build-ipa.css"),
        ],
        ...["LibertinusSans-Regular.otf", "OFL.txt", "provenance.yaml"].map((file) => [
            path.join(assets, "fonts/libertinus", file),
            path.join(root, "fonts/package-build-ipa", file),
        ]),
    ];
}
