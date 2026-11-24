/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    assertArchiveIndexes,
    assertDerivativeRights,
    clearOutputs,
    releaseArchives,
    releaseDigest,
    releaseIndex,
} from "../ci/consumer-art-release-proof.mjs";
import { archiveFetch } from "../ci/consumer-art-release-network.mjs";

const tag = "v1.2.3";
const root = "https://github.com/HeroicLands/art-thalorna/releases";
const release = {
    id: 17,
    tag_name: tag,
    draft: false,
    published_at: "2026-01-01T00:00:00Z",
    html_url: `${root}/tag/${tag}`,
};
function assets(parts = 1) {
    return Array.from({ length: parts }, (_, i) => {
        const name = `thalorna-originals-1.2.3${parts === 1 ? "" : `-part${i + 1}`}.zip`;
        return [name, `${name}.sha256`].map((name, j) => ({
            id: i * 2 + j + 1,
            name,
            state: "uploaded",
            size: j ? 100 : 2048,
            digest: `sha256:${String(i * 2 + j + 1).padStart(64, "0")}`,
            browser_download_url: `${root}/download/${tag}/${name}`,
        }));
    }).flat();
}

it("pins every native digest in the complete single and multipart release sets", () => {
    expect(releaseArchives(release, assets(), tag)[0]).toMatchObject({
        name: "thalorna-originals-1.2.3.zip",
        sha256: "1".padStart(64, "0"),
        checksum: { sha256: "2".padStart(64, "0") },
    });
    expect(releaseArchives(release, assets(3).reverse(), tag).map((a: any) => a.name)).toEqual(
        [1, 2, 3].map((n) => `thalorna-originals-1.2.3-part${n}.zip`),
    );
});

it.each([
    ["draft", { draft: true }],
    ["unpublished", { published_at: null }],
    ["wrong tag", { tag_name: "v1.2.4" }],
    ["other repository", { html_url: "https://github.com/Other/art/releases/tag/v1.2.3" }],
])("refuses a %s release", (_, patch) => {
    expect(() => releaseArchives({ ...release, ...(patch as object) }, assets(), tag)).toThrow();
});

it.each([
    ["absent digest", { digest: null }],
    ["malformed digest", { digest: `sha512:${"a".repeat(64)}` }],
    ["incomplete upload", { state: "new" }],
    ["oversized ZIP", { size: 2_000_000_001 }],
    [
        "signed URL",
        {
            browser_download_url: `${root}/download/${tag}/thalorna-originals-1.2.3.zip?token=private`,
        },
    ],
    [
        "other tag URL",
        { browser_download_url: `${root}/download/v1.2.4/thalorna-originals-1.2.3.zip` },
    ],
])("refuses %s instead of deriving replacement release facts", (_, patch) => {
    const list = assets();
    Object.assign(list[0], patch);
    expect(() => releaseArchives(release, list, tag)).toThrow();
});

it("refuses incomplete, duplicate, nonsequential and mixed attachment sets", () => {
    const list = assets(2);
    for (const wrong of [
        list.slice(1),
        [list[0], list[0], ...list.slice(2)],
        [...assets(), ...list],
        [list[2], list[3]],
    ])
        expect(() => releaseArchives(release, wrong, tag)).toThrow();
    const repeatedId = assets();
    repeatedId[1].id = repeatedId[0].id;
    expect(() => releaseArchives(release, repeatedId, tag)).toThrow();
    const hugeSidecar = assets();
    hugeSidecar[1].size = 1025;
    expect(() => releaseArchives(release, hugeSidecar, tag)).toThrow();
});

function indexAssets(name = "artthalorna-metadata.jsonl", first = 100) {
    return [name, `${name}.sha256`].map((name, j) => ({
        id: first + j,
        name,
        state: "uploaded",
        size: j ? 100 : 4096,
        digest: `sha256:${String(first + j).padStart(64, "0")}`,
        browser_download_url: `${root}/download/${tag}/${name}`,
    }));
}

