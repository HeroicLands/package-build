/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { beforeAll, describe, expect, it } from "vitest";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import {
    DIGITAL_SOURCE_TRAINED_ALGORITHMIC,
    HL_NAMESPACE,
    XMP_KEYWORD,
    checkProvenance,
    formatFinding,
    makeTextChunk,
    masterFileName,
    planRenames,
    readChunks,
    readProvenance,
    readSvgProvenance,
    readTextChunk,
    writeProvenance,
    writeSvgProvenance,
} from "../engine/art-provenance.mjs";

const PROMPT = `A "drake" of the deep, café-lit — naïve & <wild>, 'quoted'\r\nsecond line\ttabbed 日本語 🐉`;
const GENERATOR = JSON.stringify({
    service: "replicate.com",
    model: "unrecorded",
    seed: "unrecorded",
});
const FIELDS = {
    address: "thalorna-note-being-abyssdrk",
    kind: "creature-landscape",
    prompt: PROMPT,
    generator: GENERATOR,
    title: "Abyssdrake",
    creator: "Tom Rodriguez",
    rights: "© 2026 Tom Rodriguez. CC-BY-SA 4.0",
    created: "2026-03-20T10:00:00Z",
    software: "replicate.com",
};

let png: Buffer;

/** Insert chunks before the first IDAT. */
function withChunks(bytes: Buffer, extra: Buffer[]): Buffer {
    const chunks = readChunks(bytes);
    const at = chunks.findIndex((chunk) => chunk.type === "IDAT");
    return Buffer.concat([
        bytes.subarray(0, 8),
        ...chunks.slice(0, at).map((chunk) => chunk.raw),
        ...extra,
        ...chunks.slice(at).map((chunk) => chunk.raw),
    ]);
}

const nonText = (bytes: Buffer) =>
    readChunks(bytes)
        .filter((chunk) => !["tEXt", "zTXt", "iTXt"].includes(chunk.type))
        .map((chunk) => chunk.raw.toString("hex"));

const types = (bytes: Buffer) => readChunks(bytes).map((chunk) => chunk.type);

const pixels = async (bytes: Buffer) =>
    (await sharp(bytes).ensureAlpha().raw().toBuffer()).toString("base64");

beforeAll(async () => {
    png = await sharp({
        create: { width: 24, height: 16, channels: 3, background: { r: 200, g: 40, b: 90 } },
    })
        .composite([
            {
                input: await sharp({
                    create: {
                        width: 8,
                        height: 8,
                        channels: 3,
                        background: { r: 1, g: 250, b: 3 },
                    },
                })
                    .png()
                    .toBuffer(),
                left: 4,
                top: 4,
            },
        ])
        .withMetadata({ density: 144 })
        .withIccProfile("srgb")
        .png()
        .toBuffer();
});

