/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    assertDerivativeRights,
    clearOutputs,
    releaseArchives,
    releaseDigest,
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
});
