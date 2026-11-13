// SPDX-License-Identifier: GPL-3.0-or-later
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import {
    writeProvenance,
    readProvenance,
    writeSvgProvenance,
    readSvgProvenance,
    deriveRecord,
    checkProvenance,
} from "../engine/art-provenance.mjs";
import { collectArtMasters, masterAssetRecords } from "../engine/art-masters.mjs";
import { renderArtMasters } from "../engine/art-master-render.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { renderComposition } from "../engine/art-composition.mjs";

const root = path.resolve("build/art-components-test");
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const address = "sample-none-icon-composite";
const red = "sample-none-image-red";
const blue = "sample-none-image-blue";
const recipe = () => ({
    recipe: "over-v1",
    width: 2,
    height: 2,
    layers: [red, blue].map((address) => ({
        address,
        width: 2,
        height: 2,
        left: 0,
        top: 0,
        kernel: "nearest",
    })),
});
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
const fields = (address: string) => ({
    address,
    creator: "Example Artist",
    rights: "Example rights",
    license: "CC-BY-SA-4.0",
    digitalSourceType: "none",
});
async function png(color: string) {
    return sharp({ create: { width: 2, height: 2, channels: 4, background: color } })
        .png()
        .toBuffer();
}
async function fixture() {
    fs.mkdirSync(path.join(root, "masters"), { recursive: true });
    fs.mkdirSync(path.join(root, "components"), { recursive: true });
    const records = new Map<string, any>();
    for (const [id, color] of [
        [red, "red"],
        [blue, "blue"],
    ]) {
        const file = path.join(root, "components", color + ".png");
        const bytes = writeProvenance(await png(color), fields(id)).bytes;
        fs.writeFileSync(file, bytes);
        records.set(id, { file, record: readProvenance(bytes).record });
    }
    const file = path.join(root, "masters", "composite.png");
    fs.writeFileSync(
        file,
        writeProvenance(await png("blue"), { ...fields(address), composition: recipe() } as any)
            .bytes,
    );
    return { records, file };
}
it("round trips ordered composition metadata in PNG and SVG without changing drawing", async () => {
    const input = await png("red");
    const record = { ...fields(address), composition: recipe() };
    const out = writeProvenance(input, record as any).bytes;
    expect((readProvenance(out).record as any).composition).toEqual(recipe());
    expect(await sharp(out).raw().toBuffer()).toEqual(await sharp(input).raw().toBuffer());
    const vector = writeSvgProvenance(svg, record as any).text;
    expect((readSvgProvenance(vector).record as any).composition).toEqual(recipe());
    expect(vector).toContain('<rect width="2" height="2" fill="red"/>');
    expect(writeProvenance(out, { composition: null } as any).record).not.toHaveProperty(
        "composition",
    );
});
it.each([
    { recipe: "eval" },
    { command: "echo bad" },
    { width: 0 },
    { width: NaN },
    { width: Number.MAX_SAFE_INTEGER },
    { layers: [] },
    { layers: [{ ...recipe().layers[0], path: "private.png" }] },
    { layers: [{ ...recipe().layers[0], address: "partial" }] },
    { layers: [recipe().layers[0], recipe().layers[0]] },
    { layers: [{ ...recipe().layers[0], left: -1 }] },
    { layers: [{ ...recipe().layers[0], top: 2 }] },
    { layers: [{ ...recipe().layers[0], kernel: "execute" }] },
])("refuses malformed composition %j", (patch) => {
    expect(() =>
        writeSvgProvenance(svg, {
            ...fields(address),
            composition: { ...recipe(), ...patch },
        } as any),
    ).toThrow(/composition/);
});
it("never repeats composition into public metadata", () => {
    expect(() =>
        deriveRecord({ ...fields(address), composition: recipe() } as any, {
            repeat: ["composition"],
        }),
    ).toThrow(/never repeated/);
    expect(deriveRecord({ ...fields(address), composition: recipe() } as any)).not.toHaveProperty(
        "composition",
    );
});
it("resolves private addressed sources and excludes them from records and rendering", async () => {
    await fixture();
    const result = collectArtMasters([path.join(root, "masters")], "sample", {
        componentRoots: [path.join(root, "components")],
    } as any);
    expect(result.findings).toEqual([]);
    expect(result.masters.size).toBe(1);
    expect((result as any).components.size).toBe(2);
    const all = new Map([...result.masters, ...(result as any).components]);
    expect(masterAssetRecords(all).map((r) => r.address.canonical)).toEqual([address]);
    const rendered = await renderArtMasters(
        all,
        [],
        path.join(root, "public"),
        path.join(root, "cache"),
    );
    expect([...rendered.keys()]).toEqual([address]);
    expect(JSON.stringify(masterAssetRecords(all))).not.toMatch(
        /composition|component|private|layers/,
    );
});
it("reports missing and duplicate component identities at their source", async () => {
    const { file } = await fixture();
    fs.unlinkSync(path.join(root, "components", "blue.png"));
    let result = collectArtMasters([path.join(root, "masters")], "sample", {
        componentRoots: [path.join(root, "components")],
    } as any);
    expect(result.findings).toContainEqual(
        expect.objectContaining({ file, message: expect.stringMatching(/missing.*component/) }),
    );
    fs.copyFileSync(
        path.join(root, "components", "red.png"),
        path.join(root, "components", "copy.png"),
    );
    result = collectArtMasters([path.join(root, "masters")], "sample", {
        componentRoots: [path.join(root, "components")],
    } as any);
    expect(result.findings.filter((f) => f.message === "duplicate master address").length).toBe(2);
});
it("checks relationship completeness in provenance audits", async () => {
    const { file } = await fixture();
    const entries = [{ file, bytes: fs.readFileSync(file) }];
    expect(checkProvenance(entries)).toContainEqual(
        expect.objectContaining({ file, message: expect.stringMatching(/missing.*component/) }),
    );
});
it("honors layer order deterministically and leaves sources unchanged", async () => {
    const { records } = await fixture();
    const before = [...records.values()].map((r) => fs.readFileSync(r.file));
    const a = await renderComposition(recipe() as any, records);
    expect([...(await sharp(a).ensureAlpha().raw().toBuffer())].slice(0, 4)).toEqual([
        0, 0, 255, 255,
    ]);
    const reversed = { ...recipe(), layers: recipe().layers.reverse() };
    const b = await renderComposition(reversed as any, records);
    expect([...(await sharp(b).ensureAlpha().raw().toBuffer())].slice(0, 4)).toEqual([
        255, 0, 0, 255,
    ]);
    expect(await renderComposition(recipe() as any, records)).toEqual(a);
    expect([...records.values()].map((r) => fs.readFileSync(r.file))).toEqual(before);
});
it("validates component root shape and refuses physical overlap", () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    const config = {
        contentPackage: "sample",
        packageKind: "modules",
        stats: { lastModifiedBy: "samplebuilder000" },
        compatibility: { minimum: "14", verified: "14" },
        packs: [],
    };
    const load = (art: any) =>
        configFromData({ ...config, art }, path.join(root, "package-build.config.yaml"));
    expect(load({ componentRoots: ["private"] }).art.componentRoots).toEqual([
        path.join(root, "private"),
    ]);
    expect(() => load({ componentRoots: "private" })).toThrow(/componentRoots/);
    expect(() => load({ masterRoots: ["private"], componentRoots: ["private/nested"] })).toThrow(
        /overlap/,
    );
    expect(() => load({ componentRoots: ["private"], publishComponents: true })).toThrow(
        /not a recognized option/,
    );
});
it("records confirmed ordered sources without inventing a recipe", async () => {
    const relation = { layers: [{ address: red }, { address: blue }] };
    const vector = writeSvgProvenance(svg, {
        ...fields(address),
        composition: relation,
    } as any).text;
    expect((readSvgProvenance(vector).record as any).composition).toEqual(relation);
    await expect(renderComposition(relation as any, new Map())).rejects.toThrow(
        /recipe is required/,
    );
    for (const composition of [
        { ...relation, width: 2 },
        { ...relation, layers: [{ address: red, kernel: "nearest" }] },
        { ...relation, recipe: "over-v1" },
    ])
        expect(() => writeSvgProvenance(svg, { ...fields(address), composition } as any)).toThrow(
            /composition/,
        );
});
it("refuses malformed embedded recipes and composition on a public derivative", () => {
    const valid = writeSvgProvenance(svg, {
        ...fields(address),
        composition: recipe(),
    } as any).text;
    const broken = valid.replace("&quot;over-v1&quot;", "&quot;arbitrary-command&quot;");
    expect(() => readSvgProvenance(broken)).toThrow(/composition/);
    expect(checkProvenance([{ file: "broken.svg", bytes: broken }])).toContainEqual(
        expect.objectContaining({
            file: "broken.svg",
            message: expect.stringMatching(/composition/),
        }),
    );
    const derivative = valid.replace("<hl:address>", "<hl:derived>true</hl:derived><hl:address>");
    expect(checkProvenance([{ file: "derived.svg", bytes: derivative }])).toContainEqual(
        expect.objectContaining({ message: expect.stringMatching(/private and never repeated/) }),
    );
});
it("reports symlinks in component roots and duplicate addresses across boundaries", async () => {
    const { file } = await fixture();
    fs.symlinkSync(file, path.join(root, "components", "linked.png"));
    fs.copyFileSync(file, path.join(root, "components", "duplicate.png"));
    const result = collectArtMasters([path.join(root, "masters")], "sample", {
        componentRoots: [path.join(root, "components")],
    });
    expect(result.findings).toContainEqual(
        expect.objectContaining({
            file: path.join(root, "components", "linked.png"),
            message: expect.stringMatching(/symbolic links/),
        }),
    );
    expect(result.findings).toContainEqual(
        expect.objectContaining({
            file: path.join(root, "components", "duplicate.png"),
            message: expect.stringMatching(/source image without a recipe/),
        }),
    );
});
it("keeps components out of staged and CDN assets", async () => {
    await fixture();
    const file = path.join(root, "masters", "composite.png");
    fs.writeFileSync(
        file,
        writeProvenance(fs.readFileSync(file), { digitalSourceType: "digitalCreation" }).bytes,
    );
    const art = collectArtMasters([path.join(root, "masters")], "sample", {
        componentRoots: [path.join(root, "components")],
    });
    const records = masterAssetRecords(new Map([...art.masters, ...art.components]));
    const prepared = await renderArtMasters(
        art.masters,
        [],
        path.join(root, "render"),
        path.join(root, "cache"),
    );
    const { stagePackageAssets } = await import("../engine/asset-shipping.mjs");
    const { planCdnPublish } = await import("../engine/cdn-publish.mjs");
    const stage = stagePackageAssets({
        assetsBase: path.join(root, "assets"),
        contentPackage: "sample",
        stageDir: path.join(root, "stage"),
        title: "Sample",
        records,
        preparedMasters: prepared,
    });
    expect(stage.findings).toEqual([]);
    expect(stage.staged).toHaveLength(1);
    const cdn = planCdnPublish({
        assetsBase: path.join(root, "assets"),
        contentPackage: "sample",
        host: "https://example.test",
        setFile: "set.json",
        setName: "Sample",
        records,
        preparedMasters: prepared,
    });
    const serialized = JSON.stringify({ stage, cdn });
    expect(serialized).not.toContain(red);
    expect(serialized).not.toContain(blue);
    expect(fs.readdirSync(path.join(root, "stage", "icons"))).toEqual(["composite.webp"]);
});
it("requires explicit component authorship and rights", async () => {
    await fixture();
    const file = path.join(root, "components", "red.png");
    fs.writeFileSync(file, writeProvenance(fs.readFileSync(file), { rights: null } as any).bytes);
    const art = collectArtMasters([path.join(root, "masters")], "sample", {
        componentRoots: [path.join(root, "components")],
    });
    expect(art.findings).toContainEqual(
        expect.objectContaining({ file, message: "private component rights is missing" }),
    );
});
it.each([false, true])(
    "protects component-only roots from output and symlink aliases (%s)",
    async (alias) => {
        const privateRoot = path.join(root, "private");
        fs.mkdirSync(privateRoot, { recursive: true });
        const original = path.join(privateRoot, "component.svg");
        fs.writeFileSync(original, "retained original");
        const destination = alias ? path.join(root, "alias") : privateRoot;
        if (alias) fs.symlinkSync(privateRoot, destination);
        const config = {
            rootDir: root,
            contentPackage: "sample",
            art: { componentRoots: [privateRoot] },
            paths: {
                content: path.join(root, "content"),
                assets: path.join(root, "assets"),
                contentIndex: destination,
                stage: destination,
                packJson: destination,
                unpack: destination,
            },
            packs: [],
            packDirectories: [],
        } as any;
        const { emitContentIndex } = await import("../engine/content-index.mjs");
        const { stagePackageBuildAssets } = await import("../engine/build-assets.mjs");
        const { buildPackageSite } = await import("../engine/site-render.mjs");
        const { cleanPacks } = await import("../engine/compendiums.mjs");
        expect(() => emitContentIndex({ config })).toThrow(/overlap/);
        await expect(
            stagePackageBuildAssets({
                config: {
                    rootDir: root,
                    assets: [],
                    stageDir: destination,
                    baseStyles: false,
                } as any,
                packConfig: config,
            }),
        ).rejects.toThrow(/overlap/);
        await expect(buildPackageSite({ config, out: destination })).rejects.toThrow(/overlap/);
        await expect(cleanPacks({ config, packDest: destination })).rejects.toThrow(/overlap/);
        expect(fs.readFileSync(original, "utf8")).toBe("retained original");
    },
);
it.each(["empty", "duplicate", "nested", "attribute"])(
    "refuses malformed composition XMP (%s)",
    (form) => {
        const valid = writeSvgProvenance(svg, {
            ...fields(address),
            composition: recipe(),
        } as any).text;
        const property = valid.match(/<hl:composition>[\s\S]*?<\/hl:composition>/)![0];
        const damaged =
            form === "empty" ? valid.replace(property, "<hl:composition/>")
            : form === "duplicate" ? valid.replace(property, property + property)
            : form === "nested" ?
                valid.replace(
                    property,
                    property.replace(
                        /(<hl:composition>)([\s\S]*)(<\/hl:composition>)/,
                        "$1<rdf:Seq><rdf:li>$2</rdf:li></rdf:Seq>$3",
                    ),
                )
            :   valid
                    .replace(property, "")
                    .replace("<rdf:Description ", `<rdf:Description hl:composition="{}" `);
        expect(() => readSvgProvenance(damaged)).toThrow(/composition/);
        expect(checkProvenance([{ file: "bad.svg", bytes: damaged }])).toContainEqual(
            expect.objectContaining({ message: expect.stringMatching(/composition/) }),
        );
    },
);
it("refuses private component roots in pinned offline mode", async () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
        path.join(root, "art.lock"),
        JSON.stringify({
            version: 1,
            package: "sample",
            source: { repository: "https://example.test/art.git", revision: "a".repeat(40) },
            rendered: { url: "https://example.test/art.zip", sha256: "b".repeat(64) },
        }),
    );
    const { readArtLock } = await import("../engine/art-lock.mjs");
    expect(() =>
        readArtLock({
            rootDir: root,
            contentPackage: "sample",
            art: { componentRoots: [path.join(root, "private")] },
        }),
    ).toThrow(/separate input modes/);
});
it("rejects private source addresses and composition metadata from pinned public ZIPs", async () => {
    await fixture();
    const { createHash } = await import("node:crypto");
    const { zipSync } = await import("fflate");
    const { fetchPublicArt } = await import("../engine/art-lock.mjs");
    const { writeDerivativeProvenance } = await import("../engine/art-provenance.mjs");
    const config = {
        rootDir: root,
        contentPackage: "sample",
        paths: { assets: path.join(root, "assets") },
    };
    const records = [
        {
            type: "icon",
            address: { canonical: address },
            asset: {
                path: "icons/composite.svg",
                attribution: "Example Artist",
                license: "CC-BY-SA-4.0",
                ai: false,
            },
        },
    ];
    const clean = writeDerivativeProvenance(
        svg,
        { ...fields(address), derivedFrom: address },
        { repeat: ["derivedFrom"] },
    ).text;
    const source = writeDerivativeProvenance(
        svg,
        { ...fields(red), derivedFrom: red },
        { repeat: ["derivedFrom"] },
    ).bytes;
    const metadata = writeSvgProvenance(svg, {
        ...fields(address),
        composition: { layers: [{ address: red }] },
    } as any).text.match(/<hl:composition>[\s\S]*?<\/hl:composition>/)![0];
    for (const entries of [
        { "composite.svg": Buffer.from(clean), "private.svg": source },
        {
            "composite.svg": Buffer.from(
                clean.replace("</rdf:Description>", metadata + "</rdf:Description>"),
            ),
        },
    ]) {
        const zip = Buffer.from(zipSync(entries));
        fs.writeFileSync(
            path.join(root, "art.lock"),
            JSON.stringify({
                version: 1,
                package: "sample",
                source: { repository: "https://example.test/art.git", revision: "a".repeat(40) },
                rendered: {
                    url: "https://example.test/art.zip",
                    sha256: createHash("sha256").update(zip).digest("hex"),
                },
            }),
        );
        const from = path.join(root, "candidate.zip");
        fs.writeFileSync(from, zip);
        await expect(fetchPublicArt(config, { from, records })).rejects.toThrow(
            /standard index|private|metadata/,
        );
    }
});
