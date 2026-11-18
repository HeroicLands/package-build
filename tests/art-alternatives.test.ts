/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectArtMasters } from "../engine/art-masters.mjs";
import {
    writeSvgProvenance,
    readSvgProvenance,
    checkProvenance,
} from "../engine/art-provenance.mjs";
import {
    indexRecordsFor,
    publicationIndexRecordsFor,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { assetReferenceLookup, annotateAssetReferences } from "../engine/asset-references.mjs";
import { decodeIndexAddresses, encodeAddresses } from "../engine/note-addresses.mjs";
import { resolvePathname } from "../engine/pathnames.mjs";
import { ASSET_RECORD_FIELDS } from "../engine/asset-index.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { readXmpRecord, HL_NAMESPACE } from "../engine/art-provenance-core.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";

const root = path.resolve("build/art-alternatives-test");
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const source = "sample-none-image-original";
const target = "sample-none-icon-drawing";
function master(address: string, fields: Record<string, unknown> = {}) {
    const file = path.join(root, "private", `${address}.svg`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
        file,
        writeSvgProvenance(
            '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
            {
                address,
                creator: "Artist",
                rights: "Terms",
                license: "CC0-1.0",
                ...fields,
            },
        ).bytes,
    );
    return file;
}
function config(relationships = {}) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    return configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            site: { assets: "https://cdn.example.test" },
            art: { masterRoots: ["private"] },
            relationships,
        },
        path.join(root, "package-build.config.yaml"),
    );
}
it.each([{ ai: true }, { digitalSourceType: "trainedAlgorithmicMedia" }])(
    "refuses missing alternatives during collection and publication: %j",
    (status) => {
        const file = master(source, status);
        expect(readSvgProvenance(fs.readFileSync(file)).record.nonAiAlternative).toBeUndefined();
        expect(collectArtMasters([path.join(root, "private")], "sample").findings).toEqual([
            {
                file,
                severity: "error",
                message: expect.stringMatching(/nonAiAlternative.*declare/),
            },
        ]);
        expect(() => publicationIndexRecordsFor({ config: config() })).toThrow(
            /\.svg: error:.*nonAiAlternative/,
        );
        const problems: any[] = [];
        indexRecordsFor({ config: config(), problems });
        expect(problems.filter((finding) => /nonAiAlternative/.test(finding.message))).toHaveLength(
            1,
        );
    },
);
it.each([
    ["missing", target, null, /does not resolve/],
    ["self", source, null, /itself/],
    ["cycle", target, { ai: true, nonAiAlternative: source }, /non-AI/],
    ["unknown", target, {}, /non-AI/],
    ["license", target, { ai: false, license: "unlisted" }, /licence/],
] as const)(
    "refuses %s targets after collecting the full index",
    (_label, alternative, targetFields, message) => {
        master(source, { ai: true, nonAiAlternative: alternative });
        if (targetFields) master(target, targetFields);
        expect(() => publicationIndexRecordsFor({ config: config() })).toThrow(message);
    },
);
it("carries a nullable master-only field through standard JSONL", () => {
    master(source, { ai: true, nonAiAlternative: target });
    master(target, { digitalSourceType: "digitalCreation" });
    const records = publicationIndexRecordsFor({ config: config() });
    for (const record of records.filter((record) => record.asset))
        expect(Object.keys(record.asset).sort()).toEqual(
            ASSET_RECORD_FIELDS.map((field) => field.name).sort(),
        );
    const lines = serializeContentIndex(records)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    expect(
        lines.find((record) => record.shortcode === "drawing").asset.nonAiAlternative,
    ).toBeNull();
    const original = lines.find((record) => record.shortcode === "original");
    expect(original.asset.nonAiAlternative).toBe(target);
    expect(
        encodeAddresses(
            decodeIndexAddresses(original, { package: "sample" }).asset.nonAiAlternative,
        ),
    ).toBe(target);
    expect(() =>
        decodeIndexAddresses(
            lines.find((record) => record.shortcode === "drawing"),
            { package: "sample" },
        ),
    ).not.toThrow();
});
it("uses the declared image/icon alternative in Foundry and stages its bytes", async () => {
    master(source, { ai: true, nonAiAlternative: target });
    master(target, { ai: false });
    const cfg = config();
    const records = publicationIndexRecordsFor({ config: cfg });
    const lookup = assetReferenceLookup(
        {
            assets: new Map(
                records
                    .filter((record) => record.asset)
                    .map((record) => [encodeAddresses(record.address.canonical), record]),
            ),
        },
        cfg,
    );
    const originalPath = resolvePathname("sample/assets/images/original.svg", cfg)!;
    const doc: any = {
        img: originalPath.foundry,
        description: `<img src="${originalPath.foundry}">`,
    };
    const findings: string[] = [];
    annotateAssetReferences(doc, "Item", {
        lookup,
        system: "sohl",
        report: (message) => findings.push(message),
    });
    expect(findings).toEqual([]);
    expect(doc.img).toBe("modules/sample/icons/drawing.svg");
    expect(doc.flags.sohl.assets.img).toBe(source);
    expect(doc.description).toContain(
        `src="modules/sample/icons/drawing.svg" data-asset="${source}"`,
    );
    expect(originalPath.web).toBe("https://cdn.example.test/sample/images/original.svg");
    expect(originalPath.pdf).toBe("assets/images/original.svg");
    await stagePackageBuildAssets({
        config: {
            rootDir: root,
            assets: [],
            stageDir: "build/stage",
            baseStyles: false,
            shippingLicenses: [],
            manifest: {},
        } as any,
        packConfig: cfg,
    });
    expect(fs.existsSync(path.join(root, "build/stage/icons/drawing.svg"))).toBe(true);
    expect(fs.existsSync(path.join(root, "build/stage/images/original.svg"))).toBe(false);
});
it.each([false, true])(
    "requires a declared dependency for a foreign replacement: %s",
    (declared) => {
        const foreign = "library-none-icon-drawing";
        master(source, { ai: true, nonAiAlternative: foreign });
        const cfg = config(
            declared ?
                {
                    requires: [
                        {
                            id: "library",
                            type: "module",
                            manifest: "https://example.test/module.json",
                        },
                    ],
                }
            :   {},
        );
        const row = {
            package: "library",
            type: "icon",
            asset: {
                path: "icons/drawing.svg",
                ai: false,
                license: "CC0-1.0",
                nonAiAlternative: null,
            },
        };
        const foreignIndex = new Map([[foreign, row]]);
        const problems: any[] = [];
        const records = indexRecordsFor({ config: cfg, foreignIndex, problems });
        if (!declared) {
            expect(problems.some((problem) => /undeclared/.test(problem.message))).toBe(true);
            return;
        }
        expect(problems).toEqual([]);
        const lookup = assetReferenceLookup(
            {
                assets: new Map(
                    records
                        .filter((record) => record.asset)
                        .map((record) => [encodeAddresses(record.address.canonical), record]),
                ),
                foreign: foreignIndex,
            },
            cfg,
        );
        const doc: any = { img: "modules/sample/images/original.svg" };
        const findings: string[] = [];
        annotateAssetReferences(doc, "Item", {
            lookup,
            system: "sohl",
            report: (message) => findings.push(message),
        });
        expect(findings).toEqual([]);
        expect(doc.img).toBe("modules/library/icons/drawing.svg");
    },
);
it("refuses alternatives carried by a derivative", () => {
    const file = master(source, { ai: true, nonAiAlternative: target });
    const bytes = fs
        .readFileSync(file, "utf8")
        .replace("</rdf:Description>", "<hl:derived>true</hl:derived></rdf:Description>");
    expect(
        checkProvenance([{ file: "derived.svg", bytes }]).some((finding) =>
            /nonAiAlternative.*master.*remove/.test(finding.message),
        ),
    ).toBe(true);
});