it("accepts one metadata index and its checksum beside the archives without pinning it as one", () => {
    const list = [...indexAssets(), ...assets(2)];
    expect(releaseArchives(release, list, tag)).toEqual(releaseArchives(release, assets(2), tag));
    expect(releaseIndex(release, list, tag)).toEqual({
        id: 100,
        name: "artthalorna-metadata.jsonl",
        url: `${root}/download/${tag}/artthalorna-metadata.jsonl`,
        sha256: "100".padStart(64, "0"),
        bytes: 4096,
        checksum: {
            id: 101,
            name: "artthalorna-metadata.jsonl.sha256",
            url: `${root}/download/${tag}/artthalorna-metadata.jsonl.sha256`,
            sha256: "101".padStart(64, "0"),
            bytes: 100,
        },
    });
    expect(releaseIndex(release, assets(2), tag)).toBeNull();
});

it.each([
    [
        "an index without its checksum",
        () => [indexAssets()[0], ...assets()],
        /index has no checksum/,
    ],
    [
        "a checksum without its index",
        () => [indexAssets()[1], ...assets()],
        /checksum has no metadata index/,
    ],
    [
        "two indexes",
        () => [...indexAssets(), ...indexAssets("thalorna-metadata.jsonl", 200), ...assets()],
        /one metadata index/,
    ],
    [
        "an index named outside the pattern",
        () => [...indexAssets("Art-Thalorna-metadata.jsonl"), ...assets()],
        /^Art-Thalorna-metadata\.jsonl: a metadata index is named/,
    ],
    [
        "an index with a hyphen in its package prefix",
        () => [...indexAssets("art-thalorna-metadata.jsonl"), ...assets()],
        /^art-thalorna-metadata\.jsonl: a metadata index is named/,
    ],
    [
        "an index with a dot in its package prefix",
        () => [...indexAssets("art.thalorna-metadata.jsonl"), ...assets()],
        /^art\.thalorna-metadata\.jsonl: a metadata index is named/,
    ],
    [
        "an oversized index",
        () => {
            const list = indexAssets();
            list[0].size = 64 * 1024 ** 2 + 1;
            return [...list, ...assets()];
        },
        /^artthalorna-metadata\.jsonl: metadata index exceeds its limit/,
    ],
    [
        "an extra ZIP beside the index",
        () => [...indexAssets(), ...assets(2), ...indexAssets("extra.zip", 200)],
        /^extra\.zip: release part is mixed or nonsequential/,
    ],
    [
        "an extra ZIP checksum beside the index",
        () => [...indexAssets(), ...assets(), ...indexAssets("extra.zip", 200).slice(1)],
        /^extra\.zip\.sha256: checksum has no ZIP/,
    ],
    [
        "an index without a package prefix",
        () => [...indexAssets("metadata.jsonl"), ...assets()],
        /^metadata\.jsonl: a metadata index is named/,
    ],
    [
        "another extra asset beside the index",
        () => [...indexAssets(), ...indexAssets("notes.txt", 200).slice(0, 1), ...assets()],
        /^notes\.txt: release asset is not a ZIP/,
    ],
    [
        "another extra asset without an index",
        () => [...indexAssets("notes.txt").slice(0, 1), ...assets()],
        /^notes\.txt: release asset is not a ZIP/,
    ],
    [
        "an oversized index checksum",
        () => {
            const list = indexAssets();
            list[1].size = 1025;
            return [...list, ...assets()];
        },
        /artthalorna-metadata\.jsonl\.sha256: checksum sidecar exceeds its limit/,
    ],
    ["an index with no archives", () => indexAssets(), /exactly ZIP\/checksum pairs/],
])("refuses %s", (_, build, message) => {
    expect(() => releaseArchives(release, build(), tag)).toThrow(message);
    expect(() => releaseIndex(release, build(), tag)).toThrow(message);
});