describe("writeProvenance", () => {
    it("round-trips every field exactly through both encodings", () => {
        const out = writeProvenance(png, FIELDS);
        const read = readProvenance(out.bytes);
        expect(read.xmp).toEqual({
            address: FIELDS.address,
            identifier: FIELDS.address,
            kind: FIELDS.kind,
            prompt: PROMPT,
            generator: GENERATOR,
            title: FIELDS.title,
            creator: FIELDS.creator,
            rights: FIELDS.rights,
            digitalSourceType: DIGITAL_SOURCE_TRAINED_ALGORITHMIC,
        });
        expect(read.standard).toEqual({
            title: FIELDS.title,
            creator: FIELDS.creator,
            rights: FIELDS.rights,
            prompt: PROMPT,
            created: FIELDS.created,
            software: FIELDS.software,
        });
        expect(read.packet).toContain(`xmlns:hl="${HL_NAMESPACE}"`);
        expect(out.foreignXmp).toBe("none");
        expect(checkProvenance([{ file: "a.png", bytes: out.bytes }])).toEqual([]);
    });

    it("keeps pixels and every non-text chunk byte for byte", async () => {
        expect(types(png)).toContain("iCCP");
        expect(types(png)).toContain("pHYs");
        const out = writeProvenance(png, FIELDS);
        expect(nonText(out.bytes)).toEqual(nonText(png));
        expect(await pixels(out.bytes)).toBe(await pixels(png));
        const kinds = types(out.bytes);
        expect(kinds.indexOf("iTXt")).toBeLessThan(kinds.indexOf("IDAT"));
    });

    it("yields identical bytes when written twice with the same fields", () => {
        const once = writeProvenance(png, FIELDS);
        const twice = writeProvenance(once.bytes, FIELDS);
        expect(twice.changed).toBe(false);
        expect(twice.bytes.equals(once.bytes)).toBe(true);
    });

    it("replaces only the supplied field on a second pass", () => {
        const once = writeProvenance(png, FIELDS);
        const generator = JSON.stringify({ service: "replicate.com", model: "flux", seed: "7" });
        const twice = writeProvenance(once.bytes, { generator });
        const before = readChunks(once.bytes);
        const after = readChunks(twice.bytes);
        expect(after.map((chunk) => chunk.type)).toEqual(before.map((chunk) => chunk.type));
        const differing = after.filter((chunk, i) => !chunk.raw.equals(before[i].raw));
        expect(differing).toHaveLength(1);
        expect(readTextChunk(differing[0])?.keyword).toBe(XMP_KEYWORD);
        const read = readProvenance(twice.bytes);
        expect(read.record.generator).toBe(generator);
        expect({ ...read.record, generator: GENERATOR }).toEqual(readProvenance(once.bytes).record);
    });

    it("removes a field given as null, with its text chunk", () => {
        const once = writeProvenance(png, FIELDS);
        const out = writeProvenance(once.bytes, { created: null, software: null });
        const read = readProvenance(out.bytes);
        expect(read.standard.created).toBeUndefined();
        expect(read.standard.software).toBeUndefined();
        expect(read.standard.title).toBe(FIELDS.title);
    });

    it("replaces a text chunk of the same keyword in any text form", () => {
        const old = Buffer.concat([Buffer.from("Software\0Old Tool", "latin1")]);
        const tEXt = makeTextChunk("Comment", "kept");
        const legacy = readChunks(withChunks(png, [tEXt.raw]));
        const raw = Buffer.alloc(8 + old.length + 4);
        raw.writeUInt32BE(old.length, 0);
        raw.write("tEXt", 4, "latin1");
        old.copy(raw, 8);
        raw.writeUInt32BE(zlib.crc32(raw.subarray(4, 8 + old.length)), 8 + old.length);
        const input = withChunks(png, [raw]);
        expect(legacy).toBeTruthy();
        const out = writeProvenance(input, { ...FIELDS });
        expect(types(out.bytes).filter((t) => t === "tEXt")).toHaveLength(0);
        expect(readProvenance(out.bytes).standard.software).toBe("replicate.com");
    });

    it("keeps unrelated text chunks", () => {
        const comment = makeTextChunk("Comment", "keep me");
        const out = writeProvenance(withChunks(png, [comment.raw]), FIELDS);
        expect(readChunks(out.bytes).some((chunk) => chunk.raw.equals(comment.raw))).toBe(true);
    });

    it("keeps another tool's XMP properties and replaces the ones it manages", () => {
        const photoshop =
            '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
            '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:CreatorTool="Adobe Photoshop 25.0" ' +
            'xmp:ModifyDate="2026-02-01T09:00:00+00:00">' +
            "<dc:format>image/png</dc:format>" +
            '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old Title</rdf:li></rdf:Alt></dc:title>' +
            '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
        const input = withChunks(png, [makeTextChunk(XMP_KEYWORD, photoshop).raw]);
        const out = writeProvenance(input, FIELDS);
        const read = readProvenance(out.bytes);
        expect(out.foreignXmp).toBe("kept");
        expect(read.packet).toContain("Adobe Photoshop 25.0");
        expect(read.packet).toContain("<dc:format>image/png</dc:format>");
        expect(read.packet).not.toContain("Old Title");
        expect(read.xmp.title).toBe("Abyssdrake");
        expect(types(out.bytes).filter((t) => t === "iTXt")).toHaveLength(7);
        const again = writeProvenance(out.bytes, { rights: "© 2026 Tom Rodriguez. CC-BY-SA 4.0" });
        expect(again.bytes.equals(out.bytes)).toBe(true);
        expect(again.foreignXmp).toBe("kept");
    });

    it("replaces an XMP packet that is not RDF and says so", () => {
        const input = withChunks(png, [makeTextChunk(XMP_KEYWORD, "not xml at all").raw]);
        const out = writeProvenance(input, FIELDS);
        expect(out.foreignXmp).toBe("discarded");
        expect(readProvenance(out.bytes).xmp.address).toBe(FIELDS.address);
    });

    it("keeps one XMP chunk when the file holds several", () => {
        const input = withChunks(png, [
            makeTextChunk(XMP_KEYWORD, "x").raw,
            makeTextChunk(XMP_KEYWORD, "y").raw,
        ]);
        const out = writeProvenance(input, FIELDS);
        const xmpCount = readChunks(out.bytes).filter(
            (chunk) => readTextChunk(chunk)?.keyword === XMP_KEYWORD,
        ).length;
        expect(xmpCount).toBe(1);
    });

    it("reads an XMP packet stored compressed", () => {
        const once = writeProvenance(png, FIELDS);
        const packet = readProvenance(once.bytes).packet as string;
        const data = Buffer.concat([
            Buffer.from(XMP_KEYWORD + "\0", "latin1"),
            Buffer.from([1, 0, 0, 0]),
            zlib.deflateSync(Buffer.from(packet, "utf8")),
        ]);
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write("iTXt", 4, "latin1");
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])));
        const compressed = withChunks(png, [Buffer.concat([head, data, crc])]);
        expect(readProvenance(compressed).xmp.address).toBe(FIELDS.address);
    });

    it("refuses a missing or malformed address and a bad generator", () => {
        const { address: _address, ...rest } = FIELDS;
        expect(() => writeProvenance(png, rest)).toThrow(/needs an address/);
        expect(() => writeProvenance(png, { ...FIELDS, address: "abyssdrk" })).toThrow(/complete/);
        expect(() => writeProvenance(png, { ...FIELDS, generator: "nope" })).toThrow(/JSON object/);
        expect(() => writeProvenance(png, { ...FIELDS, prompt: "bad\u0001char" })).toThrow(/XML/);
        expect(() => writeProvenance(Buffer.from("nope"), FIELDS)).toThrow(/not a PNG/);
    });

    it("refuses a corrupted chunk", () => {
        const bad = Buffer.from(png);
        bad[bad.length - 20] ^= 0xff;
        expect(() => writeProvenance(bad, FIELDS)).toThrow(/CRC|truncated/);
    });
});

