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
/** Exact sound choices and the common guide's Roman token boundaries. */
import {
    SHARED_SOUNDS,
    SHARED_SOUND_CONTROLS,
    SHARED_SOUND_CODES,
    STANDARD_ROWS,
    validateGuideSounds,
} from "./encoding-standard.mjs";
const sounds = Object.values(SHARED_SOUNDS).sort((a, b) => b.roman.length - a.roman.length);
const byRoman = new Map(sounds.map((sound) => [sound.roman, sound]));
const vowel = (text) => byRoman.get(text.toLowerCase())?.kind.includes("vowel") ?? false;
const closingGlide = (roman) => roman === "iy" || roman === "uy";
const scalar = (text) =>
    typeof text === "string" && [...text].length === 1 && !/[\uD800-\uDFFF]/u.test(text);
const grapheme = (text) => /^[^\p{M}]\p{M}*/u.exec(text)?.[0];
function letter(text) {
    const raw = grapheme(text);
    if (!raw) return undefined;
    const nfd = raw.normalize("NFD");
    const marks = nfd.match(/\p{M}/gu) ?? [];
    return {
        raw,
        repeatedMark: new Set(marks).size !== marks.length,
        plain: nfd
            .replace(/[\u0301\u0308\u030C\u0302]/gu, "")
            .normalize("NFC")
            .replace("’", "'"),
        stress: nfd.includes("\u0301"),
        apart: nfd.includes("\u0308"),
        tone:
            nfd.includes("\u030C") ? "toneRising"
            : nfd.includes("\u0302") ? "toneFalling"
            : undefined,
        twoTones: nfd.includes("\u030C") && nfd.includes("\u0302"),
    };
}

/** Compile one glyph choice per sound in the language's own declared inventory. */
export function soundProgram(data, options, fault) {
    for (const key of ["vowels", "accepts"])
        if (data[key] !== undefined)
            fault(
                key,
                `Exact sound encodings derive ${key} from the shared guide and language inventory`,
            );
    const findings = validateGuideSounds(options.sounds);
    if (findings.length) fault("options.sounds", findings.join("; "));
    if (!options.sounds.length)
        fault(
            "options.sounds",
            "An exact sound encoding needs its language's data.sounds.letters inventory",
        );
    for (const key of Object.keys(data.rules))
        if (!["normalization", "matching", "roundTrip"].includes(key))
            fault(
                `rules.${key}`,
                "Sound spellings, stress, case and separators follow the shared guide; state only normalization, matching and roundTrip",
            );
    const inventory = new Map(
        options.sounds.map((row) => {
            const sound = typeof row === "string" ? byRoman.get(row) : SHARED_SOUNDS[row.ipa];
            return [sound.roman, sound];
        }),
    );
    for (const [code, invisible] of Object.entries(SHARED_SOUND_CODES))
        if (Object.hasOwn(options.codes, code) && options.codes[code] !== invisible)
            fault(
                `options.codes.${code}`,
                `Shared code ${code} must resolve to its allocated invisible character`,
            );
    const outputs = new Map();
    const choices = new Map();
    const rows = [];
    const shared = new Set(Object.values(SHARED_SOUNDS).map((sound) => sound.invisible));
    const resolve = (from, value) => {
        const code = Array.isArray(value) && value.length === 1 ? value[0] : value;
        const target =
            typeof code === "string" && Object.hasOwn(options.codes, code) ?
                options.codes[code]
            :   undefined;
        if (!scalar(target))
            fault(
                `mappings.${from}`,
                `Each sound chooses one published glyph code resolving to one Unicode scalar; invalid code ${String(code)}`,
            );
        return target;
    };
    for (const [roman, sound] of inventory) {
        if (!Object.hasOwn(data.mappings, roman))
            fault(
                `mappings.${roman}`,
                `Missing form for the language's sound ${roman} /${sound.ipa}/`,
            );
        const target = resolve(roman, data.mappings[roman]);
        if (shared.has(target) && target !== sound.invisible)
            fault(
                `mappings.${roman}`,
                `The invisible form must be the shared character for /${sound.ipa}/`,
            );
        choices.set(roman, target);
    }
    for (const [from, code] of Object.entries(data.mappings)) {
        const roman = from.toLowerCase();
        if (!inventory.has(roman) && !/^\d$/u.test(from))
            fault(
                `mappings.${from}`,
                "Map only declared guide sounds, their capital forms, and digits",
            );
        const to = resolve(from, code);
        if (/[\u{E0100}-\u{E01EF}]/u.test(to) && !shared.has(to))
            fault(`mappings.${from}`, "Sound forms cannot use punctuation or structural controls");
        if (shared.has(to) && to !== inventory.get(roman)?.invisible)
            fault(`mappings.${from}`, "A shared invisible character belongs only to its own sound");
        const prior = outputs.get(to);
        if (prior && prior.toLowerCase() !== roman)
            fault(
                `mappings.${from}`,
                `Output duplicates mappings.${prior}; sounds need distinct forms`,
            );
        outputs.set(to, prior ?? from);
        if (!prior) rows.push([from, to]);
    }
    for (const row of STANDARD_ROWS) {
        const [from, to] = Array.isArray(row) ? row : [row.from, row.to];
        if (outputs.has(to))
            fault(`mappings.${outputs.get(to)}`, `Sound form conflicts with standard ${from}`);
    }
    return {
        rows,
        choices,
        outputs,
        inventory,
        controls: SHARED_SOUND_CONTROLS,
    };
}

