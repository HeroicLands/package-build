/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import { deriveRecord, provenancePacket } from "../engine/art-provenance-core.mjs";
import { inspectPublicDerivative } from "../engine/art-public-derivative.mjs";
import { prepareArtPackage } from "../engine/art-package.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { serializeContentIndex } from "../engine/content-index.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const sha = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const address = "sample-none-image-one";
const master = {
    address,
    creator: ["Artist", "Second credit"],
    rights: "Rights",
    derivedFrom: address,
};
const packet = provenancePacket(deriveRecord(master, { repeat: ["derivedFrom"] }));
async function jpeg(xmp: string, progressive = false) {
    return sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } })
        .jpeg({ progressive })
        .withXmp(xmp)
        .toBuffer();
}
function installed(bytes: Buffer) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jpeg-public-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "images"));
    fs.writeFileSync(path.join(root, "images/one.jpg"), bytes);
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "art-test", version: "1.0.0" }),
    );
    const row = {
        package: "sample",
        type: "image",
        shortcode: "one",
        address: { canonical: address },
        asset: {
            path: "images/one.jpg",
            attribution: master.creator,
            license: "CC0-1.0",
            ai: null,
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
            assets: [{ path: "images/one.jpg", sha256: sha(bytes) }],
        }),
    );
    return root;
}
it.each([false, true])(
    "accepts canonical multi-credit JPEG metadata with progressive=%s",
    async (progressive) => {
        const bytes = await jpeg(packet, progressive);
        expect(inspectPublicDerivative("one.jpg", bytes, "sample").metadata.creator).toEqual(
            master.creator,
        );
        const root = installed(bytes);
        await expect(
            prepareArtPackage(root, {
                name: "art-test",
                version: "1.0.0",
                contentPackage: "sample",
            }),
        ).resolves.toBeDefined();
    },
);
it.each([
    [
        "creator attribute",
        (x: string) =>
            x.replace(
                "<dc:creator>",
                '<dc:creator xmlns:secret="urn:private" secret:prompt="private">',
            ),
    ],
    [
        "rights attribute",
        (x: string) =>
            x.replace(
                "<dc:rights>",
                '<dc:rights xmlns:secret="urn:private" secret:prompt="private">',
            ),
    ],
    [
        "creator descendant",
        (x: string) =>
            x.replace(
                "</rdf:Seq>",
                '<secret:extra xmlns:secret="urn:private">private</secret:extra></rdf:Seq>',
            ),
    ],
    [
        "wrapper content",
        (x: string) =>
            x.replace(
                "</x:xmpmeta>",
                '<secret:extra xmlns:secret="urn:private">private</secret:extra></x:xmpmeta>',
            ),
    ],
])("refuses %s even with matching descriptor hashes", async (_label, alter) => {
    const bytes = await jpeg(alter(packet));
    expect(() => inspectPublicDerivative("one.jpg", bytes, "sample")).toThrow();
    await expect(
        prepareArtPackage(installed(bytes), {
            name: "art-test",
            version: "1.0.0",
            contentPackage: "sample",
        }),
    ).rejects.toThrow();
});
it("rejects a second XMP packet after progressive scans", async () => {
    const bytes = await jpeg(packet, true),
        prefix = Buffer.from("http://ns.adobe.com/xap/1.0/\0"),
        data = Buffer.concat([prefix, Buffer.from(packet)]);
    const header = Buffer.alloc(4);
    header[0] = 0xff;
    header[1] = 0xe1;
    header.writeUInt16BE(data.length + 2, 2);
    const mixed = Buffer.concat([bytes.subarray(0, -2), header, data, bytes.subarray(-2)]);
    expect(() => inspectPublicDerivative("one.jpg", mixed, "sample")).toThrow();
    await expect(
        prepareArtPackage(installed(mixed), {
            name: "art-test",
            version: "1.0.0",
            contentPackage: "sample",
        }),
    ).rejects.toThrow();
});

it.each([true, false])("accepts canonical public JPEGs with explicit AI status %s", async (ai) => {
    const selected = deriveRecord(
        { ...master, ai, name: "Subject", primaryNote: "sample-note-being-subject" },
        { repeat: ["derivedFrom", "name", "primaryNote"], notePublic: true },
    );
    const bytes = await jpeg(provenancePacket(selected));
    const inspected = inspectPublicDerivative("one.jpg", bytes, "sample");
    expect(inspected.metadata.ai).toBe(ai);
    expect(inspected.metadata.creator).toEqual(master.creator);
    expect(inspected.metadata.rights).toBe("Rights");
    expect(inspected.metadata.primaryNote).toBe("sample-note-being-subject");
});
