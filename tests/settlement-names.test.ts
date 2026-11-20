/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it, vi } from "vitest";
import { proposeSettlementName } from "../engine/settlement-names.mjs";

const culture = {
    package: "example",
    type: "lore",
    subType: "culture",
    shortcode: "folk",
    lang: "test",
};
const language = {
    package: "example",
    type: "skill",
    subType: "language",
    shortcode: "tongue",
    languageCode: "test",
    data: {
        elements: [
            { form: "ash", position: "opening", kind: "place", sense: "the ash tree" },
            { form: "brin", position: "opening", kind: "place", sense: "a hill" },
            { form: "ford", position: "closing", kind: "place", sense: "a crossing" },
            { form: "wold", position: "closing", kind: "place", sense: "high open upland" },
            { form: "li", position: "closing", kind: "byname", sense: "a clearing" },
            { form: "s", position: "link", kind: "place", sense: "belonging to" },
        ],
        naming: { draws: [{ kind: "place", elements: ["place"] }] },
    },
};
const pass = () => ({ available: true, valid: true });
const validators = () => ({
    spelling: pass,
    language: pass,
    earthWords: pass,
    earthNames: pass,
    indexedNames: pass,
});
const request = () => ({
    culture,
    language,
    identity: "map:cell:7:0",
    seed: "42",
    exclusions: [],
    validators: validators(),
    maxCandidates: 10,
});

