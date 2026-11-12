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

/** Compose a portrait's positive and optional negative channels from declared facts. @module */
import { createHash } from "node:crypto";
import { pathLabel } from "./data-keys.mjs";

const STYLES = Object.freeze({
    "flux-dev": {
        positive:
            "Realistic painterly portrait, head and shoulders, close framing, the subject looking at the viewer; dramatic atmospheric light, softly blurred environment; natural asymmetric face with visible skin texture and pores; individual strands of hair; no outlines, no flat colour fills, no full-body pose.",
    },
    "flux2-pro": {
        positive:
            "A realistic oil-painted portrait framed from the chest up, lit with dramatic atmospheric light against a softly blurred setting. The face belongs to an ordinary person: asymmetric, with visible skin texture and small imperfections, neither retouched nor idealised. No ink outlines, cartoon shading or full-length pose.",
    },
    sdxl: {
        positive:
            "realistic oil painting portrait, head and shoulders, dramatic atmospheric lighting, shallow depth of field, detailed skin texture, natural asymmetrical face, individual hair strands",
        negative:
            "cartoon, comic, ink outlines, flat colors, cel shading, full body, plain background, airbrushed skin, symmetrical face, glamour, model",
    },
});

const AGE_WORDS = Object.freeze({
    youth: ["freckles", "a few blemishes", "acne scars"],
    adult: ["ordinary skin with small marks", "fine lines at the eyes"],
    middle: ["lines across the brow", "lines around the mouth", "weathered skin", "some grey hair"],
    elder: ["deep wrinkles", "weathered skin", "age spots", "coarse thinning hair"],
});
const EXCLUDED =
    /(?:^\s*ink\s*$|\b(?:ink(?:ed|ing)|ink[ -]*(?:and[ -]*wash|wash|outlin(?:e|es|ed|ing)|illustrations?|paintings?|drawings?|sketch(?:es)?|contours?|style)|(?:drawn|rendered|painted)[ -]+in[ -]+ink|pen[ -]+and[ -]+ink|outlin(?:e|es|ed|ing)|cartoon(?:ish|s)?|cel(?:[ -]*shad(?:e|ed|ing))?|flat[ _–-]*colou?r(?:s|ed|ing)?|full[ _–-]*(?:body|length))\b)/iu;

/**
 * Check one authored value for an excluded style direction.
 * @param {unknown} value - The authored value.
 * @param {Array<string|number>} keyPath - Its frontmatter path.
 * @returns {(Error & {keyPath: Array<string|number>})|undefined} The located error, if any.
 */
export function portraitDirectionError(value, keyPath) {
    const match = typeof value === "string" ? EXCLUDED.exec(value) : null;
    return match ?
            Object.assign(
                new Error(`\`${pathLabel(keyPath)}\` contains excluded direction ${match[0]}`),
                {
                    keyPath,
                },
            )
        :   undefined;
}

/**
 * Require portrait framing in the generated positive channel.
 * @param {string} text - The positive prompt.
 * @returns {void}
 */
export function assertPortraitFraming(text) {
    if (!/\b(?:head[ -]+and[ -]+shoulders|chest[ -]+up)\b/iu.test(text))
        throw new Error("portrait prompt needs head-and-shoulders or chest-up framing");
}
/**
 * Adapt a model style to a bare head and require its own portrait framing.
 * @param {string} text - The model's positive style text.
 * @param {boolean} bareHead - Whether the subject has a bald or shaved head.
 * @returns {string} The adapted, checked style text.
 */
export function portraitModelText(text, bareHead) {
    const adapted =
        bareHead ?
            text
                .replace("; individual strands of hair", "")
                .replace(", individual hair strands", "")
        :   text;
    assertPortraitFraming(adapted);
    return adapted;
}
const label = (value) => String(value).replaceAll("_", " ");