it.each(["systems", "requires", "recommends"])(
    "permits only required replacement packages: %s",
    (relationship) => {
        const foreign = "library-none-icon-drawing";
        master(source, { ai: true, nonAiAlternative: foreign });
        const cfg = config({
            [relationship]: [
                {
                    id: "library",
                    type: relationship === "systems" ? "system" : "module",
                    ...(relationship === "systems" ? { compatibility: { verified: "14" } } : {}),
                    manifest: "https://example.test/module.json",
                    itemCatalog: true,
                },
            ],
        });
        const foreignIndex = new Map([
            [
                foreign,
                {
                    package: "library",
                    type: "icon",
                    asset: { path: "icons/drawing.svg", ai: false, license: "CC0-1.0" },
                },
            ],
        ]);
        const problems: any[] = [];
        indexRecordsFor({ config: cfg, foreignIndex, problems });
        if (relationship === "recommends")
            expect(problems).toEqual([
                expect.objectContaining({
                    severity: "error",
                    message: expect.stringMatching(/required.*dependency/),
                }),
            ]);
        else expect(problems).toEqual([]);
    },
);

it("refuses a target whose indexed type cannot be displayed as an image", () => {
    master(source, { ai: true, nonAiAlternative: "library-none-icon-drawing" });
    const cfg = config({
        requires: [{ id: "library", type: "module", manifest: "https://example.test/module.json" }],
    });
    const problems: any[] = [];
    indexRecordsFor({
        config: cfg,
        problems,
        foreignIndex: new Map([
            [
                "library-none-icon-drawing",
                {
                    package: "library",
                    type: "audio",
                    asset: { path: "audio/drawing.ogg", ai: false, license: "CC0-1.0" },
                },
            ],
        ]),
    });
    expect(problems.some((finding) => /deployable image or icon/.test(finding.message))).toBe(true);
});
it.each([false, undefined])(
    "validates a declared alternative without changing source AI status %s",
    (ai) => {
        master(source, { ai, nonAiAlternative: target });
        master(target, { ai: false });
        const records = publicationIndexRecordsFor({ config: config() });
        expect(records.find((record) => record.shortcode === "original").asset.ai).toBe(ai ?? null);
        expect(records.find((record) => record.shortcode === "drawing").asset.ai).toBe(false);
    },
);
for (const ai of [false, undefined]) {
    it.each([
        ["self", source, null, /itself/],
        ["missing", target, null, /does not resolve/],
        ["undeclared", "library-none-icon-drawing", null, /undeclared/],
        ["unknown target", target, {}, /explicitly non-AI/],
        ["AI target", target, { ai: true, nonAiAlternative: source }, /explicitly non-AI/],
        ["license", target, { ai: false, license: "unlisted" }, /licence/],
    ] as const)(
        `refuses %s declarations with source AI status ${ai ?? "unknown"}`,
        (_label, alternative, targetFields, message) => {
            master(source, { ai, nonAiAlternative: alternative });
            if (targetFields) master(target, targetFields);
            expect(() => publicationIndexRecordsFor({ config: config() })).toThrow(message);
        },
    );
}
it("refuses self and cyclic AI alternatives in a provenance audit", () => {
    const first = master(source, { ai: true, nonAiAlternative: source });
    expect(
        checkProvenance([{ file: first, bytes: fs.readFileSync(first) }]).some((finding) =>
            /itself/.test(finding.message),
        ),
    ).toBe(true);
    master(source, { ai: true, nonAiAlternative: target });
    const second = master(target, { ai: true, nonAiAlternative: source });
    expect(
        checkProvenance(
            [first, second].map((file) => ({ file, bytes: fs.readFileSync(file) })),
        ).filter((finding) => /explicitly non-AI/.test(finding.message)),
    ).toHaveLength(2);
});

