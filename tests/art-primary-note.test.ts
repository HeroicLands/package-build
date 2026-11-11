import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import {
    XMP_KEYWORD,
    checkProvenance,
    makeTextChunk,
    readChunks,
    readTextChunk,
    readProvenance,
    readSvgProvenance,
    readWebpChunks,
    readWebpProvenance,
    sniffFormat,
    writeDerivativeProvenance,
    writeProvenance,
    writeSvgProvenance,
    writeWebpProvenance,
} from "../engine/art-provenance.mjs";
import { buildPrimaryNoteIndex, resolvePrimaryNote } from "../engine/art-primary-note.mjs";

const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n';

const note = (type: string, shortcode: string, full?: string, named: string[] = []) => ({
    type,
    shortcode,
    ...(full === undefined ? {} : { name: { full } }),
    address: { canonical: `thalorna-note-${type}-${shortcode}` },
    ...(named.length ? { namedImages: named } : {}),
});
const IMG = (shortcode: string, type = "image") => `thalorna-none-${type}-${shortcode}`;

const index = buildPrimaryNoteIndex([
    note("being", "akirashuyu", "Akira Shūyu — “the Ægir”", [IMG("portrait")]),
    note("being", "nameless", undefined, [IMG("faceless")]),
    note("being", "twina", "Twin A", [IMG("shared")]),
    note("being", "twinb", "Twin B", [IMG("shared")]),
    note("affiliation", "guild", "Guild of <Smiths> & Co", [IMG("emblem")]),
    note("place", "harbor", "Harbor", [
        IMG("view"),
        IMG("harbor", "icon"),
        IMG("banner"),
        IMG("portrait"),
    ]),
]);

const RAW = { width: 8, height: 8, channels: 3 as const };
const PIXELS = Buffer.alloc(8 * 8 * 3, 9);

type Format = {
    label: string;
    input: () => Buffer | string;
    write: (input: any, fields: Record<string, unknown>, options?: { index?: object }) => any;
    read: (bytes: Buffer) => Record<string, string | undefined>;
};

let png: Buffer;
let lossy: Buffer;
let lossless: Buffer;
let animated: Buffer;
beforeAll(async () => {
    png = await sharp(PIXELS, { raw: RAW }).png().toBuffer();
    lossy = await sharp(PIXELS, { raw: RAW }).webp().toBuffer();
    lossless = await sharp(PIXELS, { raw: RAW }).webp({ lossless: true }).toBuffer();
    animated = await sharp(
        Buffer.concat([Buffer.alloc(8 * 8 * 3, 9), Buffer.alloc(8 * 8 * 3, 200)]),
        {
            raw: { width: 8, height: 16, channels: 3, pageHeight: 8 },
        },
    )
        .webp({ loop: 0, delay: [100, 100] })
        .toBuffer();
});

const FORMATS: Format[] = [
    {
        label: "PNG",
        input: () => png,
        write: writeProvenance,
        read: (bytes) => readProvenance(bytes).xmp,
    },
    {
        label: "SVG",
        input: () => SVG,
        write: writeSvgProvenance,
        read: (bytes) => readSvgProvenance(bytes).xmp,
    },
    {
        label: "WebP (lossy)",
        input: () => lossy,
        write: writeWebpProvenance,
        read: (bytes) => readWebpProvenance(bytes).xmp,
    },
    {
        label: "WebP (lossless)",
        input: () => lossless,
        write: writeWebpProvenance,
        read: (bytes) => readWebpProvenance(bytes).xmp,
    },
    {
        label: "WebP (animated)",
        input: () => animated,
        write: writeWebpProvenance,
        read: (bytes) => readWebpProvenance(bytes).xmp,
    },
];

describe("resolvePrimaryNote", () => {
    it("names the single being or affiliation, ignoring other types", () => {
        expect(resolvePrimaryNote(index, IMG("portrait"))).toEqual({
            note: {
                address: "thalorna-note-being-akirashuyu",
                type: "being",
                name: "Akira Shūyu — “the Ægir”",
            },
        });
        expect(resolvePrimaryNote(index, IMG("emblem"))).toMatchObject({
            note: { type: "affiliation" },
        });
    });
    it("reports several, none, and other types only", () => {
        expect(resolvePrimaryNote(index, IMG("shared"))).toEqual({
            reason: "several-notes",
            notes: ["thalorna-note-being-twina", "thalorna-note-being-twinb"],
        });
        expect(resolvePrimaryNote(index, IMG("orphan"))).toEqual({ reason: "no-note" });
        expect(resolvePrimaryNote(index, IMG("view"))).toEqual({
            reason: "not-being-or-affiliation",
        });
        expect(resolvePrimaryNote(index, IMG("banner"))).toEqual({
            reason: "not-being-or-affiliation",
        });
    });
});