/**
 * Compose the declared appearance and resolved items with a model's style.
 * Age detail is chosen deterministically from the seed. A clear complexion
 * excludes added marks. A bald or shaved head excludes the style's hair strands.
 * Authored clauses cannot request excluded styles or full-length framing.
 *
 * @param {object} facts - Resolved, declared portrait inputs.
 * @param {string} facts.style - `flux-dev`, `flux2-pro`, or `sdxl`.
 * @param {string|number} facts.seed - The seed for age detail.
 * @param {string} facts.ageBand - `youth`, `adult`, `middle`, or `elder`.
 * @param {string} [facts.gender] - The declared gender.
 * @param {string} [facts.frame] - The declared frame.
 * @param {object} [facts.look] - The being's appearance words.
 * @param {Array<{kind?: string, name?: string}>} [facts.items] - Items with resolved names and kinds.
 * @param {string[]} [facts.extra] - Additional prompt details.
 * @param {object[]} [facts.itemSources] - Authored entries for item diagnostic paths.
 * @returns {{positive: string, negative?: string}} The positive channel and,
 *   for `sdxl`, the separate negative channel.
 */
export function composePortrait({
    style,
    seed,
    ageBand,
    gender,
    frame,
    look = {},
    items = [],
    extra = [],
    itemSources = items,
}) {
    const selected = Object.hasOwn(STYLES, style) ? STYLES[style] : undefined;
    if (!selected) throw new Error(`unknown portrait style ${JSON.stringify(style)}`);
    const options = Object.hasOwn(AGE_WORDS, ageBand) ? AGE_WORDS[ageBand] : undefined;
    if (!options) throw new Error(`unknown portrait age band ${JSON.stringify(ageBand)}`);
    const clear = (look.complexion ?? []).includes("clear");
    const ages = { youth: "youthful", adult: "adult", middle: "middle-aged", elder: "elderly" };
    const bareHead = ["bald", "shaved"].includes(look.hair_style);
    const choices = options.filter(
        (option) =>
            !(bareHead && option.includes("hair")) &&
            !(clear && /freckles|blemishes|acne scars|age spots|small marks/.test(option)),
    );
    const hash = createHash("sha256").update(String(seed)).digest().readUInt32BE();
    const clauses = [
        gender === "female" ? "woman"
        : gender === "male" ? "man"
        : "person",
        frame && `${label(frame)} frame`,
        look.skin_color && `${label(look.skin_color)} skin`,
        !["bald", "shaved"].includes(look.hair_style) &&
            look.hair_color &&
            `${label(look.hair_color)} hair`,
        look.eye_color && `${label(look.eye_color)} eyes`,
        !["bald", "shaved"].includes(look.hair_style) &&
            look.hair_texture &&
            `${label(look.hair_texture)} hair`,
        look.hair_style &&
            (["bald", "shaved"].includes(look.hair_style) ?
                `${label(look.hair_style)} head`
            :   `${label(look.hair_style)} hair`),
        look.facial_hair &&
            (look.facial_hair === "none" ? "no facial hair" : label(look.facial_hair)),
        look.face_shape && `${label(look.face_shape)} face`,
        look.nose && `${label(look.nose)} nose`,
        look.brow && `${label(look.brow)} brows`,
        look.mouth && `${label(look.mouth)} mouth`,
        ...(look.complexion ?? []).map(label),
        ...(look.extra_features ?? []),
        choices.length ?
            `${ages[ageBand]} person with ${choices[hash % choices.length]}`
        :   `${ages[ageBand]} person`,
        ...items
            .filter((item) => ["clothing", "armor"].includes(item.kind) && item.name)
            .map((item) => `wearing ${item.name}`),
        ...items
            .filter((item) => ["weapon", "container", "miscgear"].includes(item.kind) && item.name)
            .map((item) => `carrying ${item.name}`),
        ...extra,
    ].filter(Boolean);
    for (const [at, value] of (look.extra_features ?? []).entries()) {
        const error = portraitDirectionError(value, ["data", "appearance", "extra_features", at]);
        if (error) throw error;
    }
    for (const [at, item] of items.entries()) {
        if (!["clothing", "armor", "weapon", "container", "miscgear"].includes(item.kind)) continue;
        const source = itemSources[at] ?? item;
        const key = source.name ? "name" : "model";
        const error = portraitDirectionError(item.name, ["data", "items", at, key]);
        if (error) throw error;
    }
    for (const [at, value] of extra.entries()) {
        const error = portraitDirectionError(value, ["data", "portraitSettings", "extras", at]);
        if (error) throw error;
    }
    const suffix = portraitModelText(selected.positive, bareHead);
    const positive = [...clauses, suffix].join(", ");
    return {
        positive,
        ...(selected.negative ? { negative: selected.negative } : {}),
    };
}
