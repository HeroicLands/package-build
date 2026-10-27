/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The `languages:` the dictionary fixture tree is configured with: each
 * language note of `tests/fixtures/dictionary/tree/Skills`, by the code its
 * notes state in `data.lang`.
 */
export const DICTIONARY_LANGUAGES = Object.freeze({
    byzar: { tag: "art-x-byzar", note: "skill-byzarlng" },
    helonc: { tag: "art-x-helonc", note: "skill-helonclng" },
    litrg: { tag: "art-x-litrg", note: "skill-litrglng" },
    elvndr: { tag: "art-x-elvndr", note: "skill-elvndrlng" },
    elder: { tag: "art-x-elder", note: "skill-elderlng" },
    nordm: { tag: "art-x-nordm", note: "skill-nordmlng" },
    provnz: { tag: "art-x-provnz", note: "skill-provnzlng" },
});
