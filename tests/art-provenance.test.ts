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
    deriveRecord,
    effectiveRecord,
    findMaster,
    makeTextChunk,
    masterFileName,
    planRenames,
    readChunks,
    readXmpRecord,
    readJpegProvenance,
    readProvenance,
    readSvgProvenance,
    readTextChunk,
    readWebpProvenance,
    readWebpChunks,
    writeDerivativeProvenance,
    writeProvenance,
    writeSvgProvenance,
    writeWebpProvenance,
} from "../engine/art-provenance.mjs";

import { buildPrimaryNoteIndex } from "../engine/art-primary-note.mjs";
import { renderPdfMaster } from "../engine/pdf-images.mjs";

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
        expect(findings[0].message).toMatch(/has 2 masters/);
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

describe("checkProvenance by master and derivative", () => {
    const A = "thalorna-note-being-aaa";
    let webp: Buffer;
    beforeAll(async () => {
        webp = await sharp(png).webp().toBuffer();
    });
    const png2 = (address: string, extra = {}) =>
        writeProvenance(png, { ...FIELDS, address, ...extra }).bytes;
    const svg2 = (address: string, extra = {}) =>
        writeSvgProvenance("<svg/>", { ...FIELDS, address, ...extra }).bytes;
    const webp2 = (address: string, extra: object = {}) =>
        writeWebpProvenance(webp, { ...FIELDS, address, ...extra }).bytes;
    const webpD = (address: string) =>
        writeDerivativeProvenance(webp, { ...FIELDS, address }).bytes;
    const svgD = (address: string) =>
        writeDerivativeProvenance("<svg/>", { ...FIELDS, address }).bytes;

    it("accepts a PNG master and its WebP derivative as a pair", () => {
        expect(
            checkProvenance([
                { file: "a.png", bytes: png2(A) },
                { file: "a.webp", bytes: webpD(A) },
            ]),
        ).toEqual([]);
    });

    it("accepts an SVG as a master and as a derivative", () => {
        expect(checkProvenance([{ file: "a.svg", bytes: svg2(A) }])).toEqual([]);
        expect(
            checkProvenance([
                { file: "a.svg", bytes: svg2(A) },
                { file: "b.svg", bytes: svgD(A) },
            ]),
        ).toEqual([]);
        expect(
            checkProvenance([
                { file: "a.png", bytes: png2(A) },
                { file: "b.svg", bytes: svgD(A) },
            ]),
        ).toEqual([]);
    });

    it("accepts several derivatives of one master", () => {
        expect(
            checkProvenance([
                { file: "a.png", bytes: png2(A) },
                { file: "a.webp", bytes: webpD(A) },
                { file: "b.webp", bytes: webpD(A) },
                { file: "c.svg", bytes: svgD(A) },
            ]),
        ).toEqual([]);
    });

    it("refuses two masters with one address", () => {
        const masters = checkProvenance([
            { file: "a.svg", bytes: svg2(A) },
            { file: "b.png", bytes: png2(A) },
        ]);
        expect(masters).toHaveLength(2);
        expect(masters[0].message).toMatch(/has 2 masters/);
    });

    it("refuses a derivative whose address has no master", () => {
        const found = checkProvenance([
            { file: "a.webp", bytes: webpD(A) },
            { file: "m.png", bytes: png2("thalorna-note-being-other") },
        ]);
        expect(found).toHaveLength(1);
        expect(found[0].file).toBe("a.webp");
        expect(found[0].message).toMatch(/no master/);
    });

    describe("a derivative that repeats master properties", () => {
        const NOTE = "thalorna-note-being-bbb";
        const extra = {
            name: "Abyssdrake",
            primaryNote: NOTE,
            formerNames: ["old/a.png"],
            description: "credited",
        };
        const values: Record<string, unknown> = { ...extra, prompt: PROMPT, generator: GENERATOR };
        const masterWith = (more: object) => ({
            file: "m.png",
            bytes: png2(A, more),
        });

        it("never counts hl:derived as stale or missing on the master", () => {
            const master = masterWith({});
            for (const bytes of [webpD(A), svgD(A)]) {
                expect(readProvenance(master.bytes).xmp.derived).toBeUndefined();
                expect(checkProvenance([master, { file: "d", bytes }])).toEqual([]);
            }
        });

        it("passes when each repeated value equals the master's", () => {
            const master = masterWith(extra);
            const record = readProvenance(master.bytes).record;
            for (const bytes of [
                writeDerivativeProvenance(webp, record, {
                    repeat: Object.keys(extra),
                    notePublic: true,
                }).bytes,
                writeDerivativeProvenance("<svg/>", record, {
                    repeat: Object.keys(extra),
                    notePublic: true,
                }).bytes,
            ]) {
                expect(checkProvenance([master, { file: "d", bytes }])).toEqual([]);
            }
        });

        it("reports a repeated value that differs, naming the property and both values", () => {
            const master = masterWith(extra);
            for (const [field, value] of Object.entries({
                name: "Other",
                description: "x ".repeat(60),
            })) {
                const bytes = writeWebpProvenance(webpD(A), { [field]: value }).bytes;
                const found = checkProvenance([master, { file: "d.webp", bytes }]);
                expect(found).toHaveLength(1);
                expect(found[0].message).toMatch(/is stale: its master m\.png has/);
                expect(found[0].message).toContain(field === "name" ? "hl:name" : "hl:description");
                expect(found[0].message.length).toBeLessThan(260);
            }
            const former = writeSvgProvenance(svgD(A), { formerNames: ["other.png"] }).bytes;
            expect(checkProvenance([master, { file: "d.svg", bytes: former }])[0].message).toMatch(
                /hl:formerNames .* is stale/,
            );
        });

        it("reports a property the master does not carry", () => {
            const master = masterWith({ prompt: null });
            for (const [field, name] of [
                ["prompt", "dc:description|hl:prompt"],
                ["name", "hl:name"],
                ["primaryNote", "hl:primarynote"],
                ["description", "hl:description"],
            ] as const) {
                for (const bytes of [
                    writeWebpProvenance(webpD(A), { [field]: values[field] }).bytes,
                    writeSvgProvenance(svgD(A), { [field]: values[field] }).bytes,
                ]) {
                    const found = checkProvenance([master, { file: "d", bytes }]);
                    expect(found, field).toHaveLength(1);
                    expect(found[0].message).toMatch(/is not carried by its master m\.png/);
                    expect(found[0].message).toMatch(new RegExp(name));
                }
            }
        });
    });

    it("refuses a WebP without hl:derived and a PNG with it", () => {
        const bare = checkProvenance([{ file: "a.webp", bytes: webp2(A) }]);
        expect(bare.map((f) => f.message)).toEqual([
            expect.stringMatching(/WebP is a derivative and must carry hl:derived/),
        ]);
        const derivedPng = checkProvenance([{ file: "a.png", bytes: png2(A, { derived: true }) }]);
        expect(derivedPng.map((f) => f.message)).toContainEqual(
            expect.stringMatching(/PNG is a master and must not carry hl:derived/),
        );
    });

    it("refuses an hl:derived value other than true", () => {
        for (const bytes of [
            Buffer.from(svgD(A).toString().replace(">true<", ">false<")),
            webpD(A).toString("latin1").includes("<hl:derived>true<") ?
                Buffer.from(
                    webpD(A).toString("latin1").replace("<hl:derived>true<", "<hl:derived>yes_<"),
                    "latin1",
                )
            :   Buffer.alloc(0),
        ]) {
            const found = checkProvenance([{ file: "x", bytes }]);
            expect(found.map((f) => f.message).join("\n")).toMatch(/hl:derived .* must be "true"/);
        }
        expect(() => writeSvgProvenance("<svg/>", { ...FIELDS, derived: "false" })).toThrow(
            /derived/,
        );
    });

    it("reads hl:derived back from each format and keeps it on rewrite", () => {
        const reads = [
            [webpD(A), (b: Buffer) => readWebpProvenance(b).xmp, writeWebpProvenance],
            [svgD(A), (b: Buffer) => readSvgProvenance(b).xmp, writeSvgProvenance],
            [png2(A, { derived: true }), (b: Buffer) => readProvenance(b).xmp, writeProvenance],
        ] as const;
        for (const [bytes, read, write] of reads) {
            expect(read(bytes).derived).toBe("true");
            const again = (write as any)(bytes, { title: "Other" });
            expect(read(again.bytes).derived).toBe("true");
            expect((write as any)(bytes, { derived: null }).record.derived).toBeUndefined();
        }
        expect(readProvenance(png2(A)).xmp.derived).toBeUndefined();
    });

    it("leaves a master that carries no hl:derived byte for byte as it was", () => {
        const once = png2(A);
        expect(writeProvenance(once, {}).changed).toBe(false);
        expect(readProvenance(once).packet).not.toContain("hl:derived");
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
        expect(read.packet).toContain("A. Artist</photoshop:Credit>");
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

    it("retains comments in a master's RDF packet and reports them", async () => {
        const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><!-- outside-rdf --><rdf:RDF xmlns:rdf="${RDF}"><!-- outer-comment --><rdf:Description xmlns:hl="${HL_NAMESPACE}" xmlns:p="urn:foreign"><hl:address>${FIELDS.address}<!-- nested-comment --></hl:address><!-- inner-comment --><p:credit>Artist</p:credit></rdf:Description></rdf:RDF></x:xmpmeta>`;
        const { out, read } = retain(packet);
        expect(out.foreignXmp).toBe("kept");
        expect(read.packet).toContain("<!-- outer-comment -->");
        expect(read.packet).toContain("<!-- inner-comment -->");
        expect(read.packet).toContain("<!-- nested-comment -->");
        expect(read.packet).toContain("<p:credit>Artist</p:credit>");
        expect(read.packet).not.toContain("outside-rdf");
        expect(writeProvenance(out.bytes, {}).bytes).toEqual(out.bytes);
        const webp = await sharp(png).withXmp(packet).webp().toBuffer();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="hl-provenance">${packet}</metadata></svg>`;
        for (const result of [writeWebpProvenance(webp, FIELDS), writeSvgProvenance(svg, FIELDS)]) {
            expect(result.foreignXmp).toBe("kept");
            const bytes = result.bytes.toString("utf8");
            expect(bytes).not.toContain("outside-rdf");
            expect(bytes).toContain("<p:credit>Artist</p:credit>");
            for (const comment of ["outer-comment", "inner-comment", "nested-comment"])
                expect(bytes).toContain(comment);
        }
    });

    it("keeps foreign properties sharing a managed description in PNG, WebP and SVG masters", async () => {
        const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${RDF}"><rdf:Description rdf:about="" xmlns:hl="${HL_NAMESPACE}" xmlns:photoshop="${PS}" photoshop:Credit="Artist"><hl:address>${FIELDS.address}</hl:address><hl:prompt>old prompt</hl:prompt><photoshop:Instructions>Keep this</photoshop:Instructions><hl:other>Keep extra</hl:other></rdf:Description></rdf:RDF></x:xmpmeta>`;
        const webp = await sharp(png).withXmp(packet).webp().toBuffer();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><metadata id="hl-provenance">${packet}</metadata><rect width="8" height="8"/></svg>`;
        const pngInput = withChunks(png, [makeTextChunk(XMP_KEYWORD, packet).raw]);
        const cases = [
            {
                input: pngInput,
                write: (b: Buffer | string, fields: object) => writeProvenance(b as Buffer, fields),
                read: (b: Buffer) => readProvenance(b),
            },
            {
                input: webp,
                write: (b: Buffer | string, fields: object) =>
                    writeWebpProvenance(b as Buffer, fields),
                read: (b: Buffer) => readWebpProvenance(b),
            },
            {
                input: svg,
                write: (b: Buffer | string, fields: object) => writeSvgProvenance(b, fields),
                read: (b: Buffer) => readSvgProvenance(b),
            },
        ];
        for (const { input, write, read } of cases) {
            const out = write(input, { ...FIELDS, prompt: "new prompt" });
            expect(out.foreignXmp).toBe("kept");
            const result = read(out.bytes);
            expect(result.packet).toContain("Keep this");
            expect(result.packet).toContain("Keep extra");
            expect(result.packet).toContain('photoshop:Credit="Artist"');
            expect(result.record.prompt).toBe("new prompt");
            expect(result.packet).not.toContain("old prompt");
            expect(write(out.bytes, {}).bytes).toEqual(out.bytes);
            expect(await sharp(out.bytes).raw().toBuffer()).toEqual(
                await sharp(Buffer.from(input)).raw().toBuffer(),
            );
        }
        const cleanPng = writeProvenance(png, FIELDS);
        const cleanWebp = writeWebpProvenance(await sharp(png).webp().toBuffer(), FIELDS);
        const cleanSvg = writeSvgProvenance(
            '<svg>\r\n<metadata id="other"><x/></metadata>\r\n</svg>',
            FIELDS,
        );
        expect(writeProvenance(cleanPng.bytes, {}).foreignXmp).toBe("none");
        expect(writeWebpProvenance(cleanWebp.bytes, {}).foreignXmp).toBe("none");
        expect(writeSvgProvenance(cleanSvg.bytes, {}).foreignXmp).toBe("none");
        expect(cleanSvg.text).toContain('<metadata id="other"><x/></metadata>');
        expect(cleanSvg.text.replaceAll("\r\n", "")).not.toContain("\n");
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

describe("deriveRecord", () => {
    const MASTER = {
        ...FIELDS,
        address: "thalorna-note-being-abyssdrk",
        name: "Abyssdrake",
        primaryNote: "thalorna-note-being-abyssdrk",
        role: "portrait",
        formerNames: ["old/abyss.png"],
        description: "Credited to a private person",
        source: "https://example.test/private",
        processing: "upscaled",
        digitalSourceType: DIGITAL_SOURCE_TRAINED_ALGORITHMIC,
    };

    it("repeats the properties asked for and refuses one that cannot be", () => {
        expect(deriveRecord(MASTER, { repeat: ["description", "kind"] })).toEqual({
            address: MASTER.address,
            identifier: MASTER.address,
            derived: "true",
            creator: MASTER.creator,
            rights: MASTER.rights,
            description: MASTER.description,
            kind: MASTER.kind,
        });
        expect(() => deriveRecord(MASTER, { repeat: ["derived"] })).toThrow(/cannot be repeated/);
        expect(() => deriveRecord(MASTER, { repeat: ["bogus"] })).toThrow(/cannot be repeated/);
    });

    it("never repeats a prompt or generation details, whatever notePublic says", () => {
        for (const field of ["prompt", "generator"]) {
            for (const notePublic of [undefined, true, false]) {
                expect(() => deriveRecord(MASTER, { repeat: [field], notePublic })).toThrow(
                    new RegExp(`${field} is generation detail`),
                );
            }
        }
    });

    it("repeats hl:name and hl:primarynote only for a public note", () => {
        for (const field of ["name", "primaryNote"]) {
            for (const notePublic of [undefined, false]) {
                expect(() => deriveRecord(MASTER, { repeat: [field], notePublic })).toThrow(
                    new RegExp(`${field} is repeated on a derivative only when .* public`),
                );
            }
        }
        const record = deriveRecord(MASTER, { repeat: ["name", "primaryNote"], notePublic: true });
        expect(record).toMatchObject({ name: MASTER.name, primaryNote: MASTER.primaryNote });
        expect(record).not.toHaveProperty("prompt");
        expect(record).not.toHaveProperty("generator");
        const gmOnly = deriveRecord(MASTER, { notePublic: false });
        expect(gmOnly).not.toHaveProperty("name");
        expect(gmOnly).not.toHaveProperty("primaryNote");
    });

    it("writes a public note's name and Address equal to the master's, never generation details", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const m = { file: "m.png", bytes: writeProvenance(png, MASTER).bytes };
        const record = readProvenance(m.bytes).record;
        const out = writeDerivativeProvenance(webp, record, {
            repeat: ["name", "primaryNote"],
            notePublic: true,
        });
        const { xmp, packet } = readWebpProvenance(out.bytes);
        expect(xmp).toMatchObject({ name: MASTER.name, primaryNote: MASTER.primaryNote });
        expect(packet).not.toContain("hl:prompt");
        expect(packet).not.toContain("hl:generator");
        expect(checkProvenance([m, { file: "d.webp", bytes: out.bytes }])).toEqual([]);
        const gm = writeDerivativeProvenance(webp, record, { notePublic: false });
        expect(readWebpProvenance(gm.bytes).xmp.name).toBeUndefined();
        expect(readWebpProvenance(gm.bytes).xmp.primaryNote).toBeUndefined();
    });

    it("keeps only the address, rights, attribution and hl:derived by default", () => {
        expect(deriveRecord(MASTER)).toEqual({
            address: MASTER.address,
            identifier: MASTER.address,
            derived: "true",
            creator: MASTER.creator,
            rights: MASTER.rights,
        });
        expect(deriveRecord({ address: MASTER.address })).toEqual({
            address: MASTER.address,
            identifier: MASTER.address,
            derived: "true",
        });
        expect(() => deriveRecord({ prompt: "x" })).toThrow(/address/);
    });

    it("resolves a derivative's properties from the master by address", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const m = { file: "m.png", bytes: writeProvenance(png, MASTER).bytes };
        const d = {
            file: "d.webp",
            bytes: writeDerivativeProvenance(webp, { ...MASTER, rights: "Other terms" }).bytes,
        };
        const set = [m, d];
        expect(findMaster(set, MASTER.address)).toMatchObject({ file: "m.png" });
        expect(findMaster([d], MASTER.address)).toEqual({ reason: "no-master" });
        expect(findMaster([m, m], MASTER.address)).toMatchObject({ reason: "several-masters" });
        const own = readProvenance(m.bytes).record;
        expect(effectiveRecord(m, set)).toEqual(own);
        expect(effectiveRecord(d, set)).toEqual({ ...own, rights: "Other terms" });
        const plain = {
            file: "p.webp",
            bytes: writeDerivativeProvenance(webp, { address: MASTER.address }).bytes,
        };
        expect(effectiveRecord(plain, set)).toEqual(own);
        const named = {
            file: "n.webp",
            bytes: writeDerivativeProvenance(webp, MASTER, { repeat: ["kind"] }).bytes,
        };
        expect(effectiveRecord(named, set)).toEqual(own);
        expect(() => effectiveRecord(d, [d])).toThrow(/no master/);
    });

    it("never takes an unmarked WebP as a master", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const unmarked = { file: "u.webp", bytes: writeWebpProvenance(webp, MASTER).bytes };
        const m = { file: "m.png", bytes: writeProvenance(png, MASTER).bytes };
        const d = {
            file: "d.webp",
            bytes: writeDerivativeProvenance(webp, MASTER).bytes,
        };
        expect(findMaster([unmarked], MASTER.address)).toEqual({ reason: "no-master" });
        expect(findMaster([unmarked, m], MASTER.address)).toMatchObject({ file: "m.png" });
        expect(() => effectiveRecord(d, [unmarked])).toThrow(/no master/);
        expect(checkProvenance([d, unmarked]).map((f) => f.message)).toEqual(
            expect.arrayContaining([expect.stringContaining("has no master")]),
        );
        const messages = checkProvenance([m, d, unmarked]).map((f) => f.message);
        expect(messages.some((x) => /masters:/.test(x))).toBe(false);
    });

    it("removes inherited EXIF and foreign XMP while retaining WebP pixels and color", async () => {
        const packet =
            '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:private="urn:private"><private:prompt>private-fixture</private:prompt></rdf:Description></rdf:RDF></x:xmpmeta>';
        const input = await sharp(png)
            .withExif({ IFD0: { ImageDescription: "private-fixture" } })
            .withXmp(packet)
            .withIccProfile("srgb")
            .webp()
            .toBuffer();
        const before = readWebpChunks(input).chunks;
        expect(before.map((chunk) => chunk.type)).toEqual(
            expect.arrayContaining(["EXIF", "XMP ", "ICCP"]),
        );
        const output = writeDerivativeProvenance(input, MASTER);
        const after = readWebpChunks(output.bytes).chunks;
        expect(after.some((chunk) => chunk.type === "EXIF")).toBe(false);
        expect(after.find((chunk) => chunk.type === "VP8X")!.data[0] & 0x08).toBe(0);
        expect(output.bytes.includes(Buffer.from("private-fixture"))).toBe(false);
        expect(output.foreignXmp).toBe("discarded");
        const retained = (chunks: typeof before) =>
            chunks
                .filter((chunk) => ["VP8 ", "VP8L", "ALPH", "ICCP"].includes(chunk.type))
                .map((chunk) => chunk.raw);
        expect(retained(after)).toEqual(retained(before));
        expect(await sharp(output.bytes).raw().toBuffer()).toEqual(
            await sharp(input).raw().toBuffer(),
        );
        expect(readWebpProvenance(output.bytes).record).toEqual(deriveRecord(MASTER));
        const again = writeDerivativeProvenance(output.bytes, MASTER);
        expect(again.bytes).toEqual(output.bytes);
        expect(again.changed).toBe(false);
        expect(
            readWebpChunks(writeWebpProvenance(input, MASTER).bytes).chunks.find(
                (chunk) => chunk.type === "EXIF",
            )?.raw,
        ).toEqual(before.find((chunk) => chunk.type === "EXIF")?.raw);
    });

    it("drops unknown WebP chunks and trailing bytes while retaining alpha and color flags", async () => {
        const rgba = Buffer.alloc(8 * 8 * 4, 128);
        const image = await sharp(rgba, { raw: { width: 8, height: 8, channels: 4 } })
            .withIccProfile("srgb")
            .webp()
            .toBuffer();
        const chunk = Buffer.alloc(8 + 16);
        chunk.write("JUNK", 0, "ascii");
        chunk.writeUInt32LE(16, 4);
        chunk.write("private-unknown", 8, "ascii");
        const header = Buffer.from(image.subarray(0, 12));
        header.writeUInt32LE(image.readUInt32LE(4) + chunk.length, 4);
        const input = Buffer.concat([
            header,
            image.subarray(12),
            chunk,
            Buffer.from("private-trailing"),
        ]);
        const output = writeDerivativeProvenance(input, MASTER);
        expect(output.bytes.includes(Buffer.from("private-unknown"))).toBe(false);
        expect(output.bytes.includes(Buffer.from("private-trailing"))).toBe(false);
        expect(
            readWebpChunks(output.bytes).chunks.find((entry) => entry.type === "VP8X")!.data[0],
        ).toBe(0x34);
        expect(await sharp(output.bytes).raw().toBuffer()).toEqual(
            await sharp(image).raw().toBuffer(),
        );
    });

    it("preserves the encoded animation when removing derivative metadata", async () => {
        const input = await sharp(
            Buffer.concat([Buffer.alloc(8 * 8 * 3, 9), Buffer.alloc(8 * 8 * 3, 200)]),
            { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } },
        )
            .withExif({ IFD0: { ImageDescription: "private-fixture" } })
            .webp({ loop: 0, delay: [100, 100] })
            .toBuffer();
        const output = writeDerivativeProvenance(input, MASTER);
        const frames = (bytes: Buffer) =>
            readWebpChunks(bytes)
                .chunks.filter((chunk) => ["ANIM", "ANMF"].includes(chunk.type))
                .map((chunk) => chunk.raw);
        expect(frames(input)).toHaveLength(3);
        expect(frames(output.bytes)).toEqual(frames(input));
        expect(readWebpChunks(output.bytes).chunks.some((chunk) => chunk.type === "EXIF")).toBe(
            false,
        );
        expect(await sharp(output.bytes, { animated: true }).raw().toBuffer()).toEqual(
            await sharp(input, { animated: true }).raw().toBuffer(),
        );
    });

    it("replaces inherited managed fields with only permitted master fields", async () => {
        const master = {
            ...MASTER,
            primaryNote: "thalorna-note-being-publicnote",
            prompt: "master-private-prompt",
            generator: '{"model":"master-private-generator"}',
        };
        const inherited = {
            ...master,
            name: "inherited-private-name",
            primaryNote: "thalorna-none-being-inheritedprivate",
            prompt: "inherited-private-prompt",
            generator: '{"model":"inherited-private-generator"}',
        };
        const webp = await sharp(png).webp().toBuffer();
        const inputs = [
            writeWebpProvenance(webp, inherited).bytes,
            writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', inherited).bytes,
        ];
        for (const input of inputs) {
            for (const notePublic of [false, true]) {
                const options =
                    notePublic ? { notePublic, repeat: ["name", "primaryNote"] } : { notePublic };
                const output = writeDerivativeProvenance(input, master, options).bytes.toString(
                    "utf8",
                );
                for (const value of [
                    inherited.name,
                    inherited.primaryNote,
                    inherited.prompt,
                    "inherited-private-generator",
                    master.prompt,
                    "master-private-generator",
                ]) {
                    expect(output).not.toContain(value);
                }
                for (const value of [master.name, master.primaryNote]) {
                    if (notePublic) expect(output).toContain(value);
                    else expect(output).not.toContain(value);
                }
            }
        }
    });

    it("reports foreign properties sharing the managed XMP description", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:hl="https://heroiclands.org/ns/1.0/" xmlns:photoshop="urn:photoshop"><hl:prompt>private</hl:prompt><photoshop:Instructions>foreign-private</photoshop:Instructions></rdf:Description></rdf:RDF></x:xmpmeta>`;
        const input = await sharp(webp).withXmp(packet).webp().toBuffer();
        const output = writeDerivativeProvenance(input, MASTER);
        expect(output.foreignXmp).toBe("discarded");
        expect(output.bytes.includes(Buffer.from("foreign-private"))).toBe(false);
    });

    it("refuses embedded image data and local links without exposing the source", () => {
        const payload = writeProvenance(png, { ...MASTER, prompt: "hidden-image-prompt" }).bytes;
        expect(payload.includes(Buffer.from("hidden-image-prompt"))).toBe(true);
        const embedded = `data:image/png;base64,${payload.toString("base64")}`;
        const sources = [
            embedded,
            "file:///Users/private/art.png",
            "../private/art.png",
            "/Users/private/art.png",
        ];
        for (const source of sources) {
            for (const attribute of ["href", "xlink:href"]) {
                const input = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image ${attribute}="${source}"/></svg>`;
                let error: Error | undefined;
                try {
                    writeDerivativeProvenance(input, MASTER);
                } catch (caught) {
                    error = caught as Error;
                }
                expect(error?.message).toMatch(/SVG.*(resource|reference|image)/i);
                expect(error?.message).not.toContain("private");
                expect(error?.message).not.toContain(payload.toString("base64"));
            }
        }
        for (const source of [
            'url("../private.png")',
            "url(data:image/png;base64,AAAA)",
            "u\\72l(file:///private.png)",
        ]) {
            const input = `<svg xmlns="http://www.w3.org/2000/svg"><rect style='fill:${source}'/></svg>`;
            expect(() => writeDerivativeProvenance(input, MASTER)).toThrow(
                /SVG.*(resource|reference|image)/i,
            );
        }
        for (const css of [
            '@import "../private.css";',
            "rect { fill: url(/**/data:image/png;base64,AAAA) }",
            'rect { fill: u\\72l("file:///private.png") }',
            "rect { fill: url (../private.png) }",
        ]) {
            const input = `<svg xmlns="http://www.w3.org/2000/svg"><style>${css}</style></svg>`;
            expect(() => writeDerivativeProvenance(input, MASTER)).toThrow(/SVG.*resource/i);
        }
        const animated = `<svg xmlns="http://www.w3.org/2000/svg"><image><set attributeName="href" to="file:///private.png"/></image></svg>`;
        expect(() => writeDerivativeProvenance(animated, MASTER)).toThrow(/SVG.*resource/i);
        const aliased = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:link="http://www.w3.org/1999/xlink"><image><set attributeName="link:href" to="data:image/png;base64,AAAA"/></image></svg>`;
        expect(() => writeDerivativeProvenance(aliased, MASTER)).toThrow(/SVG.*resource/i);
        const animatedCss = `<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="fill" to="url(file:///private.png)"/></rect></svg>`;
        expect(() => writeDerivativeProvenance(animatedCss, MASTER)).toThrow(/SVG.*resource/i);
        const base = `<svg xmlns="http://www.w3.org/2000/svg" xml:base="file:///private/"><use href="#shape"/></svg>`;
        expect(() => writeDerivativeProvenance(base, MASTER)).toThrow(/SVG.*resource/i);
        const safe = `<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="r" width="8" height="8"/></defs><use href="#r"/><image href="https://example.test/a.png"/></svg>`;
        const output = writeDerivativeProvenance(safe, MASTER).bytes.toString("utf8");
        expect(output).toContain('href="#r"');
        expect(output).toContain('href="https://example.test/a.png"');
    });

    it("refuses SVG resource user information without echoing it", () => {
        for (const url of [
            "https://user:password@example.test/a",
            "http://user@example.test/a",
            "https://:password@example.test/a",
        ]) {
            for (const element of [
                `<image href="${url}"/>`,
                `<rect style="fill:url('${url}')"/>`,
                `<image><set attributeName="href" to="${url}"/></image>`,
                `<rect><animate attributeName="fill" to="url('${url}')"/></rect>`,
            ]) {
                const svg = `<svg xmlns="http://www.w3.org/2000/svg">${element}</svg>`;
                expect(() => writeDerivativeProvenance(svg, MASTER)).toThrowError(/SVG.*resource/i);
                try {
                    writeDerivativeProvenance(svg, MASTER);
                } catch (error) {
                    expect((error as Error).message).not.toContain(url);
                    expect((error as Error).message).not.toContain("password");
                }
            }
        }
        const safe = `<svg xmlns="http://www.w3.org/2000/svg"><use href="#shape"/><image href="https://example.test/a?size=small&amp;mode=dark"/><image href="http://example.test/b"/></svg>`;
        const output = writeDerivativeProvenance(safe, MASTER).bytes.toString("utf8");
        expect(output).toContain("size=small");
        expect(output).toContain('href="#shape"');
        expect(output).toContain("http://example.test/b");
    });

    it("drops non-rendering text and CSS comments while retaining drawing text and presentation", async () => {
        const input = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">private-root<defs><style>/* private-css */ .a { fill: red; content: "/* quoted */"; } </style></defs><g>private-group<rect class="a" width="20" height="20" mask-type="alpha" transform-box="fill-box" style="fill: red; /* private-inline */ stroke: none"/><text y="12">Visible<tspan> text</tspan></text></g></svg>`;
        const output = writeDerivativeProvenance(input, MASTER).bytes;
        const text = output.toString("utf8");
        for (const secret of ["private-root", "private-group", "private-css", "private-inline"])
            expect(text).not.toContain(secret);
        expect(text).toContain("/* quoted */");
        expect(text).toContain("Visible");
        expect(text).toContain(" text");
        expect(text).toContain('mask-type="alpha"');
        expect(text).toContain('transform-box="fill-box"');
        const safeCss = `<svg xmlns="http://www.w3.org/2000/svg"><style>.a { fill: url(#shape); content: "quote \\\" /* keep */"; }</style><rect class="a"/></svg>`;
        const cssOutput = writeDerivativeProvenance(safeCss, MASTER).bytes.toString("utf8");
        expect(cssOutput).toContain("url(#shape)");
        expect(cssOutput).toContain("/* keep */");
        const unfinished = `<svg xmlns="http://www.w3.org/2000/svg"><style>.a { fill: red; /* private-tail</style><rect class="a"/></svg>`;
        expect(writeDerivativeProvenance(unfinished, MASTER).bytes.toString("utf8")).not.toContain(
            "private-tail",
        );
        const unfinishedString = `<svg xmlns="http://www.w3.org/2000/svg"><style>.a { content: "visible-string</style></svg>`;
        expect(
            writeDerivativeProvenance(unfinishedString, MASTER).bytes.toString("utf8"),
        ).toContain("visible-string");
        expect(await sharp(output).raw().toBuffer()).toEqual(
            await sharp(Buffer.from(input)).raw().toBuffer(),
        );
    });

    it("redacts comment contents without changing CSS token and selector boundaries", async () => {
        const { cleanSvgCss } = await import("../engine/svg-derivative-css.mjs");
        for (const [input, expected] of [
            ["re/*private*/d", "re/**/d"],
            ["1/*private*/px", "1/**/px"],
            ["@/*private*/media", "@/**/media"],
            ["#/*private*/id", "#/**/id"],
            [".a/*private*/.b", ".a/**/.b"],
            [
                'image-set("#shape" 1x type("image/png"))',
                'image-set("#shape" 1x type("image/png"))',
            ],
            ['image-set(var(--x, "#shape") 1x)', 'image-set(var(--x, "#shape") 1x)'],
            ["u/*private*/rl(data:image/png;base64,AAAA)", "u/**/rl(data:image/png;base64,AAAA)"],
        ])
            expect(cleanSvgCss(input)).toBe(expected);
        const input = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><style>.a/* private selector */.b{fill:red}</style><rect class="a b" width="2" height="2"/></svg>`;
        const output = writeDerivativeProvenance(input, MASTER).bytes;
        expect(output.toString("utf8")).not.toContain("private selector");
        expect(await sharp(output).raw().toBuffer()).toEqual(
            await sharp(Buffer.from(input)).raw().toBuffer(),
        );
    });

    it("retains text in links inside a text context and drops non-rendering link text", async () => {
        const input = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><text x="2" y="20"><a href="#target">A</a></text></svg>`;
        const output = writeDerivativeProvenance(input, MASTER).bytes;
        expect(output.toString("utf8")).toContain(">A</a>");
        expect(await sharp(output).raw().toBuffer()).toEqual(
            await sharp(Buffer.from(input)).raw().toBuffer(),
        );
        const other = `<svg xmlns="http://www.w3.org/2000/svg"><a href="#target">private-outside</a><text><g><a href="#target">private-invalid</a></g><a href="#target"><tspan>Visible</tspan></a></text></svg>`;
        const otherOutput = writeDerivativeProvenance(other, MASTER).bytes.toString("utf8");
        expect(otherOutput).not.toContain("private-outside");
        expect(otherOutput).not.toContain("private-invalid");
        expect(otherOutput).toContain(">Visible</tspan>");
    });

    it("reports discarded foreign SVG XMP, including an unrelated metadata element", () => {
        const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:p="urn:private"><p:prompt>hidden-foreign</p:prompt></rdf:Description></rdf:RDF></x:xmpmeta>`;
        const input = `<svg xmlns="http://www.w3.org/2000/svg"><metadata>${packet}</metadata></svg>`;
        const output = writeDerivativeProvenance(input, MASTER);
        expect(output.foreignXmp).toBe("discarded");
        expect(output.bytes.includes(Buffer.from("hidden-foreign"))).toBe(false);
        expect(writeDerivativeProvenance(output.bytes, MASTER).foreignXmp).toBe("none");
        const commentsOnly = `<svg xmlns="http://www.w3.org/2000/svg"><metadata><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><!-- private-xmp-comment --></rdf:RDF></x:xmpmeta></metadata></svg>`;
        const commentsOutput = writeDerivativeProvenance(commentsOnly, MASTER);
        expect(commentsOutput.foreignXmp).toBe("discarded");
        expect(commentsOutput.bytes.toString("utf8")).not.toContain("private-xmp-comment");
    });

    it("removes SVG editor metadata while preserving the rendered drawing", async () => {
        const input = `<?xml version="1.0"?><?inkscape private-editor?>
<!-- private-generator -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/" width="8" height="8" sodipodi:docname="private-path">
<title>private-title</title><desc>private-description</desc><sodipodi:namedview inkscape:label="private-label"/><i:pgf>private-illustrator</i:pgf><!-- private-comment -->
<defs><rect id="shape" width="8" height="8" fill="red"/></defs><use xlink:href="#shape" inkscape:label="private-layer"/></svg>`;
        const output = writeDerivativeProvenance(input, MASTER);
        for (const secret of [
            "private-editor",
            "private-generator",
            "private-path",
            "private-title",
            "private-description",
            "private-label",
            "private-illustrator",
            "private-comment",
            "private-layer",
            "inkscape",
            "sodipodi",
        ]) {
            expect(output.bytes.includes(Buffer.from(secret))).toBe(false);
        }
        expect(await sharp(output.bytes).raw().toBuffer()).toEqual(
            await sharp(Buffer.from(input)).raw().toBuffer(),
        );
    });

    it("expands drawing entities without publishing unused declarations", async () => {
        const input = `<!DOCTYPE svg [<!ENTITY drawingColor "red"><!ENTITY privateDeclaration "private-unused"><!ATTLIST rect height CDATA "8">]>
<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" fill="&drawingColor;"/></svg>`;
        const output = writeDerivativeProvenance(input, MASTER);
        expect(output.bytes.includes(Buffer.from("private-unused"))).toBe(false);
        expect(output.bytes.includes(Buffer.from("DOCTYPE"))).toBe(false);
        expect(await sharp(output.bytes).raw().toBuffer()).toEqual(
            await sharp(Buffer.from(input)).raw().toBuffer(),
        );
    });

    it("accepts internal DTD text and refuses external or parameter entities", () => {
        const svg = (subset: string) =>
            `<!DOCTYPE svg [${subset}]><svg xmlns="http://www.w3.org/2000/svg"/>`;
        expect(() =>
            writeDerivativeProvenance(
                svg(
                    `<!-- SYSTEM PUBLIC %ignored; --> <!ENTITY note "SYSTEM PUBLIC"> <!ENTITY SYSTEM "red">`,
                ),
                MASTER,
            ),
        ).not.toThrow();
        for (const subset of [
            '<!ENTITY external SYSTEM "file:///private">',
            '<!ENTITY é SYSTEM "file:///private">',
            "%é;",
            '<!ENTITY external PUBLIC "identifier" "file:///private">',
            '<!ENTITY % private "value">',
            "%private;",
            '<!ENTITY nested "%private;">',
        ]) {
            expect(() => writeDerivativeProvenance(svg(subset), MASTER)).toThrow(
                /SVG (external|parameter) entit/,
            );
        }
        expect(() =>
            writeDerivativeProvenance('<!DOCTYPE svg SYSTEM "file:///private"><svg/>', MASTER),
        ).toThrow(/external DTD/);
    });

    it("removes nested SVG metadata and foreign XMP while preserving its drawing", async () => {
        const drawing = '<rect width="8" height="8" fill="red"/>';
        const input = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" xmlns:x="adobe:ns:meta/" width="8" height="8"><metadata><s:metadata>private-fixture</s:metadata></metadata><x:xmpmeta>private-fixture</x:xmpmeta>${drawing}</svg>`;
        const output = writeDerivativeProvenance(input, MASTER);
        const text = output.bytes.toString("utf8");
        expect(text).not.toContain("private-fixture");
        expect(text).toContain(drawing);
        expect(readSvgProvenance(output.bytes).record).toEqual(deriveRecord(MASTER));
        expect(await sharp(output.bytes).raw().toBuffer()).toEqual(
            await sharp(Buffer.from(input)).raw().toBuffer(),
        );
        const again = writeDerivativeProvenance(output.bytes, MASTER);
        expect(again.bytes).toEqual(output.bytes);
        expect(again.changed).toBe(false);
    });

    it("writes no private master field into a WebP or an SVG, and leaves pixels alone", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const dirty = writeWebpProvenance(webp, MASTER).bytes;
        const svgDirty = writeSvgProvenance("<svg/>", MASTER).bytes;
        for (const [input, read] of [
            [dirty, (b: Buffer) => readWebpProvenance(b)],
            [svgDirty, (b: Buffer) => readSvgProvenance(b)],
        ] as const) {
            const out = writeDerivativeProvenance(input, MASTER);
            const { packet, xmp } = read(out.bytes);
            expect(Object.keys(xmp).sort()).toEqual(
                ["address", "creator", "derived", "identifier", "rights"].sort(),
            );
            expect(xmp.creator).toBe(MASTER.creator);
            expect(xmp.rights).toBe(MASTER.rights);
            for (const leaked of [
                "hl:prompt",
                "hl:generator",
                "hl:name",
                "hl:primarynote",
                "hl:formerNames",
                "hl:description",
                "hl:role",
                "dc:description",
                "dc:source",
                "DigitalSourceType",
                "drake",
            ]) {
                expect(packet, leaked).not.toContain(leaked);
            }
        }
        const derived = writeDerivativeProvenance(webp, MASTER).bytes;
        const pixels = async (b: Buffer) => (await sharp(b).raw().toBuffer()).toString("base64");
        expect(await pixels(derived)).toBe(await pixels(webp));
        expect(
            checkProvenance([
                { file: "m.png", bytes: writeProvenance(png, MASTER).bytes },
                { file: "d.webp", bytes: derived },
            ]),
        ).toEqual([]);
        expect(() => writeDerivativeProvenance(png, MASTER)).toThrow(/master/);
    });
});

describe("generated derivative authorities", () => {
    const address = "sample-none-image-subject";
    const primaryNote = "sample-note-being-subject";
    const record = { address, creator: "Artist", rights: "Terms", primaryNote };
    const indexFor = (name = "Current name", tags: string[] = [], note = primaryNote) =>
        buildPrimaryNoteIndex([
            {
                type: "being",
                address: { canonical: note },
                name: { full: name },
                namedImages: [address],
                tags,
            },
        ]);
    async function pair(format: string, masterFields = {}, publicFields = {}) {
        const canonical = { ...record, ...masterFields };
        const master = { file: "master.png", bytes: writeProvenance(png, canonical).bytes };
        const rendered = { ...canonical, derivedFrom: address, ...publicFields };
        const bytes =
            format === "jpeg" ?
                await renderPdfMaster(
                    master.bytes,
                    rendered,
                    [{ width: 1, height: 1 }],
                    "screen",
                    true,
                )
            :   writeDerivativeProvenance(
                    format === "webp" ? await sharp(png).webp().toBuffer() : "<svg/>",
                    rendered,
                    {
                        repeat: ["derivedFrom", "name", "primaryNote"],
                        notePublic: true,
                    },
                ).bytes;
        return [master, { file: `derived.${format}`, bytes }];
    }
    for (const format of ["webp", "svg", "jpeg"]) {
        it.each([true, false])(`${format} retains AI status %s`, async (ai) => {
            const [master, derivative] = await pair(format, { ai, digitalSourceType: "none" });
            const read =
                format === "jpeg" ? readJpegProvenance(derivative.bytes)
                : format === "webp" ? readWebpProvenance(derivative.bytes)
                : readSvgProvenance(derivative.bytes);
            expect(read.record.ai).toBe(ai);
            expect(checkProvenance([master, derivative])).toEqual([]);
        });
        it(`${format} validates its parent trace against the master address`, async () => {
            const entries = await pair(format);
            expect(checkProvenance(entries)).toEqual([]);
        });
        it(`${format} validates indexed names while retaining canonical audit findings`, async () => {
            for (const name of [undefined, "Old name", "Current name"]) {
                const entries = await pair(format, { name }, { name: "Current name" });
                const findings = checkProvenance(entries, { index: indexFor() });
                expect(findings.filter((f) => f.file.startsWith("derived."))).toEqual([]);
                expect(findings.filter((f) => f.file === "master.png")).toHaveLength(
                    name === "Old name" ? 1 : 0,
                );
            }
        });
        it(`${format} validates independently optional indexed note fields`, async () => {
            for (const fields of [
                { name: "Current name", primaryNote: undefined },
                { primaryNote, name: undefined },
            ]) {
                const entries = await pair(format, { name: "Old name" }, fields);
                expect(
                    checkProvenance(entries, { index: indexFor() }).filter((f) =>
                        f.file.startsWith("derived."),
                    ),
                ).toEqual([]);
            }
        });
        it(`${format} requires an index for a generated note override`, async () => {
            const entries = await pair(format, { name: "Old name" }, { name: "Current name" });
            expect(
                checkProvenance(entries)
                    .filter((f) => f.file.startsWith("derived."))
                    .map((f) => f.message),
            ).toContainEqual(expect.stringMatching(/hl:name.*index/));
        });
        it(`${format} refuses private, missing and differing indexed note values`, async () => {
            const entries = await pair(format, { name: "Current name" });
            for (const index of [
                indexFor("Current name", ["gm"]),
                buildPrimaryNoteIndex([]),
                indexFor("Other name"),
                indexFor(""),
            ]) {
                expect(
                    checkProvenance(entries, { index }).filter((f) => f.file.startsWith("derived."))
                        .length,
                ).toBeGreaterThan(0);
            }
        });
        it(`${format} accepts an indexed primary-note override and refuses an unrelated note`, async () => {
            const other = "sample-note-being-other";
            const entries = await pair(
                format,
                { name: "Old name" },
                { primaryNote: other, name: "Current name" },
            );
            expect(
                checkProvenance(entries, { index: indexFor("Current name", [], other) }).filter(
                    (f) => f.file.startsWith("derived."),
                ),
            ).toEqual([]);
            expect(
                checkProvenance(entries, { index: indexFor() }).filter((f) =>
                    f.file.startsWith("derived."),
                ).length,
            ).toBeGreaterThan(0);
        });
    }
    it.each(["webp", "svg"])("refuses a %s parent trace pointing elsewhere", async (format) => {
        const entries = await pair(format, {}, { derivedFrom: "sample-none-image-other" });
        expect(
            checkProvenance(entries)
                .filter((f) => f.file.startsWith("derived."))
                .map((f) => f.message),
        ).toContainEqual(expect.stringMatching(/derivedFrom.*master address/));
    });
});

describe("generation declaration selection", () => {
    it.each([
        "an ai study",
        "a DigitalSourceType study",
        "a < b and an ai study",
        "a < ai study",
        "a < DigitalSourceType study",
        `<x value="hl:ai=\"False\" and DigitalSourceType"/>`,
        `<x value='hl:ai="False"'/>`,
        `<!-- <hl:ai>False</hl:ai> -->`,
    ])("ignores prose and quoted non-properties: %s", (text) => {
        expect(readXmpRecord(text)).toEqual({});
    });
    it.each(["<hl:ai>False", "<rdf:Description hl:ai=", "<hl:ai Iptc4xmpExt:DigitalSourceType"])(
        "refuses malformed property attempts: %s",
        (text) => {
            expect(() => readXmpRecord(text)).toThrow();
        },
    );
    it.each([
        `< rdf:Description xmlns:hl="${HL_NAMESPACE}" hl:ai="False"/>`,
        `</rdf:Description xmlns:hl="${HL_NAMESPACE}" hl:ai="False">`,
        `< rdf:Description xmlns:hl="${HL_NAMESPACE}" hl:ai="False" xmlns:i="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" i:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>`,
        `< hl:ai xmlns:hl="${HL_NAMESPACE}">False</hl:ai>`,
        "< ai>",
        `</ DigitalSourceType xmlns:hl="${HL_NAMESPACE}" hl:ai="False">`,
        `< / ñ:ai xmlns:ñ="${HL_NAMESPACE}">`,
        `<rdf:Description hl:ai>`,
        `<rdf:Description hl:ai "False">`,
    ])("refuses malformed opening or closing declarations: %s", (text) => {
        expect(() => readXmpRecord(text)).toThrow();
    });
    it.each(["trainedAlgorithmicMedia", "not a URI", "urn:example:source"])(
        "retains source-only read behavior for %s",
        (value) => {
            const base = writeSvgProvenance("<svg/>", {
                ...FIELDS,
                digitalSourceType: "none",
            }).text;
            const source = `<Iptc4xmpExt:DigitalSourceType>${value}</Iptc4xmpExt:DigitalSourceType>`;
            const single = base.replace("</rdf:Description>", `${source}</rdf:Description>`);
            expect(readSvgProvenance(single).record.digitalSourceType).toBe(value);
            const duplicate = base.replace(
                "</rdf:Description>",
                `${source}${source}</rdf:Description>`,
            );
            expect(readSvgProvenance(duplicate).record.digitalSourceType).toBe(value);
            const withAi = single.replace(
                "</rdf:Description>",
                "<hl:ai>False</hl:ai></rdf:Description>",
            );
            if (!value.startsWith("urn:"))
                expect(() => readSvgProvenance(withAi)).toThrow(/digitalSourceType/);
        },
    );
    it("keeps unrelated namespace ai out of managed classification", () => {
        const base = writeSvgProvenance("<svg/>", { ...FIELDS, digitalSourceType: "none" }).text;
        const data = `<foreign:ai xmlns:foreign="urn:other">False</foreign:ai><Iptc4xmpExt:DigitalSourceType>not a URI</Iptc4xmpExt:DigitalSourceType>`;
        const record = readSvgProvenance(
            base.replace("</rdf:Description>", `${data}</rdf:Description>`),
        ).record;
        expect(record.ai).toBeUndefined();
        expect(record.digitalSourceType).toBe("not a URI");
        const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
        const source = `<Iptc4xmpExt:DigitalSourceType xmlns:r="${rdf}" r:resource="urn:first" rdf:resource="urn:second"/>`;
        const duplicate = base.replace(
            "</rdf:Description>",
            `<foreign:ai xmlns:foreign="urn:other">False</foreign:ai>${source}</rdf:Description>`,
        );
        expect(() => readSvgProvenance(duplicate)).not.toThrow();
    });
    it.each([`<ai xmlns="${HL_NAMESPACE}"/>`, `<ai xmlns="${HL_NAMESPACE}" rdf:resource="True"/>`])(
        "refuses self-closing managed AI declarations: %s",
        (element) => {
            const base = writeSvgProvenance("<svg/>", {
                ...FIELDS,
                digitalSourceType: "digitalCreation",
            }).text;
            const malformed = base.replace("</rdf:Description>", `${element}</rdf:Description>`);
            expect(() => readSvgProvenance(malformed)).toThrow(/ai/);
            expect(() => writeSvgProvenance(malformed, { rights: "Revised" })).toThrow(/ai/);
            expect(checkProvenance([{ file: "master.svg", bytes: malformed }])[0]).toMatchObject({
                file: "master.svg",
                severity: "error",
            });
        },
    );
    it("handles inherited default AI namespaces and unrelated elements", () => {
        const base = writeSvgProvenance("<svg/>", { ...FIELDS, digitalSourceType: "none" }).text;
        const inherited = base
            .replace("<rdf:Description ", `<rdf:Description xmlns="${HL_NAMESPACE}" `)
            .replace("</rdf:Description>", '<ai rdf:resource="True"/></rdf:Description>');
        expect(() => readSvgProvenance(inherited)).toThrow(/ai/);
        const paired = base.replace(
            "</rdf:Description>",
            `<ai xmlns="${HL_NAMESPACE}">True</ai></rdf:Description>`,
        );
        expect(readSvgProvenance(paired).record.ai).toBe(true);
        const other = base.replace(
            "</rdf:Description>",
            `<ai xmlns="urn:other"/></rdf:Description>`,
        );
        expect(readSvgProvenance(other).record.ai).toBeUndefined();
    });
    it("reads a valid declaration", () => {
        const svg = writeSvgProvenance("<svg/>", { ...FIELDS, ai: false });
        expect(readSvgProvenance(svg.text).record.ai).toBe(false);
        const packet = readSvgProvenance(svg.text).packet!;
        const alias = packet.replace(
            "<hl:ai>False</hl:ai>",
            `<ñ:ai xmlns:ñ="${HL_NAMESPACE}">False</ñ:ai>`,
        );
        expect(readXmpRecord(alias).ai).toBe(false);
        const duplicate = packet.replace(
            "<rdf:Description ",
            `<rdf:Description xmlns:ñ="${HL_NAMESPACE}" ñ:ai="True" `,
        );
        expect(() => readXmpRecord(duplicate)).toThrow(/duplicate/);
    });
});

describe("independent AI status", () => {
    it.each([true, false])("round-trips %s without inventing a source type", (ai) => {
        const result = writeProvenance(png, { ...FIELDS, ai, digitalSourceType: "none" });
        expect(readProvenance(result.bytes).record.ai).toBe(ai);
        const svg = writeSvgProvenance("<svg/>", { ...FIELDS, ai });
        expect(readSvgProvenance(svg.text).record.ai).toBe(ai);
        expect(deriveRecord(result.record).ai).toBe(ai);
        expect(readProvenance(result.bytes).record.digitalSourceType).toBeUndefined();
    });

    it("refuses malformed or contradictory declarations", () => {
        expect(() =>
            writeProvenance(png, { ...FIELDS, ai: "false", digitalSourceType: "none" }),
        ).toThrow(/ai/);
        expect(() =>
            writeProvenance(png, {
                ...FIELDS,
                ai: false,
                digitalSourceType: "trainedAlgorithmicMedia",
            }),
        ).toThrow(/conflicts/);
        expect(() =>
            writeSvgProvenance("<svg/>", {
                ...FIELDS,
                ai: true,
                digitalSourceType: "digitalCreation",
            }),
        ).toThrow(/conflicts/);
        const svg = writeSvgProvenance("<svg/>", { ...FIELDS, ai: false }).text;
        expect(() =>
            readSvgProvenance(svg.replace("<hl:ai>False</hl:ai>", "<hl:ai>no</hl:ai>")),
        ).toThrow(/boolean/);
        expect(() =>
            readSvgProvenance(
                svg.replace("<hl:ai>False</hl:ai>", "<hl:ai>False</hl:ai><hl:ai>True</hl:ai>"),
            ),
        ).toThrow(/duplicate/);
        const alias = svg.replace(
            "</rdf:Description>",
            `<p:DigitalSourceType xmlns:p="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</p:DigitalSourceType></rdf:Description>`,
        );
        expect(() => readSvgProvenance(alias)).toThrow(/conflicts/);
    });

    it("refuses namespace-equivalent duplicates and invalid boolean attributes", () => {
        const svg = writeSvgProvenance("<svg/>", { ...FIELDS, ai: false }).text;
        const iptc = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
        const generated = DIGITAL_SOURCE_TRAINED_ALGORITHMIC;
        for (const attrs of [
            `xmlns:p="${HL_NAMESPACE}" p:ai="True" hl:ai="False"`,
            `xmlns:p="${HL_NAMESPACE}" hl:ai="False" p:ai="True"`,
            `xmlns:p="${iptc}" xmlns:q="${iptc}" p:DigitalSourceType="${generated}" q:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation"`,
            `xmlns:p="${iptc}" xmlns:q="${iptc}" q:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation" p:DigitalSourceType="${generated}"`,
        ]) {
            const noElement =
                attrs.includes("p:ai") ? svg.replace("<hl:ai>False</hl:ai>", "") : svg;
            expect(() =>
                readSvgProvenance(
                    noElement.replace("<rdf:Description ", `<rdf:Description ${attrs} `),
                ),
            ).toThrow(/duplicate/);
        }
        expect(() =>
            readSvgProvenance(svg.replace("<rdf:Description ", '<rdf:Description hl:ai="True" ')),
        ).toThrow(/duplicate/);
        expect(() =>
            readSvgProvenance(
                svg.replace("<hl:ai>False</hl:ai>", '<hl:ai rdf:resource="True">False</hl:ai>'),
            ),
        ).toThrow(/boolean/);
        const source = `<p:DigitalSourceType xmlns:p="${iptc}">${generated}</p:DigitalSourceType>`;
        expect(() =>
            readSvgProvenance(
                svg
                    .replace(
                        "<rdf:Description ",
                        `<rdf:Description Iptc4xmpExt:DigitalSourceType="${generated}" `,
                    )
                    .replace("</rdf:Description>", `${source}</rdf:Description>`),
            ),
        ).toThrow(/duplicate/);
    });

    it("reads genuine resource-valued source types and ignores shadowed namespaces", () => {
        const svg = writeSvgProvenance("<svg/>", { ...FIELDS, ai: false }).text;
        const generated = DIGITAL_SOURCE_TRAINED_ALGORITHMIC;
        const resource = `<Iptc4xmpExt:DigitalSourceType rdf:resource="${generated}"/>`;
        expect(() =>
            readSvgProvenance(svg.replace("</rdf:Description>", `${resource}</rdf:Description>`)),
        ).toThrow(/conflicts/);
        const human = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation";
        const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
        for (const attributes of [
            `r:resource="${generated}" rdf:resource="${human}"`,
            `rdf:resource="${human}" r:resource="${generated}"`,
        ]) {
            const ambiguous = svg.replace(
                "</rdf:Description>",
                `<Iptc4xmpExt:DigitalSourceType xmlns:r="${rdf}" ${attributes}/></rdf:Description>`,
            );
            expect(() => readSvgProvenance(ambiguous)).toThrow(/duplicate/);
            expect(() => writeSvgProvenance(ambiguous, { rights: "Revised" })).toThrow(/duplicate/);
            expect(checkProvenance([{ file: "master.svg", bytes: ambiguous }])[0]).toMatchObject({
                file: "master.svg",
                severity: "error",
            });
        }
        const duplicateSourceOnly = svg
            .replace("<hl:ai>False</hl:ai>", "")
            .replace(
                "<rdf:Description ",
                `<rdf:Description xmlns:p="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" p:DigitalSourceType="${generated}" Iptc4xmpExt:DigitalSourceType="${generated}" `,
            );
        expect(() => readSvgProvenance(duplicateSourceOnly)).not.toThrow();
        const duplicateWithAi = duplicateSourceOnly.replace(
            "</rdf:Description>",
            "<hl:ai>False</hl:ai></rdf:Description>",
        );
        expect(() => readSvgProvenance(duplicateWithAi)).toThrow(/duplicate/);
        const badResource = svg.replace(
            "</rdf:Description>",
            `<Iptc4xmpExt:DigitalSourceType rdf:resource="${generated}">http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation</Iptc4xmpExt:DigitalSourceType></rdf:Description>`,
        );
        expect(() => readSvgProvenance(badResource)).toThrow(/conflicting/);
        const valid = svg
            .replace("<hl:ai>False</hl:ai>", "<hl:ai>True</hl:ai>")
            .replace("</rdf:Description>", `${resource}</rdf:Description>`);
        expect(readSvgProvenance(valid).record.digitalSourceType).toBe(generated);
        const shadow = `<Iptc4xmpExt:DigitalSourceType xmlns:Iptc4xmpExt="urn:unrelated">http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation</Iptc4xmpExt:DigitalSourceType>`;
        expect(
            readSvgProvenance(
                svg
                    .replace("<hl:ai>False</hl:ai>", "<hl:ai>True</hl:ai>")
                    .replace("</rdf:Description>", `${shadow}</rdf:Description>`),
            ).record.digitalSourceType,
        ).toBeUndefined();
    });

    it("refuses generation facts in later WebP packets on read, audit and rewrite", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const first = writeWebpProvenance(webp, { ...FIELDS, ai: false, derived: true });
        const packet = readWebpProvenance(first.bytes).packet!;
        const append = (text: string) => {
            const data = Buffer.from(text);
            const header = Buffer.alloc(8);
            header.write("XMP ");
            header.writeUInt32LE(data.length, 4);
            const out = Buffer.concat([first.bytes, header, data, Buffer.alloc(data.length % 2)]);
            out.writeUInt32LE(out.length - 8, 4);
            return out;
        };
        for (const extra of [
            packet.replace("<hl:ai>False</hl:ai>", "<hl:ai>True</hl:ai>"),
            packet.replace(
                "<hl:ai>False</hl:ai>",
                `<Iptc4xmpExt:DigitalSourceType rdf:resource="${DIGITAL_SOURCE_TRAINED_ALGORITHMIC}"/>`,
            ),
        ]) {
            const bad = append(extra);
            expect(() => readWebpProvenance(bad)).toThrow();
            expect(() => writeWebpProvenance(bad, { rights: "Revised" })).toThrow();
            expect(() => writeDerivativeProvenance(bad, { ...FIELDS, ai: false })).toThrow();
            expect(checkProvenance([{ file: "derived.webp", bytes: bad }])[0]).toMatchObject({
                file: "derived.webp",
                severity: "error",
            });
        }
        const unrelated = append(packet.replace("<hl:ai>False</hl:ai>", ""));
        expect(readWebpProvenance(unrelated).record.ai).toBe(false);
        expect(writeWebpProvenance(unrelated, { rights: "Revised" }).record.ai).toBe(false);
    });

    it("refuses AI declarations across multiple PNG packets", () => {
        const out = writeProvenance(png, { ...FIELDS, ai: false, digitalSourceType: "none" });
        const packet = readProvenance(out.bytes).packet!;
        const duplicate = withChunks(out.bytes, [makeTextChunk(XMP_KEYWORD, packet).raw]);
        expect(() => readProvenance(duplicate)).toThrow(/multiple XMP packets/);
    });

    it.each(["algorithmicMedia", "http://cv.iptc.org/newscodes/digitalsourcetype/syntheticMedia"])(
        "does not infer AI from %s",
        (digitalSourceType) => {
            const result = writeSvgProvenance("<svg/>", {
                ...FIELDS,
                ai: false,
                digitalSourceType,
            });
            expect(readSvgProvenance(result.text).record.ai).toBe(false);
            const withoutAi = writeSvgProvenance("<svg/>", { ...FIELDS, digitalSourceType });
            expect(deriveRecord(withoutAi.record).ai).toBeUndefined();
        },
    );

    it("preserves and clears the value through WebP", async () => {
        const webp = await sharp(png).webp().toBuffer();
        const written = writeWebpProvenance(webp, { ...FIELDS, ai: false });
        expect(readWebpProvenance(written.bytes).record.ai).toBe(false);
        expect(
            readWebpProvenance(writeWebpProvenance(written.bytes, { ai: null }).bytes).record.ai,
        ).toBeUndefined();
    });
});