describe("settlement name candidates", () => {
    it("uses the typed index-shaped place pool and records both components", () => {
        const input = request();
        const result = proposeSettlementName(input);
        expect(result.status).toBe("accepted");
        expect(result.languageAddress).toBe("example-note-skill-tongue");
        expect(result.elements).toHaveLength(2);
        expect(result.elements[0]).toMatchObject({ kind: "place", position: "opening" });
        expect(result.elements[1]).toMatchObject({ kind: "place", position: "closing" });
        expect(Object.keys(result.checks).sort()).toEqual([
            "earthNames",
            "earthWords",
            "indexedNames",
            "language",
            "spelling",
        ]);
        expect(proposeSettlementName(input)).toEqual(result);
    });
    it("accepts the indexed shape of the declared place pool through explicit checker callbacks", () => {
        const input = request();
        const result = proposeSettlementName({
            ...input,
            culture: { ...culture, package: "thalorna", shortcode: "aelwythanclt", lang: "aelw" },
            language: {
                ...language,
                package: "thalorna",
                shortcode: "aelwthlng",
                languageCode: "aelw",
            },
            exclusions: ["Ashford", "Brinwold"],
        });
        expect(result.status).toBe("accepted");
        expect(result.languageAddress).toBe("thalorna-note-skill-aelwthlng");
        expect(result.elements.every((element: any) => element.kind === "place")).toBe(true);
    });
    it("requires a typed place draw and eligible positions and refuses unsupported composition", () => {
        for (const data of [
            { ...language.data, naming: { draws: [{ kind: "given", elements: ["given"] }] } },
            {
                ...language.data,
                elements: language.data.elements.filter(
                    (e) => e.position === "link" || e.kind === "byname",
                ),
            },
            {
                ...language.data,
                naming: {
                    ...language.data.naming,
                    heldFrom: [{ source: "founder", takes: "givenName" }],
                },
            },
            {
                ...language.data,
                elements: language.data.elements.map((e) => ({ ...e, joining: "-x" })),
            },
        ]) {
            expect(
                proposeSettlementName({ ...request(), language: { ...language, data } }).status,
            ).toBe("missing");
        }
    });
    it("preserves a bound authored name without presenting it as validated generation", () => {
        const result = proposeSettlementName({
            ...request(),
            authored: { identity: "map:cell:7:0", name: "Kept" },
            validators: {},
        });
        expect(result).toEqual({ status: "authored", identity: "map:cell:7:0", name: "Kept" });
        expect(
            proposeSettlementName({ ...request(), authored: { identity: "other", name: "Kept" } })
                .status,
        ).toBe("missing");
    });
    it("requires every validator and refuses unavailable or ambiguous results", () => {
        for (const change of [
            { spelling: undefined },
            { earthWords: () => ({ available: false }) },
            { earthNames: () => true },
            { indexedNames: () => ({ available: true }) },
            { indexedNames: () => Promise.resolve({ available: true, valid: true }) },
            { indexedNames: () => ({ available: true, valid: true, then() {} }) },
        ]) {
            const result = proposeSettlementName({
                ...request(),
                validators: { ...validators(), ...change },
            });
            expect(result.status).not.toBe("accepted");
        }
        const failure = proposeSettlementName({
            ...request(),
            validators: {
                ...validators(),
                language: () => {
                    throw new Error("unavailable");
                },
            },
        });
        expect(failure.status).toBe("validation-error");
    });
    it("contains exceptions from callback result inspection and preserves the check identity", () => {
        const throwingThen = Object.defineProperty({ available: true, valid: true }, "then", {
            get() {
                throw new Error("then failed");
            },
        });
        const throwingAvailable = Object.defineProperty({ valid: true }, "available", {
            enumerable: true,
            get() {
                throw new Error("availability failed");
            },
        });
        const throwingEvidence = Object.defineProperty(
            { available: true, valid: true },
            "evidence",
            {
                enumerable: true,
                get() {
                    throw new Error("evidence failed");
                },
            },
        );
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        for (const [value, message] of [
            [throwingThen, "then failed"],
            [throwingAvailable, "availability failed"],
            [throwingEvidence, "evidence failed"],
            [revoked.proxy, undefined],
        ] as const) {
            const result = proposeSettlementName({
                ...request(),
                validators: { ...validators(), spelling: () => value },
            });
            expect(result).toMatchObject({
                status: "validation-error",
                field: "validators.spelling",
                examined: 1,
            });
            if (message) expect(result.message).toContain(message);
        }
        const inheritedThen = Object.assign(Object.create({ then() {} }), {
            available: true,
            valid: true,
        });
        expect(
            proposeSettlementName({
                ...request(),
                validators: { ...validators(), spelling: () => inheritedThen },
            }),
        ).toMatchObject({ status: "validation-error", field: "validators.spelling" });
        expect(
            proposeSettlementName({
                ...request(),
                validators: {
                    ...validators(),
                    spelling: () => Promise.reject(new Error("async failure")),
                },
            }),
        ).toMatchObject({ status: "validation-error", field: "validators.spelling" });
        const invalidCallbacks = Proxy.revocable({}, {});
        invalidCallbacks.revoke();
        expect(
            proposeSettlementName({ ...request(), validators: invalidCallbacks.proxy }),
        ).toMatchObject({ status: "validation-error", field: "validators" });
    });
    it("uses one snapshot of validation flags and retains evidence", () => {
        let reads = 0;
        const result = proposeSettlementName({
            ...request(),
            validators: {
                ...validators(),
                spelling: () => ({
                    available: true,
                    get valid() {
                        reads++;
                        return reads === 1;
                    },
                    evidence: "checked",
                }),
            },
        });
        expect(result.status).toBe("accepted");
        expect(result.checks.spelling).toEqual({
            available: true,
            valid: true,
            evidence: "checked",
        });
        expect(reads).toBe(1);
    });
    it("distinguishes rejection exhaustion from stopping at the budget", () => {
        const reject = () => ({ available: true, valid: false });
        const limited = proposeSettlementName({
            ...request(),
            maxCandidates: 1,
            validators: { ...validators(), spelling: reject },
        });
        expect(limited).toMatchObject({ status: "budget", examined: 1 });
        const exhausted = proposeSettlementName({
            ...request(),
            validators: { ...validators(), spelling: reject },
        });
        expect(exhausted).toMatchObject({ status: "exhausted", examined: 4 });
    });
    it("uses declared name normalization for excluded and already selected labels", () => {
        const first = proposeSettlementName(request());
        const input = { ...request(), exclusions: [first.name.toUpperCase()] };
        const second = proposeSettlementName(input);
        expect(second.status).toBe("accepted");
        expect(second.name.toLowerCase()).not.toBe(first.name.toLowerCase());
        const noNames = proposeSettlementName({
            ...request(),
            exclusions: ["ashford", "ashwold", "brinford", "brinwold"],
        });
        expect(noNames.status).toBe("exhausted");
    });
    it("checks distinct component provenance even when two pairs make the same label", () => {
        const elements = [
            { form: "ash", position: "opening", kind: "place", sense: "first" },
            { form: "ash", position: "opening", kind: "place", sense: "second" },
            { form: "ford", position: "closing", kind: "place", sense: "a crossing" },
        ];
        const seen: string[] = [];
        const result = proposeSettlementName({
            ...request(),
            language: { ...language, data: { ...language.data, elements } },
            validators: {
                ...validators(),
                language: (_name: string, context: any) => {
                    seen.push(context.elements[0].sense);
                    return {
                        available: true,
                        valid: context.elements[0].sense === "second",
                        source: "fixture",
                    };
                },
            },
        });
        expect(result.status).toBe("accepted");
        expect(result.elements[0].sense).toBe("second");
        expect(result.checks.language.source).toBe("fixture");
        expect(seen).toContain("second");
    });
    it("does not run callbacks when the culture and language do not match", () => {
        const check = vi.fn(pass);
        const result = proposeSettlementName({
            ...request(),
            culture: { ...culture, lang: "different" },
            validators: { ...validators(), spelling: check },
        });
        expect(result.status).toBe("missing");
        expect(check).not.toHaveBeenCalled();
    });
});