describe.each(FORMATS)("$label provenance", ({ label, input, write, read }) => {
    // A WebP is always a derivative.
    const MARK = label.startsWith("WebP") ? { derived: true } : {};
    const WITH = (address: string, i = index) => write(input(), { address, ...MARK }, { index: i });
    // A WebP is a derivative and carries no note fields of its own, so the
    // check runs on a PNG master holding the record the WebP was written with.
    const check = (bytes: Buffer, i: object | undefined = index) => {
        let subject = bytes;
        if (label.startsWith("WebP")) {
            subject = masterWithPacket(readWebpProvenance(bytes).packet!);
        }
        return checkProvenance([{ file: "a", bytes: subject }], i ? { index: i } : {});
    };

    it("fills both fields for a portrait and reads them back byte-exact", () => {
        const out = WITH(IMG("portrait"));
        const xmp = read(out.bytes);
        expect(xmp.name).toBe("Akira Shūyu — “the Ægir”");
        expect(xmp.primaryNote).toBe("thalorna-note-being-akirashuyu");
        expect(check(out.bytes)).toEqual([]);
    });
    it("fills an affiliation emblem and escapes its name", () => {
        const xmp = read(WITH(IMG("emblem")).bytes);
        expect(xmp.name).toBe("Guild of <Smiths> & Co");
        expect(xmp.primaryNote).toBe("thalorna-note-affiliation-guild");
    });
    it("derives nothing for a place image, icon or banner", () => {
        for (const [shortcode, type] of [
            ["view", "image"],
            ["harbor", "icon"],
            ["banner", "image"],
        ]) {
            const xmp = read(WITH(IMG(shortcode, type)).bytes);
            expect("name" in xmp || "primaryNote" in xmp).toBe(false);
        }
    });
    it("derives nothing for an image named by two beings and reports why", () => {
        const out = WITH(IMG("shared"));
        expect(read(out.bytes).name).toBeUndefined();
        expect(out.primary).toMatchObject({ reason: "several-notes" });
    });
    it("writes a being with no name.full as hl:primarynote alone", () => {
        const out = WITH(IMG("faceless"));
        const xmp = read(out.bytes);
        expect(xmp.primaryNote).toBe("thalorna-note-being-nameless");
        expect(xmp.name).toBeUndefined();
        expect(check(out.bytes)).toEqual([]);
    });
    it("takes a renamed note's name on the next write and reports a stale one", () => {
        const first = WITH(IMG("portrait"));
        const renamed = buildPrimaryNoteIndex([
            note("being", "akirashuyu", "Akira Shuyu", [IMG("portrait")]),
        ]);
        const stale = check(first.bytes, renamed);
        expect(stale).toHaveLength(1);
        expect(stale[0].message).toContain("hl:name");
        const second = write(first.bytes, { address: IMG("portrait") }, { index: renamed });
        expect(read(second.bytes).name).toBe("Akira Shuyu");
        expect(check(second.bytes, renamed)).toEqual([]);
    });
    it("writes only hl:name for a banner given only a name, and keeps it on rewrite", () => {
        const first = write(input(), { ...MARK, address: IMG("banner"), name: "Harbour Dawn" });
        expect(read(first.bytes)).toMatchObject({ name: "Harbour Dawn" });
        expect(read(first.bytes).primaryNote).toBeUndefined();
        const again = write(first.bytes, { kind: "banner" }, { index });
        expect(read(again.bytes).name).toBe("Harbour Dawn");
        expect(check(again.bytes)).toEqual([]);
    });
    it("reads back only hl:primarynote for a note-only file, kept on rewrite", () => {
        const first = write(input(), {
            ...MARK,
            address: IMG("view"),
            primaryNote: "thalorna-note-place-harbor",
        });
        const again = write(first.bytes, { kind: "view" }, { index });
        expect(read(again.bytes).primaryNote).toBe("thalorna-note-place-harbor");
        expect(read(again.bytes).name).toBeUndefined();
        expect(check(again.bytes)).toEqual([]);
    });
    it("carries neither field for an icon with neither", () => {
        const out = WITH(IMG("harbor", "icon"));
        const xmp = read(out.bytes);
        expect("name" in xmp || "primaryNote" in xmp).toBe(false);
        expect(check(out.bytes)).toEqual([]);
    });
    it("reports a malformed and an unknown hl:primarynote, and never a lone name", () => {
        const set = write(input(), {
            ...MARK,
            address: IMG("view"),
            primaryNote: "thalorna-note-place-harbor",
        });
        const patch = (value: string) =>
            replaceInPacket(set.bytes, "thalorna-note-place-harbor", value);
        expect(check(patch("thalorna-note-place-nowhere"))[0].message).toContain("names no note");
        expect(check(patch("harbor"))[0].message).toContain("malformed hl:primarynote");
        const lone = write(input(), { ...MARK, address: IMG("view"), name: "Anything" });
        expect(check(lone.bytes)).toEqual([]);
    });
    it("reports an hl:primarynote that differs from the being the image resolves to", () => {
        const out = write(input(), {
            ...MARK,
            address: IMG("portrait"),
            primaryNote: "thalorna-note-being-twina",
        });
        const findings = check(out.bytes);
        expect(findings.map((f) => f.message).join("\n")).toContain("differs from");
        expect(findings[0]).toMatchObject({ file: "a", line: 1, column: 1 });
    });
    it("writes the same bytes when rewritten with the same record", () => {
        const first = WITH(IMG("portrait"));
        expect(write(first.bytes, { address: IMG("portrait") }, { index }).changed).toBe(false);
    });
});

