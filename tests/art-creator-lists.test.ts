/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import {
    writeProvenance,
    readProvenance,
    readJpegProvenance,
    readJpegProvenance,
    writeSvgProvenance,
    readSvgProvenance,
} from "../engine/art-provenance.mjs";
import { collectArtMasters, masterAssetRecords } from "../engine/art-masters.mjs";
import { renderArtMasters } from "../engine/art-master-render.mjs";
import { renderPdfMaster } from "../engine/pdf-images.mjs";
import { serializeContentIndex } from "../engine/content-index.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { prepareArtPackage } from "../engine/art-package.mjs";

import { assertPublicCreators } from "../engine/art-provenance-core.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const credits = ["Artist, lead", "Élodie & Co.", "Artist, lead"];
it("keeps all ordered credits through masters, index, public pictures and JPEG", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-credit-"));
    roots.push(root);
    const masterDir = path.join(root, "private");
    fs.mkdirSync(masterDir);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } })
        .png()
        .toBuffer();
    const fields = {
        address: "sample-none-image-one",
        creator: credits,
        rights: "Rights",
        license: "CC0-1.0",
    };
    const master = writeProvenance(png, fields).bytes;
    fs.writeFileSync(path.join(masterDir, "one.png"), master);
    expect(readProvenance(master).record.creator).toEqual(credits);
    expect(readProvenance(master).standard.creator).toEqual([credits.join(", ")]);
    const vectorFields = { ...fields, address: "sample-none-icon-two" };
    const vector = writeSvgProvenance(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
        vectorFields,
    ).bytes;
    fs.writeFileSync(path.join(masterDir, "two.svg"), vector);
    const collected = collectArtMasters([masterDir], "sample");
    expect(collected.findings).toEqual([]);
    const rows = masterAssetRecords(collected.masters);
    const index = serializeContentIndex(
        rows.map((row) => decodeIndexAddresses(row, { package: "sample" })),
    );
    expect(index).not.toContain(masterDir);
    for (const row of index
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)))
        expect(row.asset.attribution).toEqual(credits);
    const rendered = await renderArtMasters(
        collected.masters,
        rows,
        path.join(root, "build/art"),
        path.join(root, "build/cache"),
    );
    expect(
        readJpegProvenance(fs.readFileSync(rendered.get(fields.address)!)).record.creator,
    ).toEqual(credits);
    expect(
        readSvgProvenance(fs.readFileSync(rendered.get(vectorFields.address)!)).record.creator,
    ).toEqual(credits);
    const jpeg = await renderPdfMaster(master, fields, [{ width: 2, height: 2 }], "screen", false);
    expect(readJpegProvenance(jpeg).record.creator).toEqual(credits);
    const firstRendered = fs.readFileSync(rendered.get(fields.address)!);
    const changed = [credits[0], "Changed second credit", credits[2]];
    fs.writeFileSync(
        path.join(masterDir, "one.png"),
        writeProvenance(master, { creator: changed }).bytes,
    );
    const changedMasters = collectArtMasters([masterDir], "sample");
    const updated = await renderArtMasters(
        changedMasters.masters,
        masterAssetRecords(changedMasters.masters),
        path.join(root, "build/art"),
        path.join(root, "build/cache"),
    );
    const updatedBytes = fs.readFileSync(updated.get(fields.address)!);
    expect(updatedBytes).not.toEqual(firstRendered);
    expect(readJpegProvenance(updatedBytes).record.creator).toEqual(changed);
});
it("rejects reordered public creator credits even with a matching index digest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-credit-package-"));
    roots.push(root);
    const address = "sample-none-icon-one",
        file = "icons/one.svg";
    const image = writeSvgProvenance(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
        { address, creator: credits, rights: "Rights" },
    ).bytes;
    const { writeDerivativeProvenance } = await import("../engine/art-provenance.mjs");
    const publicImage = writeDerivativeProvenance(
        image,
        { address, creator: credits, rights: "Rights", derivedFrom: address },
        { repeat: ["derivedFrom"] },
    ).bytes;
    fs.mkdirSync(path.join(root, "icons"));
    fs.writeFileSync(path.join(root, file), publicImage);
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "art-test", version: "1.0.0" }),
    );
    const row = {
        package: "sample",
        type: "icon",
        shortcode: "one",
        address: { canonical: address },
        asset: {
            path: file,
            attribution: [credits[1], credits[0], credits[2]],
            license: "CC0-1.0",
            ai: false,
        },
    };
    const index = serializeContentIndex([decodeIndexAddresses(row, { package: "sample" })]);
    fs.writeFileSync(path.join(root, "index.jsonl"), index);
    fs.writeFileSync(
        path.join(root, "artwork.json"),
        JSON.stringify({
            formatVersion: 1,
            contentPackage: "sample",
            index: { path: "index.jsonl", sha256: sha(index) },
            assets: [{ path: file, sha256: sha(publicImage) }],
        }),
    );
    await expect(
        prepareArtPackage(root, { name: "art-test", version: "1.0.0", contentPackage: "sample" }),
    ).rejects.toThrow(/creator/);
});

