/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import sharp from "sharp";
import { renderArtMasters } from "../engine/art-master-render.mjs";
import { resamplePdfImages } from "../engine/pdf-images.mjs";
import { collectArtMasters } from "../engine/art-masters.mjs";
import {
    readWebpProvenance,
    readSvgProvenance,
    readJpegProvenance,
    writeProvenance,
    writeSvgProvenance,
} from "../engine/art-provenance.mjs";
import { cachedArtRender } from "../engine/art-render-cache.mjs";
import { pathToFileURL } from "node:url";

const roots: string[] = [];
const directory = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "art-cache-"));
    roots.push(root);
    return root;
};
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("requires an explicit absolute cache directory", async () => {
    for (const cache of [undefined, "", "relative/cache"]) {
        await expect(renderArtMasters(new Map(), [], directory(), cache as string)).rejects.toThrow(
            "absolute cache directory",
        );
        await expect(
            resamplePdfImages(new Map(), directory(), "screen", cache as string),
        ).rejects.toThrow("absolute cache directory");
    }
});

it("changes renderer identity when the SVG sanitizer changes", async () => {
    fs.mkdirSync("build", { recursive: true });
    const root = fs.mkdtempSync(path.resolve("build/cache-identity-"));
    roots.push(root);
    const identities = [];
    for (const variant of ["first", "second"]) {
        const snapshot = path.join(root, variant);
        fs.mkdirSync(snapshot);
        for (const name of [
            "art-render-cache.mjs",
            "art-provenance.mjs",
            "art-provenance-core.mjs",
            "svg-derivative-css.mjs",
            "art-master-render.mjs",
        ]) {
            fs.copyFileSync(path.resolve("engine", name), path.join(snapshot, name));
        }
        if (variant === "second")
            fs.appendFileSync(path.join(snapshot, "svg-derivative-css.mjs"), "\n// Variant.\n");
        const module = await import(
            pathToFileURL(path.join(snapshot, "art-render-cache.mjs")).href
        );
        identities.push(
            module.artRendererIdentity(
                pathToFileURL(path.join(snapshot, "art-master-render.mjs")).href,
            ),
        );
    }
    expect(identities[0]).not.toBe(identities[1]);
});

it("reuses complete renders and invalidates source, settings and public metadata", async () => {
    const root = directory();
    let renders = 0;
    const render = async () => Buffer.from(`render ${++renders}`);
    const source = Buffer.from("master");
    const descriptor = { format: "webp", settings: { quality: 80 }, metadata: { name: "Public" } };
    const first = await cachedArtRender(source, descriptor, root, render);
    expect(await cachedArtRender(source, descriptor, root, render)).toEqual(first);
    expect(renders).toBe(1);
    expect(
        await cachedArtRender(
            source,
            { metadata: descriptor.metadata, settings: descriptor.settings, format: "webp" },
            root,
            render,
        ),
    ).toEqual(first);
    await cachedArtRender(Buffer.from("different master"), descriptor, root, render);
    await cachedArtRender(source, { ...descriptor, settings: { quality: 81 } }, root, render);
    await cachedArtRender(source, { ...descriptor, metadata: { name: "Changed" } }, root, render);
    expect(renders).toBe(4);
});

it("regenerates empty, truncated, corrupt and misplaced entries", async () => {
    const root = directory();
    let renders = 0;
    const render = async () => {
        renders++;
        return Buffer.from("public bytes");
    };
    const source = Buffer.from("master");
    const first = await cachedArtRender(source, { edition: "screen" }, root, render);
    const file = path.join(root, fs.readdirSync(root)[0]);
    const valid = fs.readFileSync(file);
    for (const bytes of [
        Buffer.alloc(0),
        valid.subarray(0, 5),
        Buffer.from(valid).fill(0, valid.length - 2),
    ]) {
        fs.writeFileSync(file, bytes);
        expect(await cachedArtRender(source, { edition: "screen" }, root, render)).toEqual(first);
    }
    await cachedArtRender(source, { edition: "print" }, root, render);
    const other = fs.readdirSync(root).find((name) => name !== path.basename(file))!;
    fs.copyFileSync(path.join(root, other), file);
    expect(await cachedArtRender(source, { edition: "screen" }, root, render)).toEqual(first);
    expect(renders).toBe(6);
    fs.rmSync(root, { recursive: true });
    expect(await cachedArtRender(source, { edition: "screen" }, root, render)).toEqual(first);
    expect(renders).toBe(7);
});

it("shares concurrent work and leaves no partial entries after a failed render", async () => {
    const root = directory();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
        release = resolve;
    });
    let renders = 0;
    const render = async () => {
        renders++;
        await ready;
        return Buffer.from("public");
    };
    const jobs = Array.from({ length: 5 }, () =>
        cachedArtRender(Buffer.from("master"), { format: "svg" }, root, render),
    );
    release();
    expect(await Promise.all(jobs)).toEqual(Array.from({ length: 5 }, () => Buffer.from("public")));
    expect(renders).toBe(1);
    expect(fs.readdirSync(root)).toHaveLength(1);
    await expect(
        cachedArtRender(Buffer.from("other"), {}, root, async () => {
            throw new Error("render failed");
        }),
    ).rejects.toThrow("render failed");
    expect(fs.readdirSync(root)).toHaveLength(1);
    expect(
        await cachedArtRender(Buffer.from("other"), {}, root, async () => Buffer.from("retry")),
    ).toEqual(Buffer.from("retry"));
});

