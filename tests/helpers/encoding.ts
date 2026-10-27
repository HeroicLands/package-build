// SPDX-License-Identifier: GPL-3.0-or-later
/** Unit-test encodings with explicit identity rows for letters the test does not replace. */
import { compileRows } from "../../engine/encoding.mjs";
import { runContext } from "../../engine/content-scripts.mjs";

export function compileTestEncoding(value: any) {
    const stated = value.rows ?? [];
    const punctuation = new Map(
        Object.entries({
            ".": "\u{E0100}",
            "?": "\u{E0101}",
            "‼": "\u{E0102}",
            "!": "\u{E0103}",
            "^": "\u{E0104}",
            ",": "\u{E0105}",
            "«": "\u{E0106}",
            "»": "\u{E0107}",
            "‹": "\u{E0108}",
            "›": "\u{E0109}",
            "—": "\u{E010A}",
            "…": "\u{E010B}",
            "/": "\u{E010C}",
            "{": "\u{E0110}",
            "}": "\u{E0111}",
        }),
    );
    const statedSources = new Set(stated.map((r: any) => (Array.isArray(r) ? r[0] : r.from)));
    const own = [...stated, ...[...punctuation].filter(([from]) => !statedSources.has(from))];
    const sources = new Set(own.map((r: any) => (Array.isArray(r) ? r[0] : r.from)));
    const identity = [
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789áéíóúàèìòùâêîôûëöüäïåñæœ.'’–-!?^,/:;«»‹›—…{}‼",
    ]
        .filter((c) => !sources.has(c) && (!value.noLetters || !/[\p{L}\p{N}]/u.test(c)))
        .map((c) => [c, c]);
    const listed = value.fonts?.length ? value.fonts : [{ font: "semaron-kuriale" }];
    return compileRows(
        {
            name: value.name,
            fonts: listed.map((f: any) => (typeof f === "string" ? f : f.font)),
            accepts: [
                ...new Set(
                    [...identity, ...own].flatMap((r: any) => [
                        ...(Array.isArray(r) ? r[0] : r.from),
                    ]),
                ),
            ],
            separator:
                value.separator ??
                stated.find((r: any) => (Array.isArray(r) ? r[0] : r.from) === " ")?.[1] ??
                " ",
            vowels: value.vowels ?? "aeiouAEIOU",
            roundTrip: "canonical",
            rows: [...own, ...identity],
            faces: Object.fromEntries(
                listed.filter((f: any) => f.rows).map((f: any) => [f.font, { rows: f.rows }]),
            ),
        },
        {
            language: value.language,
            font: typeof listed[0] === "string" ? listed[0] : listed[0].font,
        },
    );
}

/** Language grammar tests supply standalone definitions beside their note records. */
export function encodingContext(config: any, records: any[]) {
    const encodings = new Map(
        records
            .filter((record) => record.encodingDefinition)
            .map((record) => {
                const enc = compileTestEncoding(record.encodingDefinition);
                return [enc.name, enc];
            }),
    );
    const base = runContext(
        config,
        records.filter((record) => !record.encodingDefinition),
    );
    const faces = new Map(base.faces);
    for (const enc of encodings.values())
        for (const slug of enc.fonts)
            if (!faces.has(slug))
                faces.set(slug, {
                    slug,
                    family: slug,
                    class: `hl-${slug}`,
                    direction: "ltr",
                    features: [],
                    draws: new Set(
                        [
                            ...enc.shared.rows,
                            ...[...enc.faces.values()].flatMap((f: any) => f.rows),
                        ].flatMap((r: any) => [...r.to].map((c: string) => c.codePointAt(0))),
                    ),
                });
    return {
        ...base,
        encodings,
        faces,

        encodingFindings: [],
    };
}

/** Faces drawing the explicit rows of synthetic rendering-test definitions. */
export function testFaces(encodings: Map<string, any>) {
    const out = new Map();
    for (const enc of encodings.values())
        for (const slug of enc.fonts)
            out.set(slug, {
                slug,
                family: slug,
                class: `hl-${slug}`,
                direction: "ltr",
                features: [],
                draws: new Set(
                    [
                        ...enc.shared.rows,
                        ...[...enc.faces.values()].flatMap((f: any) => f.rows),
                    ].flatMap((r: any) => [...r.to].map((c: string) => c.codePointAt(0))),
                ),
            });
    return out;
}