it("loads a declared replacement through the cached dependency index and stages it in its own package", async () => {
    const foreign = "library-none-icon-drawing";
    master(source, { ai: true, nonAiAlternative: foreign });
    const cfg = config({
        requires: [{ id: "library", type: "module", manifest: "https://example.test/module.json" }],
    });
    const cache = path.join(cfg.paths.metadataCache, "library@1.0.0");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, ".complete"), "");
    fs.writeFileSync(
        path.join(cache, "library-metadata.jsonl"),
        JSON.stringify({
            package: "library",
            type: "icon",
            shortcode: "drawing",
            address: { canonical: foreign },
            asset: {
                path: "icons/drawing.svg",
                ai: false,
                license: "CC0-1.0",
                nonAiAlternative: null,
            },
        }) + "\n",
    );
    const session = await createContentSession({ config: cfg });
    try {
        expect(session.problems).toEqual([]);
        const lookup = assetReferenceLookup(
            {
                assets: new Map(
                    session.records
                        .filter((record) => record.asset)
                        .map((record) => [encodeAddresses(record.address.canonical), record]),
                ),
                foreign: session.foreign.index,
            },
            cfg,
        );
        const doc: any = { img: "modules/sample/images/original.svg" };
        const findings: string[] = [];
        annotateAssetReferences(doc, "Item", {
            lookup,
            system: "sohl",
            report: (message) => findings.push(message),
        });
        expect(findings).toEqual([]);
        expect(doc.img).toBe("modules/library/icons/drawing.svg");
    } finally {
        session.dispose();
    }
    const foreignRoot = path.join(root, "library");
    const privateRoot = path.join(foreignRoot, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.writeFileSync(
        path.join(foreignRoot, "package.json"),
        JSON.stringify({ name: "library", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(privateRoot, "drawing.svg"),
        writeSvgProvenance(
            '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
            { address: foreign, ai: false, license: "CC0-1.0" },
        ).bytes,
    );
    const foreignConfig = configFromData(
        {
            contentPackage: "library",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { masterRoots: ["private"] },
        },
        path.join(foreignRoot, "package-build.config.yaml"),
    );
    await stagePackageBuildAssets({
        config: {
            rootDir: foreignRoot,
            assets: [],
            stageDir: "build/stage",
            baseStyles: false,
            shippingLicenses: [],
            manifest: {},
        } as any,
        packConfig: foreignConfig,
    });
    expect(fs.existsSync(path.join(foreignRoot, "build/stage/icons/drawing.svg"))).toBe(true);
});
it.each([
    [`<rdf:Description><hl:nonAiAlternative>${target}</rdf:Description>`, /malformed XMP/],
    [`<other hl:nonAiAlternative="${target}"/>`, /RDF Description/],
    [`<other><hl:nonAiAlternative>${target}</hl:nonAiAlternative></other>`, /RDF Description/],
    [
        `<rdf:Description><hl:nonAiAlternative><child/></hl:nonAiAlternative></rdf:Description>`,
        /Address text property/,
    ],
    [
        `<rdf:Description><hl:nonAiAlternative extra="value">${target}</hl:nonAiAlternative></rdf:Description>`,
        /Address text property/,
    ],
])("refuses malformed managed alternative structure: %s", (body, message) => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:hl="${HL_NAMESPACE}">${body}</rdf:RDF>`;
    expect(() => readXmpRecord(packet)).toThrow(message);
});

it("never guesses a generic stand-in for a master whose declared target is unavailable", () => {
    master(source, { ai: true, nonAiAlternative: target });
    master("sample-none-image-missing", { ai: false });
    const cfg = config();
    const problems: any[] = [];
    const records = indexRecordsFor({ config: cfg, problems });
    const lookup = assetReferenceLookup(
        {
            assets: new Map(
                records
                    .filter((record) => record.asset)
                    .map((record) => [encodeAddresses(record.address.canonical), record]),
            ),
        },
        cfg,
    );
    const doc: any = { img: "modules/sample/images/original.svg" };
    const findings: string[] = [];
    annotateAssetReferences(doc, "Item", {
        lookup,
        system: "sohl",
        report: (message) => findings.push(message),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("does not resolve");
    expect(doc.img).toBe("modules/sample/images/original.svg");
});

it("refuses invalid alternatives before the package stage writes output", async () => {
    master(source, { ai: true, nonAiAlternative: target });
    const cfg = config();
    await expect(
        stagePackageBuildAssets({
            config: {
                rootDir: root,
                assets: [],
                stageDir: "build/stage",
                baseStyles: false,
                shippingLicenses: [],
                manifest: {},
            } as any,
            packConfig: cfg,
        }),
    ).rejects.toThrow(/nonAiAlternative.*does not resolve/);
    expect(fs.existsSync(path.join(root, "build/stage"))).toBe(false);
});