/** Replace text inside a file's XMP packet, rebuilding the chunk that holds it. */
/** A PNG master whose XMP packet is the given one without `hl:derived`. */
function masterWithPacket(packet: string): Buffer {
    const chunks = readChunks(png);
    const at = chunks.findIndex((chunk) => chunk.type === "IDAT");
    const text = packet.replace("<hl:derived>true</hl:derived>", "");
    return Buffer.concat([
        png.subarray(0, 8),
        ...chunks.slice(0, at).map((chunk) => chunk.raw),
        makeTextChunk(XMP_KEYWORD, text).raw,
        ...chunks.slice(at).map((chunk) => chunk.raw),
    ]);
}

function replaceInPacket(bytes: Buffer, from: string, to: string): Buffer {
    const format = sniffFormat(bytes);
    if (format === "svg") return Buffer.from(bytes.toString("utf8").replace(from, to));
    if (format === "webp") {
        const { packet } = readWebpProvenance(bytes);
        const next = Buffer.from(packet!.replace(from, to), "utf8");
        const { chunks } = readWebpChunks(bytes);
        const parts = chunks.map((chunk) => {
            if (chunk.type !== "XMP ") return chunk.raw;
            const header = Buffer.alloc(8);
            header.write("XMP ", 0, "latin1");
            header.writeUInt32LE(next.length, 4);
            return Buffer.concat([header, next, Buffer.alloc(next.length % 2)]);
        });
        const size = Buffer.alloc(4);
        size.writeUInt32LE(4 + parts.reduce((n, part) => n + part.length, 0));
        return Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), ...parts]);
    }
    const chunks = readChunks(bytes);
    const at = chunks.findIndex((chunk) => readTextChunk(chunk)?.keyword === XMP_KEYWORD);
    const text = readTextChunk(chunks[at])!.text.replace(from, to);
    chunks[at] = makeTextChunk(XMP_KEYWORD, text);
    return Buffer.concat([bytes.subarray(0, 8), ...chunks.map((chunk) => chunk.raw)]);
}

