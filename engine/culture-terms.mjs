/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/** Culture field declaration. @module */
/**
 * The `data.culture` field, declared once and spread into each type that takes
 * it. A type gives its own `describe` where the field means something narrower
 * there.
 *
 * @type {Readonly<object>}
 */
export function cultureField(checkCultureChoice) {
    return Object.freeze({
        name: "culture",
        shape: "an Address",
        kind: "address",
        ref: "lore",
        accepts: Object.freeze(["lore"]),
        check: checkCultureChoice,
        describe: "The people this note belongs to, as a culture lore note.",
    });
}