describe("formerNames", () => {
    it("writes an rdf:Bag and appends later names without duplicates", () => {
        const first = writeProvenance(png, { ...FIELDS, formerNames: ["images/a/abyssdrake.png"] });
        expect(first.bytes.toString("latin1")).toContain("<rdf:Bag>");
        const second = writeProvenance(first.bytes, {
            formerNames: ["images/a/abyssdrake.png", "images/a/abyssdrk-creature.png"],
        });
        expect(readProvenance(second.bytes).xmp.formerNames).toEqual([
            "images/a/abyssdrake.png",
            "images/a/abyssdrk-creature.png",
        ]);
        const third = writeProvenance(second.bytes, {
            formerNames: ["images/a/abyssdrk-creature.png"],
        });
        expect(third.bytes.equals(second.bytes)).toBe(true);
        expect(readProvenance(third.bytes).standard.formerNames).toBeUndefined();
        expect(checkProvenance([{ file: "a.png", bytes: third.bytes }])).toEqual([]);
    });

    it("keeps the list when other fields change and removes it for null", () => {
        const first = writeProvenance(png, { ...FIELDS, formerNames: ["x & <y>.png"] });
        const edited = writeProvenance(first.bytes, { title: "Other" });
        expect(readProvenance(edited.bytes).xmp.formerNames).toEqual(["x & <y>.png"]);
        const cleared = writeProvenance(edited.bytes, { formerNames: null });
        expect(readProvenance(cleared.bytes).xmp.formerNames).toBeUndefined();
    });

    it("refuses an empty list or a non-string entry", () => {
        expect(() => writeProvenance(png, { ...FIELDS, formerNames: [] })).toThrow(/formerNames/);
        expect(() => writeProvenance(png, { ...FIELDS, formerNames: [""] })).toThrow(/formerNames/);
    });
});

describe("master names", () => {
    it("names a master by note shortcode and role", () => {
        expect(masterFileName("thalorna-note-being-abyssdrk", 1152, 896)).toBe(
            "abyssdrk-creature.png",
        );
        expect(masterFileName("thalorna-note-being-zahira", 896, 1152)).toBe("zahira-portrait.png");
        expect(() => masterFileName("thalorna-note-being-x", 100, 100)).toThrow(/no role/);
        expect(() => masterFileName("abyssdrk", 1152, 896)).toThrow(/complete/);
    });

    it("refuses both masters that would share a name", () => {
        const plan = planRenames([
            {
                path: "images/c/one.png",
                address: "thalorna-note-being-same",
                width: 1152,
                height: 896,
            },
            {
                path: "images/c/two.png",
                address: "thalorna-note-being-same",
                width: 1152,
                height: 896,
            },
            {
                path: "images/c/three.png",
                address: "thalorna-note-being-solo",
                width: 1152,
                height: 896,
            },
            {
                path: "images/d/four.png",
                address: "thalorna-note-being-same",
                width: 1152,
                height: 896,
            },
        ]);
        expect(plan.renames.map((r) => r.to).sort()).toEqual([
            "images/c/solo-creature.png",
            "images/d/same-creature.png",
        ]);
        expect(plan.refused.map((r) => r.path).sort()).toEqual([
            "images/c/one.png",
            "images/c/two.png",
        ]);
        expect(plan.refused[0].reason).toMatch(/would be named images\/c\/same-creature\.png/);
    });
});

describe("checkProvenance", () => {
    const written = (address: string) => writeProvenance(png, { ...FIELDS, address }).bytes;

    it("accepts a sound set", () => {
        expect(
            checkProvenance([
                { file: "a.png", bytes: written("thalorna-note-being-aaa") },
                { file: "b.png", bytes: written("thalorna-note-being-bbb") },
            ]),
        ).toEqual([]);
    });

    it("refuses a file with no address", () => {
        const findings = checkProvenance([{ file: "bare.png", bytes: png }]);
        expect(findings.map((f) => f.message).join("\n")).toMatch(/no address/);
        expect(formatFinding(findings[0])).toMatch(/^bare\.png:1:1: error: /);
    });

    it("refuses a malformed address", () => {
        const good = written("thalorna-note-being-aaa");
        const bad = Buffer.from(
            readChunks(good)
                .map((chunk) => {
                    const entry = readTextChunk(chunk);
                    if (entry?.keyword !== XMP_KEYWORD) return chunk.raw;
                    return makeTextChunk(
                        XMP_KEYWORD,
                        entry.text.replace("thalorna-note-being-aaa", "Being aaa"),
                    ).raw;
                })
                .reduce((all, raw) => Buffer.concat([all, raw]), good.subarray(0, 8)),
        );
        const findings = checkProvenance([{ file: "bad.png", bytes: bad }]);
        expect(findings.map((f) => f.message).join("\n")).toMatch(/malformed address/);
    });

    it("refuses an address two files share", () => {
        const findings = checkProvenance([
            { file: "a.png", bytes: written("thalorna-note-being-same") },
            { file: "b.png", bytes: written("thalorna-note-being-same") },
        ]);
        expect(findings).toHaveLength(2);
        expect(findings[0].message).toMatch(/shared by 2 files/);
    });

    it("refuses a file whose text chunks were lost", () => {
        const kept = readChunks(written("thalorna-note-being-aaa")).filter((chunk) => {
            const entry = readTextChunk(chunk);
            return !entry || entry.keyword === XMP_KEYWORD;
        });
        const bytes = Buffer.concat([readChunksSignature(), ...kept.map((chunk) => chunk.raw)]);
        const findings = checkProvenance([{ file: "lost.png", bytes }]);
        expect(findings.map((f) => f.message).join("\n")).toMatch(/Title text chunk is missing/);
    });

    it("refuses a file whose XMP packet was lost", () => {
        const kept = readChunks(written("thalorna-note-being-aaa")).filter(
            (chunk) => readTextChunk(chunk)?.keyword !== XMP_KEYWORD,
        );
        const bytes = Buffer.concat([readChunksSignature(), ...kept.map((chunk) => chunk.raw)]);
        const findings = checkProvenance([{ file: "lost.png", bytes }]);
        expect(findings.map((f) => f.message).join("\n")).toMatch(/XMP packet is missing/);
    });

    it("refuses a file whose two encodings disagree", () => {
        const changed = readChunks(written("thalorna-note-being-aaa")).map((chunk) =>
            readTextChunk(chunk)?.keyword === "Title" ?
                makeTextChunk("Title", "Other").raw
            :   chunk.raw,
        );
        const bytes = Buffer.concat([readChunksSignature(), ...changed]);
        const findings = checkProvenance([{ file: "off.png", bytes }]);
        expect(findings.map((f) => f.message).join("\n")).toMatch(/disagree/);
    });
});

