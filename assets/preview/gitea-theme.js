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

// Installed by the Gitea administrator, outside user-authored rendered markup.
(() => {
    const root = document.documentElement;
    function update() {
        const scheme = getComputedStyle(root).getPropertyValue("--is-dark-theme").trim();
        // An unknown custom theme keeps the renderer's explicit initial mode.
        if (scheme !== "true" && scheme !== "false") return;
        for (const preview of document.querySelectorAll(".markup.markdown .hl-preview")) {
            preview.classList.toggle("hl-preview-dark", scheme === "true");
            preview.classList.toggle("hl-preview-light", scheme === "false");
        }
    }
    new MutationObserver(update).observe(root, {
        attributes: true,
        attributeFilter: ["data-theme"],
        childList: true,
        subtree: true,
    });
    // Theme stylesheets can finish loading after data-theme changes.
    document.addEventListener("load", update, true);
    document.addEventListener("DOMContentLoaded", update, { once: true });
    update();
})();