describe("WebP container", () => {
    it.each([
        ["lossy", () => lossy, ["VP8 "]],
        ["lossless", () => lossless, ["VP8L"]],
        ["animated", () => animated, ["ANIM", "ANMF"]],
    ])("keeps every image chunk of a %s file byte for byte", (_label, input, kinds) => {
        const before = readWebpChunks(input());
        const out = writeWebpProvenance(input(), { address: IMG("portrait") }, { index });
        const after = readWebpChunks(out.bytes);
        const image = (list: typeof before.chunks) =>
            list
                .filter((chunk) => !["VP8X", "XMP "].includes(chunk.type))
                .map((chunk) => chunk.raw);
        expect(image(after.chunks)).toEqual(image(before.chunks));
        for (const kind of kinds) expect(after.chunks.some((c) => c.type === kind)).toBe(true);
        expect(after.chunks[0].type).toBe("VP8X");
        expect(after.chunks[0].data[0] & 0x04).toBe(0x04);
        expect(out.bytes.readUInt32LE(4)).toBe(out.bytes.length - 8);
        expect(out.bytes.length % 2).toBe(0);
    });
    it("is decoded by an image library after the write, at the same size", async () => {
        for (const input of [lossy, lossless, animated]) {
            const out = writeWebpProvenance(input, { address: IMG("portrait") }, { index });
            const meta = await sharp(out.bytes).metadata();
            const was = await sharp(input).metadata();
            expect([meta.width, meta.height, meta.pages]).toEqual([
                was.width,
                was.height,
                was.pages,
            ]);
        }
    });
    it("sets the canvas size of a plain file in the VP8X header", () => {
        const out = writeWebpProvenance(lossless, { address: IMG("portrait") });
        const header = readWebpChunks(out.bytes).chunks[0].data;
        expect([header.readUIntLE(4, 3) + 1, header.readUIntLE(7, 3) + 1]).toEqual([8, 8]);
    });
    it("is sniffed by its signature, whatever the file is called", () => {
        expect(sniffFormat(lossy)).toBe("webp");
        const out = writeDerivativeProvenance(lossy, { address: IMG("portrait") });
        const master = writeProvenance(png, { address: IMG("portrait") }, { index });
        expect(
            checkProvenance(
                [
                    { file: "looks-like.svg", bytes: out.bytes },
                    { file: "m.png", bytes: master.bytes },
                ],
                { index },
            ),
        ).toEqual([]);
        expect(
            checkProvenance([{ file: "bare.webp", bytes: lossy }], { index })[0].message,
        ).toContain("XMP packet is missing");
    });
    it("refuses a file that is not a WebP", () => {
        expect(() => writeWebpProvenance(png, { address: IMG("portrait") })).toThrow(/not a WebP/);
    });
});

/*
 * The real path: notes and pictures on disk, indexed by the ordinary content
 * index, then resolved and written with the source tree gone.
 */