function readChunksSignature(): Buffer {
    return png.subarray(0, 8);
}

const MANAGED = /<metadata id="hl-provenance">[\s\S]*?<\/metadata>/;
const SVG_FIELDS = { ...FIELDS };
const xmllint = spawnSync("xmllint", ["--version"]).error === undefined;

/** Whether the text is well-formed XML, by the system parser when present. */
function wellFormed(text: string): boolean {
    if (!xmllint) return true;
    return spawnSync("xmllint", ["--noout", "-"], { input: text }).status === 0;
}

const SVG_BODY =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'viewBox="0 0 10 10" width="10" height="10">\n' +
    "  <title>Mark</title>\n  <desc>A mark</desc>\n" +
    '  <metadata id="other"><x/></metadata>\n' +
    '  <rect width="10" height="10" fill="#c82859"/>\n</svg>\n';

describe("SVG provenance", () => {
    const write = (text: string, fields: Record<string, unknown> = SVG_FIELDS) =>
        writeSvgProvenance(text, fields);

    it("round-trips every field exactly", () => {
        const out = write(SVG_BODY);
        const read = readSvgProvenance(out.bytes);
        expect(read.xmp).toEqual({
            address: FIELDS.address,
            identifier: FIELDS.address,
            kind: FIELDS.kind,
            prompt: PROMPT,
            generator: GENERATOR,
            title: FIELDS.title,
            creator: FIELDS.creator,
            rights: FIELDS.rights,
        });
        expect(read.packet).toContain(`xmlns:hl="${HL_NAMESPACE}"`);
        expect(wellFormed(out.text)).toBe(true);
        expect(checkProvenance([{ file: "a.svg", bytes: out.bytes }])).toEqual([]);
    });

    it("keeps every byte outside the managed element", () => {
        const doc =
            '\ufeff<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- lead -->\r\n' +
            '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [ <!ENTITY a "b>"> ]>\r\n' +
            '<svg  b="2"  a="1" xmlns="http://www.w3.org/2000/svg">\r\n\t<g/>\r\n</svg>\r\n';
        const out = write(doc);
        expect(out.text.replace(MANAGED, "")).toBe(doc);
        expect(out.text).toContain("\r\n<x:xmpmeta");
        expect(wellFormed(out.text.replace("\ufeff", ""))).toBe(true);
    });

    it("is idempotent", () => {
        const once = write(SVG_BODY);
        const twice = write(once.text);
        expect(twice.changed).toBe(false);
        expect(twice.text).toBe(once.text);
    });

    it("replaces only the supplied field on a second pass", () => {
        const once = write(SVG_BODY);
        const twice = write(once.text, { title: "Other" });
        expect(twice.text.replace(MANAGED, "")).toBe(SVG_BODY);
        const read = readSvgProvenance(twice.text).xmp;
        expect(read.title).toBe("Other");
        expect(read.prompt).toBe(PROMPT);
    });

    it("appends formerNames without duplicates", () => {
        const first = write(SVG_BODY, { ...SVG_FIELDS, formerNames: ["a & <b>.svg"] });
        const second = write(first.text, { formerNames: ["a & <b>.svg", "c.svg"] });
        expect(readSvgProvenance(second.text).xmp.formerNames).toEqual(["a & <b>.svg", "c.svg"]);
        expect(write(second.text, { formerNames: ["c.svg"] }).changed).toBe(false);
        const cleared = write(second.text, { formerNames: null });
        expect(readSvgProvenance(cleared.text).xmp.formerNames).toBeUndefined();
    });

    it("places the element after the leading title and desc", () => {
        const out = write(SVG_BODY).text;
        expect(out.indexOf("</desc>")).toBeLessThan(out.indexOf('<metadata id="hl-provenance">'));
        expect(out.indexOf('<metadata id="hl-provenance">')).toBeLessThan(
            out.indexOf('<metadata id="other">'),
        );
        const titleOnly = write('<svg xmlns="http://www.w3.org/2000/svg"><title>T</title></svg>');
        expect(titleOnly.text).toMatch(/<\/title><metadata id="hl-provenance">/);
        const none = write('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
        expect(none.text).toMatch(/^<svg [^>]*><metadata id="hl-provenance">/);
        const late = write("<svg><g/><title>T</title></svg>").text;
        expect(late.indexOf("<metadata")).toBeLessThan(late.indexOf("<g/>"));
    });

    it("converts a self-closing root to an open and close pair", () => {
        const doc = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" />\n';
        const out = write(doc);
        expect(out.text.replace(MANAGED, "")).toBe(
            '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" ></svg>\n',
        );
        expect(wellFormed(out.text)).toBe(true);
        expect(write(out.text).changed).toBe(false);
    });

    it("handles an XML declaration, leading comments and prefixed namespaces", () => {
        const doc =
            '<?xml version="1.0" standalone="no"?>\n<!-- <svg> not the root -->\n' +
            '<svg xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg"><svg:g/></svg>';
        const out = write(doc);
        expect(out.text.replace(MANAGED, "")).toBe(doc);
        expect(wellFormed(out.text)).toBe(true);
        expect(readSvgProvenance(out.text).xmp.address).toBe(FIELDS.address);
    });

    it("refuses documents it cannot edit safely", () => {
        expect(() => write('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>')).toThrow(
            /prefixed/,
        );
        expect(() => write("<?xml version='1.0'?><!-- nothing -->")).toThrow(/no root element/);
        const twice = '<svg><metadata id="hl-provenance"/><metadata id="hl-provenance"/></svg>';
        expect(() => write(twice)).toThrow(/more|2 elements/);
        expect(() => write(Buffer.from([0x3c, 0x73, 0xff, 0xfe]))).toThrow(/UTF-8/);
        expect(() => write("<svg><g></svg>")).toThrow(/not well formed/);
        expect(() => write("<html/>")).toThrow(/not <svg>/);
        const { address: _a, ...rest } = SVG_FIELDS;
        expect(() => write("<svg/>", rest)).toThrow(/needs an address/);
        expect(() => write("<svg/>", { ...SVG_FIELDS, prompt: "bad\u0001" })).toThrow(/XML/);
    });

    it("ignores a hl-provenance id inside a comment", () => {
        const doc = '<svg><!-- id="hl-provenance" --><g/></svg>';
        expect(write(doc).text.replace(MANAGED, "")).toBe(doc);
    });
});

describe("role, derivedFrom and digitalSourceType", () => {
    const extra = {
        role: "icon-source",
        derivedFrom: "icons/old & <odd>/mark.png",
        digitalSourceType: "algorithmicMedia",
    };
    const URI = "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia";

    it("round-trips on a PNG", () => {
        const out = writeProvenance(png, { ...FIELDS, ...extra });
        const read = readProvenance(out.bytes).xmp;
        expect(read.role).toBe("icon-source");
        expect(read.derivedFrom).toBe(extra.derivedFrom);
        expect(read.digitalSourceType).toBe(URI);
        expect(checkProvenance([{ file: "a.png", bytes: out.bytes }])).toEqual([]);
        expect(writeProvenance(out.bytes, { ...FIELDS, ...extra }).changed).toBe(false);
    });

    it("round-trips on an SVG", () => {
        const out = writeSvgProvenance("<svg/>", { ...FIELDS, ...extra });
        const read = readSvgProvenance(out.text).xmp;
        expect(read.role).toBe("icon-source");
        expect(read.derivedFrom).toBe(extra.derivedFrom);
        expect(read.digitalSourceType).toBe(URI);
    });

    it("defaults a PNG to trainedAlgorithmicMedia and an SVG to nothing", () => {
        expect(readProvenance(writeProvenance(png, FIELDS).bytes).xmp.digitalSourceType).toBe(
            DIGITAL_SOURCE_TRAINED_ALGORITHMIC,
        );
        expect(
            readSvgProvenance(writeSvgProvenance("<svg/>", FIELDS).text).xmp.digitalSourceType,
        ).toBeUndefined();
    });

    it("overrides, accepts a full URI, keeps on merge, and none removes", () => {
        const uri = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation";
        const first = writeProvenance(png, { ...FIELDS, digitalSourceType: uri });
        expect(readProvenance(first.bytes).xmp.digitalSourceType).toBe(uri);
        const kept = writeProvenance(first.bytes, { title: "T2" });
        expect(readProvenance(kept.bytes).xmp.digitalSourceType).toBe(uri);
        const none = writeProvenance(png, { ...FIELDS, digitalSourceType: "none" });
        expect(readProvenance(none.bytes).xmp.digitalSourceType).toBeUndefined();
        expect(readProvenance(none.bytes).packet).not.toContain("DigitalSourceType");
        const again = writeProvenance(none.bytes, { title: "T3" });
        expect(readProvenance(again.bytes).xmp.digitalSourceType).toBeUndefined();
        const svg = writeSvgProvenance("<svg/>", {
            ...FIELDS,
            digitalSourceType: "digitalCreation",
        });
        const merged = writeSvgProvenance(svg.text, { title: "T2" });
        expect(readSvgProvenance(merged.text).xmp.digitalSourceType).toBe(uri);
        const dropped = writeSvgProvenance(svg.text, { digitalSourceType: "none" });
        expect(dropped.text).not.toContain("DigitalSourceType");
        expect(() => writeProvenance(png, { ...FIELDS, digitalSourceType: "bogus" })).toThrow(
            /digitalSourceType/,
        );
    });
});

describe("addresses of other packages", () => {
    it("accepts any lowercase package with the none system and an image or icon type", () => {
        for (const address of [
            "harnensemble-none-image-fff1031",
            "harnensemble-none-icon-fff704atok",
        ]) {
            const out = writeProvenance(png, { ...FIELDS, address });
            expect(readProvenance(out.bytes).xmp.address).toBe(address);
            expect(checkProvenance([{ file: "a.png", bytes: out.bytes }])).toEqual([]);
        }
    });

    it("refuses an address with an uppercase or hyphenated segment or the wrong length", () => {
        for (const address of [
            "Harnensemble-none-image-a",
            "harn-ensemble-none-image-a",
            "harnensemble-none-image",
        ]) {
            expect(() => writeProvenance(png, { ...FIELDS, address })).toThrow(/Address/);
        }
    });
});

describe("description, source and processing", () => {
    const extra = {
        description: "Credited to the artists as a group.",
        source: "https://example.org/a?b=1&c=2",
        processing: "Extracted & <cleaned>; converted to PNG.",
    };

    it("round-trips through the XMP packet and the standard chunks", () => {
        const out = writeProvenance(png, { ...FIELDS, ...extra });
        const read = readProvenance(out.bytes);
        expect(read.xmp.description).toBe(extra.description);
        expect(read.xmp.source).toBe(extra.source);
        expect(read.xmp.processing).toBe(extra.processing);
        expect(read.standard.description).toBe(extra.description);
        expect(read.standard.source).toBe(extra.source);
        expect(read.standard.processing).toBeUndefined();
        expect(checkProvenance([{ file: "a.png", bytes: out.bytes }])).toEqual([]);
        expect(writeProvenance(out.bytes, { ...FIELDS, ...extra }).changed).toBe(false);
    });

    it("keeps on merge and removes with null", () => {
        const first = writeProvenance(png, { ...FIELDS, ...extra });
        const kept = writeProvenance(first.bytes, { title: "T2" });
        expect(readProvenance(kept.bytes).record.processing).toBe(extra.processing);
        const dropped = writeProvenance(first.bytes, { source: null, description: null });
        const read = readProvenance(dropped.bytes);
        expect(read.xmp.source).toBeUndefined();
        expect(read.standard.description).toBeUndefined();
        expect(() => writeProvenance(png, { ...FIELDS, processing: "" })).toThrow(/processing/);
    });
});

describe("checkProvenance by address and role", () => {
    const png2 = (address: string, role?: string) =>
        writeProvenance(png, { ...FIELDS, address, ...(role ? { role } : {}) }).bytes;
    const svg2 = (address: string, role?: string) =>
        writeSvgProvenance("<svg/>", { ...FIELDS, address, ...(role ? { role } : {}) }).bytes;

    it("accepts the same address with different roles, across formats", () => {
        const a = "thalorna-note-being-aaa";
        expect(
            checkProvenance([
                { file: "a.png", bytes: png2(a) },
                { file: "b.svg", bytes: svg2(a, "icon-source") },
                { file: "c.png", bytes: png2(a, "icon") },
            ]),
        ).toEqual([]);
    });

    it("refuses the same address and role twice, and an absent role equals the empty role", () => {
        const a = "thalorna-note-being-aaa";
        const same = checkProvenance([
            { file: "a.svg", bytes: svg2(a, "icon") },
            { file: "b.png", bytes: png2(a, "icon") },
        ]);
        expect(same).toHaveLength(2);
        expect(same[0].message).toMatch(/with role icon is shared by 2 files/);
        const bare = checkProvenance([
            { file: "a.svg", bytes: svg2(a) },
            { file: "b.png", bytes: png2(a) },
        ]);
        expect(bare).toHaveLength(2);
    });

    it("sniffs content, not the extension, and reports SVG faults", () => {
        const svg = svg2("thalorna-note-being-aaa");
        expect(checkProvenance([{ file: "really-svg.png", bytes: svg }])).toEqual([]);
        expect(
            checkProvenance([{ file: "x.svg", bytes: png2("thalorna-note-being-bbb") }]),
        ).toEqual([]);
        const bare = checkProvenance([{ file: "bare.svg", bytes: Buffer.from("<svg/>") }]);
        expect(bare.map((f) => f.message).join("\n")).toMatch(/element is missing/);
        expect(bare.map((f) => f.message).join("\n")).toMatch(/no address/);
        const bad = checkProvenance([{ file: "bad.svg", bytes: Buffer.from([0xff, 0xfe]) }]);
        expect(formatFinding(bad[0])).toMatch(/^bad\.svg:1:1: error: .*UTF-8/);
        const malformed = writeSvgProvenance("<svg/>", {
            ...FIELDS,
            address: "thalorna-note-being-aaa",
        }).text.replace("thalorna-note-being-aaa", "Being aaa");
        expect(
            checkProvenance([{ file: "m.svg", bytes: Buffer.from(malformed) }])
                .map((f) => f.message)
                .join("\n"),
        ).toMatch(/malformed address/);
    });
});

const ICONS = "/Volumes/Data/ExtGames/RPG/Heroic_Lands/cdn/thalorna/icons";

function listSvgs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSvgs(full);
        return entry.name.toLowerCase().endsWith(".svg") ? [full] : [];
    });
}