it("keeps the 32-pair archive limit when a release carries a metadata index", () => {
    expect(releaseArchives(release, [...indexAssets(), ...assets(32)], tag)).toHaveLength(32);
    expect(() => releaseArchives(release, [...indexAssets(), ...assets(33)], tag)).toThrow();
    expect(() => releaseArchives(release, assets(33), tag)).toThrow(
        /exceeds 32 ZIP\/checksum pairs/,
    );
});

it("checks derivative rights against the released master for each address", () => {
    const rights = new Map([
        ["thalorna-none-image-first", "First rights statement"],
        ["thalorna-none-image-second", "Second rights statement"],
        ["thalorna-none-image-unspecified", undefined],
    ]);
    expect(() =>
        assertDerivativeRights(rights, "thalorna-none-image-first", "First rights statement"),
    ).not.toThrow();
    expect(() =>
        assertDerivativeRights(rights, "thalorna-none-image-unspecified", undefined),
    ).not.toThrow();
    expect(() => assertDerivativeRights(rights, "thalorna-none-image-first", undefined)).toThrow(
        /rights/,
    );
    expect(() =>
        assertDerivativeRights(rights, "thalorna-none-image-first", "Second rights statement"),
    ).toThrow(/rights/);
    expect(() => assertDerivativeRights(rights, "thalorna-none-image-absent", undefined)).toThrow(
        /master/,
    );
});

it("observes the real cold fetch and refuses warm archive requests before delegating", async () => {
    const url = assets()[0].browser_download_url;
    const fetch = vi.fn(async () => "real transport result");
    const record = vi.fn();
    const options = { redirect: "manual" };
    expect(await archiveFetch(fetch, [url], "cold", record)(url, options)).toBe(
        "real transport result",
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, options);
    expect(record).toHaveBeenCalledExactlyOnceWith(url);
    fetch.mockClear();
    record.mockClear();
    await expect(archiveFetch(fetch, [url], "warm", record)(new URL(url), options)).rejects.toThrow(
        "warm artwork cache",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledExactlyOnceWith(url);
    await expect(
        archiveFetch(fetch, [url], "warm", record)("https://example.invalid/dependency", options),
    ).resolves.toBe("real transport result");
});

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("removes all generated and derivative caches while retaining materialized dependencies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-proof-"));
    roots.push(root);
    for (const relative of [
        "build/stage/image.jpg",
        "build/content-index/metadata.jsonl",
        "build/.cache/art/image.jpg",
        "build/cache/note-page/value",
        "build/cache/foreign/input",
        "build/cache/metadata/input",
        "build/cache/navigation/input",
        "assets/source.png",
    ]) {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "original bytes");
    }
    clearOutputs(root);
    expect(fs.readdirSync(path.join(root, "build"))).toEqual(["cache"]);
    expect(fs.readdirSync(path.join(root, "build/cache")).sort()).toEqual([
        "foreign",
        "metadata",
        "navigation",
    ]);
    expect(fs.readFileSync(path.join(root, "assets/source.png"), "utf8")).toBe("original bytes");
});

it("wires exact real-release inputs and retains its receipt without publishing consumer content", () => {
    const workflow = fs.readFileSync(
        new URL("../.gitea/workflows/consumer-proof.yml", import.meta.url),
        "utf8",
    );
    expect(workflow).toContain("thalorna-art-release");
    expect(workflow).toContain("ART_RELEASE_TAG: ${{ github.event.inputs.art_release_tag }}");
    expect(workflow).toContain("CONSUMER_SHA: ${{ github.event.inputs.consumer_sha }}");
    expect(workflow).toContain("path: ${{ runner.temp }}/consumer-proof/art-release-evidence/");
    const shell = fs.readFileSync(new URL("../ci/consumer-proof.sh", import.meta.url), "utf8");
    expect(shell).toContain('node "$root/ci/consumer-art-release-proof.mjs"');
    expect(shell).toContain('guard="$PWD/ci/consumer-lock-guard.mjs"');
});