describe("from an indexed tree", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "primary-note-"));
    const meta = "attribution: Someone\nlicense: CC-BY-4.0\nai: false\n";
    const front = (type: string, shortcode: string, name: string, data = "") =>
        `---\nname:\n  full: ${name}\nshortcode: ${shortcode}\ntype: ${type}\n${data}---\n\n`;
    let records: any[];
    let idx: ReturnType<typeof buildPrimaryNoteIndex>;

    beforeAll(() => {
        const files: Record<string, string> = {
            "assets/images/provenance.yaml": meta,
            "assets/icons/provenance.yaml": meta,
            "assets/images/people/portrait.png": "p",
            "assets/images/people/inline.png": "i",
            "assets/images/people/emblem.png": "e",
            "assets/images/people/both.png": "b",
            "assets/images/places/view.png": "v",
            "assets/images/creatures/wolf.png": "w",
            "assets/icons/harbor.svg": "<svg/>",
            "content/Akira.md":
                front("being", "akirashuyu", "Akira Shūyu") + "![[image-portrait|Portrait]]\n",
            "content/Ines.md":
                front("being", "ines", "Inés") +
                "![Inline](images/people/inline.png)\n![[image-both|Both]]\n",
            "content/Guild.md":
                front("affiliation", "guild", "The Guild", "data:\n  icon: image-emblem\n") +
                "Body.\n",
            "content/Wolf.md":
                front("being", "wolf", "Grey Wolf", "subType: creature\n") +
                "![[image-wolf|Wolf]]\n",
            "content/Rhea.md": front("being", "rhea", "Rhea") + "![[image-both|Both]]\n",
            "content/Harbor.md":
                front("place", "harbor", "Harbor", "data:\n  icon: harbor\n") +
                "![[image-view|View]]\n![[image-portrait|Portrait]]\n",
        };
        for (const [file, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
            fs.writeFileSync(path.join(tmp, file), text);
        }
        records = collectContentIndex(path.join(tmp, "content"), {
            contentPackage: "thalorna",
            rootDir: tmp,
            languages: ["en"],
            skipDirectories: [],
            assetsBase: path.join(tmp, "assets"),
            manifest: {},
        });
        idx = buildPrimaryNoteIndex(records);
        fs.rmSync(tmp, { recursive: true, force: true });
    });
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const assetAddress = (file: string) => {
        const found = records.find((record) => record.asset?.path?.endsWith(file));
        return `${found.address.canonical.package}-${found.address.canonical.system}-${found.address.canonical.type}-${found.address.canonical.shortcode}`;
    };

    const text = (value: any) =>
        `${value.package}-${value.system}-${value.type}-${value.shortcode}`;

    it("records the images each note names on the note's index record", () => {
        const named = (shortcode: string) =>
            records.find((record) => record.shortcode === shortcode)?.namedImages.map(text);
        expect(named("akirashuyu")).toEqual([assetAddress("portrait.png")]);
        expect(named("ines")).toEqual(
            [assetAddress("both.png"), assetAddress("inline.png")].sort(),
        );
        expect(named("guild")).toEqual([assetAddress("emblem.png")]);
    });

    it("publishes each named image as an Address object and resolves from the published index", () => {
        const lines = serializeContentIndex(records)
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        const akira = lines.find((line) => line.shortcode === "akirashuyu");
        expect(akira.namedImages).toEqual([
            { address: assetAddress("portrait.png"), anchor: null, anchorKind: null },
        ]);
        expect(
            resolvePrimaryNote(buildPrimaryNoteIndex(lines), assetAddress("portrait.png")),
        ).toMatchObject({ note: { name: "Akira Shūyu", type: "being" } });
    });

    it("resolves from the index alone, with the source tree gone", () => {
        const read = vi.spyOn(fs, "readFileSync");
        const dir = vi.spyOn(fs, "readdirSync");
        try {
            expect(fs.existsSync(tmp)).toBe(false);
            expect(resolvePrimaryNote(idx, assetAddress("portrait.png"))).toMatchObject({
                note: { address: "thalorna-sohl-being-akirashuyu", name: "Akira Shūyu" },
            });
            expect(resolvePrimaryNote(idx, assetAddress("emblem.png"))).toMatchObject({
                note: { type: "affiliation", name: "The Guild" },
            });
            expect(resolvePrimaryNote(idx, assetAddress("inline.png"))).toMatchObject({
                note: { address: "thalorna-sohl-being-ines", name: "Inés" },
            });
            expect(resolvePrimaryNote(idx, assetAddress("both.png"))).toMatchObject({
                reason: "several-notes",
            });
            expect(resolvePrimaryNote(idx, assetAddress("view.png"))).toEqual({
                reason: "not-being-or-affiliation",
            });
            expect(read).not.toHaveBeenCalled();
            expect(dir).not.toHaveBeenCalled();
        } finally {
            read.mockRestore();
            dir.mockRestore();
        }
    });

    it("derives both fields for an image a creature (a being of subType creature) names", () => {
        const address = assetAddress("wolf.png");
        const wolf = records.find((record) => record.shortcode === "wolf");
        expect(JSON.stringify(wolf)).toContain("creature");
        expect(resolvePrimaryNote(idx, address)).toMatchObject({
            note: { type: "being", name: "Grey Wolf" },
        });
        for (const [bytes, write, read] of [
            [png, writeProvenance, (b: Buffer) => readProvenance(b).xmp],
            [lossy, writeWebpProvenance, (b: Buffer) => readWebpProvenance(b).xmp],
        ] as const) {
            const out = (write as any)(
                bytes,
                { address, ...(write === writeWebpProvenance ? { derived: true } : {}) },
                { index: idx },
            );
            expect(read(out.bytes)).toMatchObject({
                name: "Grey Wolf",
                primaryNote: "thalorna-sohl-being-wolf",
            });
        }
    });

    it("writes the indexed note's name and Address into each format", () => {
        const address = assetAddress("portrait.png");
        for (const [bytes, write, read] of [
            [png, writeProvenance, (b: Buffer) => readProvenance(b).xmp],
            [SVG, writeSvgProvenance, (b: Buffer) => readSvgProvenance(b).xmp],
            [lossy, writeWebpProvenance, (b: Buffer) => readWebpProvenance(b).xmp],
        ] as const) {
            const out = (write as any)(
                bytes,
                { address, ...(write === writeWebpProvenance ? { derived: true } : {}) },
                { index: idx },
            );
            expect(read(out.bytes)).toMatchObject({
                name: "Akira Shūyu",
                primaryNote: "thalorna-sohl-being-akirashuyu",
            });
            const subject =
                write === writeWebpProvenance ?
                    masterWithPacket(readWebpProvenance(out.bytes).packet!)
                :   out.bytes;
            expect(checkProvenance([{ file: "x", bytes: subject }], { index: idx })).toEqual([]);
        }
    });
});