describe.skipIf(!fs.existsSync(ICONS))("real SVG masters", () => {
    const render = async (input: Buffer | string) =>
        (
            await sharp(Buffer.from(input))
                .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .ensureAlpha()
                .raw()
                .toBuffer()
        ).toString("base64");

    it("embeds provenance without changing a pixel or breaking the XML", async () => {
        const files = listSvgs(ICONS);
        expect(files.length).toBeGreaterThan(0);
        for (const [index, file] of files.entries()) {
            // A master that already carries a record is compared without it, so the
            // test reads the file as it was before provenance was embedded.
            const original = Buffer.from(fs.readFileSync(file, "utf8").replace(MANAGED, ""));
            const out = writeSvgProvenance(original, {
                ...FIELDS,
                address: `thalorna-note-being-icon${index}`,
                role: "icon-source",
            });
            expect(out.text.replace(MANAGED, ""), file).toBe(original.toString("utf8"));
            expect(wellFormed(out.text), file).toBe(true);
            expect(writeSvgProvenance(out.bytes, {}).changed, file).toBe(false);
            expect(await render(out.bytes), file).toBe(await render(original));
        }
    }, 120_000);
});

const XPACKET = '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>\n';
const XPACKET_END = '<?xpacket end="w"?>';

/** Whether a packet parses as XML, when xmllint is present. */
const packetWellFormed = (packet: string) => wellFormed(packet.replace(/<\?xpacket[^?]*\?>/g, ""));