/**
 * Read one global guide sound, independently of a language or font.
 * Offsets are UTF-16 positions; punctuation returns undefined. Stress records
 * an explicit acute, while tone can imply stress under the guide's rule.
 * @param {string} text
 * @param {number} [at]
 * @param {number} [bound]
 * @param {(offset:number,message:string)=>never} [fail]
 * @returns {{from:string,plain:string,end:number,roman:string,ipa:string,kind:string,vowel:boolean,stress:boolean,tone:string|undefined}|undefined}
 */
export function guideSoundAt(
    text,
    at = 0,
    bound = text.length,
    fail = (offset, message) => {
        throw Object.assign(new Error(message), { offset });
    },
) {
    const first = letter(text.slice(at, bound));
    if (!first || !/[\p{L}\p{M}'’]/u.test(first.raw)) return undefined;
    if (first.repeatedMark) fail(at, "A vowel cannot carry a repeated combining mark");
    const second = letter(text.slice(at + first.raw.length, bound));
    const plain = first.plain + (second?.plain ?? "");
    const selected = sounds.find((sound) => {
        if (!plain.toLowerCase().startsWith(sound.roman)) return false;
        if (
            sound.roman.length > first.plain.length &&
            (second?.apart || second?.stress || second?.tone)
        )
            return false;
        if (closingGlide(sound.roman)) {
            const following = letter(
                text.slice(at + first.raw.length + (second?.raw.length ?? 0), bound),
            );
            if (following && vowel(following.plain)) return false;
        }
        return true;
    });
    if (!selected) fail(at, "This spelling is not a sound of the shared guide");
    const count = selected.roman.length > first.plain.length ? 2 : 1;
    const end = at + first.raw.length + (count === 2 ? second.raw.length : 0);
    const source = first.plain + (count === 2 ? second.plain : "");
    if (first.stress && !vowel(selected.roman)) fail(at, "Stress belongs on a vowel");
    if (first.apart && !vowel(selected.roman)) fail(at, "Diaeresis belongs on a vowel");
    if (first.twoTones || (first.tone && !/^(aa|ii|uu)$/u.test(selected.roman)))
        fail(at, "Tone belongs on the first letter of held aa, ii or uu");
    return {
        from: text.slice(at, end),
        plain: source,
        end,
        roman: selected.roman,
        ipa: selected.ipa,
        kind: selected.kind,
        vowel: vowel(selected.roman),
        stress: first.stress,
        tone: first.tone,
    };
}

/** Select the encoding's form after reading the global guide token. */
export function soundAt(codec, text, at, bound, fail) {
    const sound = guideSoundAt(text, at, bound, fail);
    if (!sound) return undefined;
    if (!codec.choices.has(sound.roman))
        fail(at, `The language does not declare ${sound.roman} /${sound.ipa}/`);
    const target = codec.capitals.get(sound.plain) ?? codec.choices.get(sound.roman);
    return {
        from: sound.from,
        to:
            target +
            (sound.tone ? codec.controls[sound.tone] : "") +
            (sound.stress ? codec.controls.stress : ""),
        end: sound.end,
        sound: sound.roman,
    };
}

/** Restore guide separators from the selected sound boundaries, retaining stress. */
export function spellSounds(pieces) {
    let previous;
    for (const [index, piece] of pieces.entries()) {
        if (!piece.sound) {
            previous = undefined;
            continue;
        }
        if (previous) {
            const combined = (previous.sound + piece.sound).toLowerCase();
            const joined = sounds.find(
                (sound) =>
                    combined.startsWith(sound.roman) &&
                    !(closingGlide(sound.roman) && vowel(pieces[index + 1]?.sound ?? "")),
            );
            if (closingGlide(previous.sound) && vowel(piece.sound)) piece.from = "-" + piece.from;
            else if (joined && joined.roman.length > previous.sound.length) {
                if (vowel(previous.sound) && vowel(piece.sound)) {
                    if (!/[\u0301\u030C\u0302]/u.test(piece.from.normalize("NFD"))) {
                        const first = grapheme(piece.from);
                        piece.from =
                            (first + "\u0308").normalize("NFC") + piece.from.slice(first.length);
                    }
                } else piece.from = "-" + piece.from;
            }
        }
        previous = piece;
    }
    return pieces;
}
