/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A native button provides pointer, Enter and Space activation without taking
// keyboard events away from links within the independently revealed content.
document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".inline-secret-toggle");
    if (!button) return;
    const wrapper = button.parentElement;
    const content = button.nextElementSibling;
    if (!wrapper?.hasAttribute("data-inline-secret") || !content?.classList.contains("inline-secret-content")) return;
    const expanded = button.getAttribute("aria-expanded") !== "true";
    if (!expanded && content.contains(document.activeElement)) button.focus();
    content.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    const label = expanded ? "Hide spoiler" : "Show spoiler";
    button.setAttribute("aria-label", label);
    button.textContent = label;
});