it.each([
    '<dc:creator rdf:resource="urn:person"/>',
    '<dc:creator><rdf:Seq><rdf:li>A</rdf:li><rdf:li rdf:resource="urn:person"/></rdf:Seq></dc:creator>',
    '<dc:creator><rdf:Seq><rdf:li>A</rdf:li><rdf:li rdf:parseType="Resource"><rdf:value>B</rdf:value></rdf:li></rdf:Seq></dc:creator>',
    '<dc:creator><rdf:Seq><rdf:li>A</rdf:li><rdf:_2 rdf:resource="urn:person"/></rdf:Seq></dc:creator>',
    "<dc:creator><rdf:Seq><rdf:li>A</rdf:li><rdf:_2>B</rdf:_2></rdf:Seq></dc:creator>",
    "<dc:creator><rdf:Seq><rdf:li>A</rdf:li><rdf:Bag><rdf:li>B</rdf:li></rdf:Bag></rdf:Seq></dc:creator>",
    "<dc:creator><rdf:Seq><rdf:li>A</rdf:li>unrepresented text</rdf:Seq></dc:creator>",
])("refuses public projection of resource-valued creator structure %s", (property) => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description>${property}</rdf:Description></rdf:RDF>`;
    expect(() => assertPublicCreators(packet)).toThrow(/creator/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-unsupported-credit-"));
    roots.push(root);
    const vector = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="hl-provenance">${packet.replace("<rdf:Description>", '<rdf:Description xmlns:hl="https://heroiclands.org/ns/1.0/" hl:address="sample-none-image-one">')}</metadata></svg>`;
    fs.writeFileSync(path.join(root, "one.svg"), vector);
    expect(
        collectArtMasters([root], "sample").findings.some((finding) =>
            /creator/.test(finding.message),
        ),
    ).toBe(true);
});

it("accepts namespace aliases and inherited language without changing the raw master credits", () => {
    const packet =
        '<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:c="http://purl.org/dc/elements/1.1/" xmlns:h="https://heroiclands.org/ns/1.0/" xml:lang="en"><r:Description h:address="sample-none-image-one"><c:creator><r:Seq><r:li>First</r:li><r:li xml:lang="">Second</r:li></r:Seq></c:creator></r:Description></r:RDF>';
    expect(() => assertPublicCreators(packet)).not.toThrow();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="hl-provenance">${packet}</metadata></svg>`;
    const edited = writeSvgProvenance(svg, { title: "Title" });
    expect(readSvgProvenance(edited.bytes).record.creator).toEqual(["First", "Second"]);
    expect(edited.text).toContain('xml:lang=""');
});

it.each([
    '<rdf:Description dc:creator="First"/><other:element dc:creator="Second"/>',
    '<other:element dc:creator="Only"/>',
])("refuses creator attributes outside supported RDF descriptions", (content) => {
    const packet = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:other="urn:other">${content}</rdf:RDF>`;
    expect(() => assertPublicCreators(packet)).toThrow(/creator/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-outside-credit-"));
    roots.push(root);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="hl-provenance">${packet.replace("<rdf:RDF", '<rdf:RDF xmlns:hl="https://heroiclands.org/ns/1.0/"').replace("</rdf:RDF>", '<rdf:Description hl:address="sample-none-image-one"/></rdf:RDF>')}</metadata></svg>`;
    fs.writeFileSync(path.join(root, "one.svg"), svg);
    expect(
        collectArtMasters([root], "sample").findings.some((finding) =>
            /creator/.test(finding.message),
        ),
    ).toBe(true);
});