describe("foreign XMP retention", () => {
    const retain = (packet: string) => {
        const input = withChunks(png, [makeTextChunk(XMP_KEYWORD, packet).raw]);
        const out = writeProvenance(input, FIELDS);
        const read = readProvenance(out.bytes);
        return { out, read };
    };
    const ownFields = (read: ReturnType<typeof readProvenance>) => {
        expect(read.xmp.address).toBe(FIELDS.address);
        expect(read.xmp.identifier).toBe(FIELDS.address);
        expect(read.xmp.title).toBe(FIELDS.title);
        expect(read.xmp.prompt).toBe(PROMPT);
        expect(packetWellFormed(read.packet as string)).toBe(true);
    };

    it("keeps a prefix declared on rdf:RDF bound", () => {
        const { out, read } = retain(
            XPACKET +
                '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
                '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
                'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">' +
                '<rdf:Description rdf:about=""><photoshop:Credit>A. Artist</photoshop:Credit>' +
                "</rdf:Description></rdf:RDF></x:xmpmeta>" +
                XPACKET_END,
        );
        expect(out.foreignXmp).toBe("kept");
        expect(read.packet).toContain("<photoshop:Credit>A. Artist</photoshop:Credit>");
        expect(read.packet).toContain('xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"');
        ownFields(read);
        expect(writeProvenance(out.bytes, {}).bytes.equals(out.bytes)).toBe(true);
    });

    it("keeps a prefix declared on x:xmpmeta bound, without duplicating our own", () => {
        const { out, read } = retain(
            XPACKET +
                '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" ' +
                'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
                '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
                '<rdf:Description rdf:about=""><photoshop:Credit>A. Artist</photoshop:Credit>' +
                "</rdf:Description></rdf:RDF></x:xmpmeta>" +
                XPACKET_END,
        );
        expect(out.foreignXmp).toBe("kept");
        expect(read.packet).toContain("photoshop:Credit");
        expect(read.packet).toContain("photoshop:Credit");
        ownFields(read);
    });

    const DC = "http://purl.org/dc/elements/1.1/";
    const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    const PS = "http://ns.adobe.com/photoshop/1.0/";
    const foreignPackets: Record<string, string> = {
        "photoshop on rdf:RDF": `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${RDF}" xmlns:photoshop="${PS}"><rdf:Description rdf:about=""><photoshop:Credit>A</photoshop:Credit></rdf:Description></rdf:RDF></x:xmpmeta>`,
        "dc on rdf:RDF": `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${RDF}" xmlns:dc="${DC}"><rdf:Description rdf:about=""><dc:format>image/png</dc:format></rdf:Description></rdf:RDF></x:xmpmeta>`,
        "dc on x:xmpmeta": `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="${DC}"><rdf:RDF xmlns:rdf="${RDF}"><rdf:Description rdf:about=""><dc:format>image/png</dc:format></rdf:Description></rdf:RDF></x:xmpmeta>`,
        "dc and photoshop on both roots": `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="${DC}"><rdf:RDF xmlns:rdf="${RDF}" xmlns:photoshop="${PS}"><rdf:Description rdf:about=""><dc:format>image/png</dc:format><photoshop:Credit>A</photoshop:Credit></rdf:Description></rdf:RDF></x:xmpmeta>`,
    };

    it.skipIf(!xmllint).each(Object.keys(foreignPackets))(
        "binds every prefix of the complete output packet: %s",
        (name) => {
            const { out, read } = retain(XPACKET + foreignPackets[name] + XPACKET_END);
            expect(out.foreignXmp).toBe("kept");
            const body = (read.packet as string).replace(/<\?xpacket[^>]*\?>/g, "");
            const lint = spawnSync("xmllint", ["--noout", "-"], { input: body, encoding: "utf8" });
            expect(lint.stderr).toBe("");
            expect(lint.status).toBe(0);
            ownFields(read);
            expect(writeProvenance(out.bytes, {}).bytes.equals(out.bytes)).toBe(true);
        },
    );

    it("discards a packet that binds one of our prefixes to another namespace", () => {
        const { out, read } = retain(
            XPACKET +
                '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
                '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
                'xmlns:dc="http://example.org/not-dublin-core/">' +
                '<rdf:Description rdf:about=""><dc:format>x</dc:format></rdf:Description>' +
                "</rdf:RDF></x:xmpmeta>" +
                XPACKET_END,
        );
        expect(out.foreignXmp).toBe("discarded");
        expect(out.foreignXmpReason).toContain("dc");
        expect(read.packet).toContain(`xmlns:dc="http://purl.org/dc/elements/1.1/"`);
        expect(read.packet).not.toContain("not-dublin-core");
        ownFields(read);
    });

    it("discards a malformed packet and a packet with an unbound prefix", () => {
        const malformed = retain(
            XPACKET +
                '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' +
                'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
                'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">' +
                '<rdf:Description rdf:about=""><photoshop:Credit>oops</rdf:Description>' +
                "</rdf:RDF></x:xmpmeta>" +
                XPACKET_END,
        );
        expect(malformed.out.foreignXmp).toBe("discarded");
        expect(malformed.out.foreignXmpReason).toBeTruthy();
        ownFields(malformed.read);

        const unbound = retain(
            XPACKET +
                '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
                '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
                '<rdf:Description rdf:about=""><photoshop:Credit>x</photoshop:Credit>' +
                "</rdf:Description></rdf:RDF></x:xmpmeta>" +
                XPACKET_END,
        );
        expect(unbound.out.foreignXmp).toBe("discarded");
        ownFields(unbound.read);
    });

    it("retains nothing foreign in an SVG", () => {
        const out = writeSvgProvenance(SVG_BODY, SVG_FIELDS);
        expect(wellFormed(out.text)).toBe(true);
        expect(out.text.match(/<metadata id="hl-provenance"/g)).toHaveLength(1);
        expect(out.text).toContain('<metadata id="other"><x/></metadata>');
    });
});

