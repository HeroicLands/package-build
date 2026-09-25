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
 * One art slot: the key a note authors, and the type a bare value takes.
 *
 * @typedef {object} ArtSlot
 * @property {string} key - The key under `data:`.
 * @property {string} type - The asset type a bare shortcode defaults to.
 * @property {readonly string[]} accepts - The types an authored value may
 *   name. **Not the default** — a faith tradition's profile art is a full
 *   illustration rather than a game icon, so an `icon` slot's default stays
 *   `icon` while its accepted set also takes `image`. A value naming a type
 *   outside it is an error, against this set rather than against `type`.
 * @property {boolean} document - Whether the slot reaches a compiled document.
 * @property {string} describe - One line, for the author-facing reference.
 */

/**
 * What every art slot accepts, whichever type it defaults to.
 *
 * A sound is not art: `audio` is refused at all four slots, and every slot
 * that defaults to `icon` or to `image` accepts either — the corpus is why:
 * `sohl-kethira-basic` writes a deity's profile art as `icon: image-…` twenty
 * times, one full illustration per faith tradition, and a slot refusing the
 * type it did not default to would refuse that content.
 *
 * @type {readonly string[]}
 */
const ART_TYPES = Object.freeze(["icon", "image"]);

/**
 * The four art slots, in the order the specification tabulates them.
 *
 * `banner` is the one that reaches no compiled document: it is the page's hero
 * image, read by the site and by the book's section plates and by nothing else.
 * That is what `document: false` states, and it is why the inert-art check
 * skips it — a key that is *meant* to reach no document is not an inert key.
 *
 * @type {readonly ArtSlot[]}
 */
export const ART_SLOTS = Object.freeze([
    Object.freeze({
        key: "icon",
        type: "icon",
        accepts: ART_TYPES,
        document: true,
        describe: "The document's profile art, resolved into `img`.",
    }),
    Object.freeze({
        key: "tokenIcon",
        type: "icon",
        accepts: ART_TYPES,
        document: true,
        describe: "What a token on the canvas wears; unset, it follows `icon`.",
    }),
    Object.freeze({
        key: "bgImage",
        type: "image",
        accepts: ART_TYPES,
        document: true,
        describe: "A map's background art, resolved into `background.src`.",
    }),
    Object.freeze({
        key: "banner",
        type: "image",
        accepts: ART_TYPES,
        document: false,
        describe: "The page's hero image. Reaches no compiled document.",
    }),
]);