it("pins native release identity and bytes independently of a movable tag", () => {
    const selected = releaseArchives(release, assets(), tag);
    const digest = releaseDigest(release, selected);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(releaseDigest({ ...release, id: 18 }, selected)).not.toBe(digest);
    expect(
        releaseDigest(
            release,
            selected.map((part) => ({ ...part, sha256: "f".repeat(64) })),
        ),
    ).not.toBe(digest);
    expect(releaseDigest(release, releaseArchives(release, assets().reverse(), tag))).toBe(digest);
    expect(releaseDigest(release, selected, null)).toBe(digest);
    const list = [...assets(), ...indexAssets()];
    const index = releaseIndex(release, list, tag);
    const indexed = releaseDigest(release, releaseArchives(release, list, tag), index);
    expect(indexed).not.toBe(digest);
    expect(releaseDigest(release, selected, { ...index, sha256: "f".repeat(64) })).not.toBe(
        indexed,
    );
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const indexText = '{"id":"a"}\n';
const released = { name: "art-metadata.jsonl", bytes: indexText.length, sha256: sha(indexText) };
const member = (name = released.name, text = indexText) => ({
    name,
    bytes: text.length,
    sha256: sha(text),
});
const inventory = (...extra: ReturnType<typeof member>[]) => [
    { name: "README.md", bytes: 1, sha256: sha("r") },
    { name: "artwork/a.png", bytes: 1, sha256: sha("p") },
    ...extra,
];
const part = (name: string, extra: ReturnType<typeof member>[] = [], text = indexText) => ({
    name,
    inventory: inventory(...extra),
    ...(extra.length ? { metadataIndex: Buffer.from(text) } : {}),
});

it("accepts archive parts that all carry the released index and archives with none", () => {
    expect(() =>
        assertArchiveIndexes([part("p1", [member()]), part("p2", [member()])], released),
    ).not.toThrow();
    expect(() => assertArchiveIndexes([part("p1"), part("p2")], released)).not.toThrow();
    expect(() => assertArchiveIndexes([part("p1"), part("p2")], null)).not.toThrow();
});

it("refuses an archive index that differs from, or is absent from, the release", () => {
    expect(() =>
        assertArchiveIndexes([part("p1", [member(released.name, '{"id":"b"}\n')])], released),
    ).toThrow(/p1: archive metadata index differs from the release asset/);
    expect(() =>
        assertArchiveIndexes([part("p1", [member(released.name, "{}\n")])], released),
    ).toThrow(/size differs/);
    expect(() => assertArchiveIndexes([part("p1", [member()])], null)).toThrow(
        /the release has no metadata index asset/,
    );
    expect(() =>
        assertArchiveIndexes([part("p1", [member("other-metadata.jsonl")])], released),
    ).toThrow(/not named like the release asset/);
    expect(() => assertArchiveIndexes([part("p1", [member()]), part("p2")], released)).toThrow(
        /p2: the metadata index is missing from this archive part/,
    );
    expect(() =>
        assertArchiveIndexes([part("p1", [member(), member("two-metadata.jsonl")])], released),
    ).toThrow(/carries one metadata index/);
    expect(() =>
        assertArchiveIndexes(
            [{ ...part("p1", [member()]), metadataIndex: Buffer.from('{"id":"z"}\n') }],
            released,
        ),
    ).toThrow(/the reader returned differs/);
    expect(() =>
        assertArchiveIndexes([{ name: "p1", inventory: inventory(member()) }], released),
    ).toThrow(/reader and the member inventory disagree/);
    expect(() =>
        assertArchiveIndexes([{ ...part("p1"), metadataIndex: Buffer.from(indexText) }], null),
    ).toThrow(/reader and the member inventory disagree/);
});
