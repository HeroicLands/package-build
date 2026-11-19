/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { configFromData } from "../engine/pack-config.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { writeSvgProvenance, writeProvenance } from "../engine/art-provenance.mjs";
import { stagePackageAssets } from "../engine/asset-shipping.mjs";
import { shippingAssetRecords } from "../engine/art-masters.mjs";
import { renderArtMasters } from "../engine/art-master-render.mjs";
import { inspectPublicDerivative } from "../engine/art-public-derivative.mjs";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archive-consumer-"));
    roots.push(root);
    const address = "sample-none-icon-example";
    const bytes = writeSvgProvenance(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
        {
            address,
            creator: ["Author", "Supporter"],
            rights: "Terms",
            license: "CC-BY-SA-4.0",
            ai: false,
            prompt: "private sentinel",
            name: "Private name",
            primaryNote: "sample-note-being-private",
        },
    ).bytes;
    const zip = Buffer.from(zipSync({ "icons/example.svg": bytes }, { level: 0 }));
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const config = configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { archives: [{ url: "https://example.test/originals.zip", sha256 }] },
        },
        path.join(root, "package-build.config.yaml"),
    );
    vi.stubEnv("XDG_CACHE_HOME", path.join(root, "shared-cache"));
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(zip)),
    );
    return { root, config, address, bytes };
}

it("captures original artwork through the session and renders public derivatives", async () => {
    const f = setup();
    expect(() => indexRecordsFor({ config: f.config })).toThrow(/prepared content session/);
    const session = await createContentSession({ config: f.config });
    const original = session.masters.get(f.address)!.file;
    try {
        expect(fs.readFileSync(original)).toEqual(f.bytes);
        const record = session.records.find((row: any) => row.shortcode === "example");
        expect(record.asset.attribution).toEqual(["Author", "Supporter"]);
        expect(record.asset.ai).toBe(false);
        const result = await renderArtMasters(
            session.masters,
            session.records,
            path.join(f.root, "build", "art"),
            path.join(f.root, "build", "cache"),
        );
        const publicBytes = fs.readFileSync(result.get(f.address)!);
        expect(publicBytes.toString("utf8")).not.toContain("private sentinel");
        const metadata = inspectPublicDerivative("example.svg", publicBytes, "sample").metadata;
        expect(metadata.name).toBeUndefined();
        expect(metadata.primaryNote).toBeUndefined();
    } finally {
        await session.dispose();
    }
    expect(fs.existsSync(original)).toBe(false);
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("network forbidden");
        }),
    );
    const cached = await createContentSession({ config: f.config });
    await cached.dispose();
});

it("reports duplicate addresses across extracted originals and removes the private root", async () => {
    const f = setup();
    const zip = Buffer.from(
        zipSync({ "icons/one.svg": f.bytes, "icons/two.svg": f.bytes }, { level: 0 }),
    );
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const config = configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { archives: [{ url: "https://example.test/duplicates.zip", sha256 }] },
        },
        path.join(f.root, "package-build.config.yaml"),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(zip)),
    );
    const session = await createContentSession({ config });
    const original = session.masters.get(f.address)!.file;
    expect(
        session.problems.some((finding: any) => /duplicate master address/.test(finding.message)),
    ).toBe(true);
    await session.dispose();
    expect(fs.existsSync(original)).toBe(false);
});