it.each(["png", "svg"])(
    "cached %s renders follow public note metadata and preserve master bytes",
    async (format) => {
        const root = directory();
        const privateRoot = path.join(root, "private");
        fs.mkdirSync(privateRoot);
        const record = {
            address: "sample-none-image-portrait",
            primaryNote: "sample-note-being-subject",
            name: "Private identity",
            prompt: "Private prompt",
            creator: "Artist",
            rights: "Rights",
        };
        const raw =
            format === "png" ?
                await sharp({
                    create: { width: 100, height: 100, channels: 3, background: "white" },
                })
                    .png()
                    .toBuffer()
            :   '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
        const bytes =
            format === "png" ?
                writeProvenance(raw, record).bytes
            :   writeSvgProvenance(raw, record).bytes;
        const source = path.join(privateRoot, `source.${format}`);
        fs.writeFileSync(source, bytes);
        const masters = collectArtMasters([privateRoot], "sample").masters;
        const out = path.join(root, "build/art");
        const cache = path.join(root, "build/.cache/art");
        const notes = [
            {
                type: "being",
                address: { canonical: record.primaryNote },
                name: { full: "Public identity" },
                tags: [] as string[],
            },
        ];
        const run = async () =>
            fs.readFileSync(
                (await renderArtMasters(masters, notes, out, cache)).get(record.address)!,
            );
        const read = format === "png" ? readWebpProvenance : readSvgProvenance;
        const publicBytes = await run();
        expect(read(publicBytes).record.name).toBe("Public identity");
        expect(await run()).toEqual(publicBytes);
        expect(fs.readdirSync(cache)).toHaveLength(1);
        notes[0].tags = ["gm"];
        const privateBytes = await run();
        expect(read(privateBytes).record).not.toHaveProperty("name");
        expect(read(privateBytes).record).not.toHaveProperty("primaryNote");
        expect(privateBytes.includes(Buffer.from("Private prompt"))).toBe(false);
        expect(fs.readdirSync(cache)).toHaveLength(2);
        notes[0].tags = [];
        notes[0].name.full = "Changed identity";
        const changed = await run();
        expect(read(changed).record.name).toBe("Changed identity");
        expect(fs.readdirSync(cache)).toHaveLength(3);
        fs.rmSync(cache, { recursive: true });
        expect(await run()).toEqual(changed);
        expect(fs.readFileSync(source)).toEqual(bytes);
        const retained = fs.readFileSync(path.join(cache, fs.readdirSync(cache)[0]));
        expect(retained.includes(Buffer.from("Private prompt"))).toBe(false);
        fs.rmSync(cache, { recursive: true });
        fs.symlinkSync(privateRoot, cache);
        await expect(run()).rejects.toThrow("overlaps output");
        expect(fs.readFileSync(source)).toEqual(bytes);
    },
);

it("book cache separates profiles, placements and public metadata", async () => {
    const root = directory();
    const source = path.join(root, "private.png");
    const record = {
        address: "sample-none-image-portrait",
        primaryNote: "sample-note-being-subject",
        name: "Subject",
        creator: "Artist",
        rights: "Rights",
        prompt: "private",
    };
    const bytes = writeProvenance(
        await sharp({ create: { width: 600, height: 400, channels: 3, background: "white" } })
            .png()
            .toBuffer(),
        record,
    ).bytes;
    fs.writeFileSync(source, bytes);
    const out = path.join(root, "exports");
    const cache = path.join(root, "build/.cache/art");
    const candidate = {
        from: source,
        to: "images/portrait.jpg",
        relative: "images/portrait.webp",
        file: "note.md",
        uses: [{ width: 2, height: 2 }],
        master: { file: source, record, notePublic: false },
    };
    const candidates = new Map<string, any>([[record.address, candidate]]);
    const run = async (edition: "screen" | "print") => {
        await resamplePdfImages(candidates, out, edition, cache);
        return fs.readFileSync(path.join(out, candidate.to));
    };
    const screen = await run("screen");
    expect(fs.existsSync(path.join(root, ".cache"))).toBe(false);
    expect(await run("screen")).toEqual(screen);
    expect(fs.readdirSync(cache)).toHaveLength(1);
    expect((await sharp(screen).metadata()).width).toBe(300);
    const print = await run("print");
    expect((await sharp(print).metadata()).width).toBe(600);
    expect(fs.readdirSync(cache)).toHaveLength(2);
    candidate.uses = [{ width: 1, height: 1 }];
    expect((await sharp(await run("screen")).metadata()).width).toBe(150);
    expect(fs.readdirSync(cache)).toHaveLength(3);
    candidate.master.notePublic = true;
    const publicBytes = await run("screen");
    expect(readJpegProvenance(publicBytes).record.name).toBe("Subject");
    expect(fs.readdirSync(cache)).toHaveLength(4);
    fs.rmSync(cache, { recursive: true });
    expect(await run("screen")).toEqual(publicBytes);
    expect(fs.readFileSync(source)).toEqual(bytes);
});