describe("dc:identifier", () => {
    const strip = (packet: string, name: string) =>
        packet.replace(new RegExp(`\\s*<${name}>[^<]*</${name}>`), "");
    const rewrite = (bytes: Buffer, change: (packet: string) => string) => {
        const packet = readProvenance(bytes).packet as string;
        const replacement = makeTextChunk(XMP_KEYWORD, change(packet)).raw;
        return Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            ...readChunks(bytes).map((chunk) =>
                readTextChunk(chunk)?.keyword === XMP_KEYWORD ? replacement : chunk.raw,
            ),
        ]);
    };

    it("is written beside hl:address on a PNG and an SVG", () => {
        const png1 = writeProvenance(png, FIELDS);
        expect(png1.record.identifier).toBe(FIELDS.address);
        expect(readProvenance(png1.bytes).packet).toContain(
            `<dc:identifier>${FIELDS.address}</dc:identifier>`,
        );
        const svg1 = writeSvgProvenance(SVG_BODY, SVG_FIELDS);
        expect(svg1.text).toContain(`<dc:identifier>${FIELDS.address}</dc:identifier>`);
        expect(readSvgProvenance(svg1.bytes).xmp.identifier).toBe(FIELDS.address);
    });

    it("reads a file with only one of the two as holding both, and a write fills the gap", () => {
        const written = writeProvenance(png, FIELDS).bytes;
        const noIdentifier = rewrite(written, (p) => strip(p, "dc:identifier"));
        expect(checkProvenance([{ file: "a.png", bytes: noIdentifier }])).toEqual([]);
        expect(readProvenance(noIdentifier).record.identifier).toBe(FIELDS.address);
        const filled = writeProvenance(noIdentifier, { title: "Renamed" });
        expect(readProvenance(filled.bytes).xmp.identifier).toBe(FIELDS.address);

        const noAddress = rewrite(written, (p) => strip(p, "hl:address"));
        expect(checkProvenance([{ file: "a.png", bytes: noAddress }])).toEqual([]);
        expect(readProvenance(noAddress).record.address).toBe(FIELDS.address);
        const refilled = writeProvenance(noAddress, { title: "Renamed" });
        expect(readProvenance(refilled.bytes).xmp.address).toBe(FIELDS.address);
    });

    it("reports a dc:identifier that differs from hl:address", () => {
        const written = writeProvenance(png, FIELDS).bytes;
        const differing = rewrite(written, (p) =>
            p.replace(
                `<dc:identifier>${FIELDS.address}</dc:identifier>`,
                "<dc:identifier>thalorna-none-image-abcd</dc:identifier>",
            ),
        );
        const findings = checkProvenance([{ file: "a.png", bytes: differing }]);
        expect(findings).toHaveLength(1);
        expect(formatFinding(findings[0])).toMatch(
            /^a\.png:1:1: error: dc:identifier .* differs from hl:address/,
        );
        const svg = writeSvgProvenance(SVG_BODY, SVG_FIELDS).text.replace(
            `<dc:identifier>${FIELDS.address}</dc:identifier>`,
            "<dc:identifier>thalorna-none-image-abcd</dc:identifier>",
        );
        expect(checkProvenance([{ file: "a.svg", bytes: svg }])).toHaveLength(1);
        expect(writeProvenance(differing, {}).record.identifier).toBe(FIELDS.address);
    });
});