it("cleans an earlier extracted archive when a later download fails", async () => {
    const f = setup();
    vi.spyOn(os, "tmpdir").mockReturnValue(f.root);
    const zip = Buffer.from(zipSync({ "icons/example.svg": f.bytes }, { level: 0 }));
    const first = createHash("sha256").update(zip).digest("hex");
    const config = configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: {
                archives: [
                    { url: "https://example.test/first.zip", sha256: first },
                    { url: "https://example.test/second.zip", sha256: "f".repeat(64) },
                ],
            },
        },
        path.join(f.root, "package-build.config.yaml"),
    );
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValueOnce(new Response(zip))
            .mockRejectedValueOnce(new Error("offline")),
    );
    const prior = path.join(f.root, "existing-output");
    fs.writeFileSync(prior, "keep");
    await expect(createContentSession({ config })).rejects.toThrow();
    expect(fs.readFileSync(prior, "utf8")).toBe("keep");
    expect(fs.readdirSync(f.root).filter((name) => name.startsWith("art-archive-"))).toEqual([]);
    vi.restoreAllMocks();
});

it("derives the screen formats and stages only the declared non-AI alternative", async () => {
    const f = setup();
    const opaque = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
    })
        .png()
        .toBuffer();
    const transparent = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
        .png()
        .toBuffer();
    const common = { creator: ["Artist"], rights: "Terms", license: "CC-BY-SA-4.0" };
    const ai = writeProvenance(opaque, {
        ...common,
        address: "sample-none-image-generated",
        ai: true,
        nonAiAlternative: f.address,
    }).bytes;
    const alpha = writeProvenance(transparent, {
        ...common,
        address: "sample-none-image-alpha",
        ai: false,
    }).bytes;
    const zip = Buffer.from(
        zipSync(
            { "images/ai.png": ai, "images/alpha.png": alpha, "icons/example.svg": f.bytes },
            { level: 0 },
        ),
    );
    const sha256 = createHash("sha256").update(zip).digest("hex");
    const config = configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { archives: [{ url: "https://example.test/formats.zip", sha256 }] },
        },
        path.join(f.root, "package-build.config.yaml"),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(zip)),
    );
    const session = await createContentSession({ config });
    try {
        expect(session.problems).toEqual([]);
        const rendered = await renderArtMasters(
            session.masters,
            session.records,
            path.join(f.root, "build", "art"),
            path.join(f.root, "build", "cache"),
        );
        expect(rendered.get("sample-none-image-generated")).toMatch(/\.jpg$/);
        expect(rendered.get("sample-none-image-alpha")).toMatch(/\.webp$/);
        expect(rendered.get(f.address)).toMatch(/\.svg$/);
        const staged = stagePackageAssets({
            assetsBase: config.paths.assets,
            contentPackage: "sample",
            stageDir: path.join(f.root, "build", "stage"),
            title: "Sample",
            records: shippingAssetRecords(session.records),
            preparedMasters: rendered,
        });
        expect(staged.findings).toEqual([]);
        expect(staged.staged.map((row: any) => row.shortcode).sort()).toEqual(["alpha", "example"]);
        expect(staged.excluded.map((entry: any) => entry.record.shortcode)).toContain("generated");
        for (const [address, relative] of [
            ["sample-none-image-alpha", "images/alpha.webp"],
            [f.address, "icons/example.svg"],
        ])
            expect(fs.readFileSync(path.join(f.root, "build", "stage", relative))).toEqual(
                fs.readFileSync(rendered.get(address)!),
            );
    } finally {
        await session.dispose();
    }
});

it("refuses an AI original without its declared replacement before rendering", async () => {
    const f = setup();
    const ai = writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        address: "sample-none-icon-generated",
        creator: ["Artist"],
        rights: "Terms",
        license: "CC-BY-SA-4.0",
        ai: true,
    }).bytes;
    const zip = Buffer.from(zipSync({ "icons/generated.svg": ai }, { level: 0 }));
    const config = configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: {
                archives: [
                    {
                        url: "https://example.test/ai.zip",
                        sha256: createHash("sha256").update(zip).digest("hex"),
                    },
                ],
            },
        },
        path.join(f.root, "package-build.config.yaml"),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(zip)),
    );
    const session = await createContentSession({ config });
    try {
        expect(session.problems.some((item: any) => /alternative/i.test(item.message))).toBe(true);
    } finally {
        await session.dispose();
    }
});
