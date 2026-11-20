/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import fs from "node:fs";
import {
    digest,
    fetchPinnedAttachment,
    inspectMap,
    inputs,
    mapping,
} from "../ci/real-map-adapter-probe.mjs";

const url = "https://git.pupluppy.org/attachments/12345678-1234-1234-1234-123456789abc";
const response = (body: string, options: any = {}) => new Response(body, options);

it("accepts only bounded same-forge attachments with their pinned bytes", async () => {
    const bytes = Buffer.from("proof");
    const spec = { sha256: digest(bytes), max: 5 };
    let options: any;
    let calls = 0;
    const fetcher = async (_url: string, init: any) => {
        calls++;
        options = init;
        const result = response("proof");
        expect(result.headers.get("content-length")).toBeNull();
        return result;
    };
    expect(await fetchPinnedAttachment(url, spec, "test-token", fetcher)).toEqual(bytes);
    expect(options.headers).toEqual({ Authorization: "token test-token" });
    expect(options.redirect).toBe("error");
    expect(options.credentials).toBe("omit");
    for (const bad of [
        "http://git.pupluppy.org/attachments/12345678-1234-1234-1234-123456789abc",
        "https://evil.test/attachments/12345678-1234-1234-1234-123456789abc",
        url + "?redirect=x",
        "https://git.pupluppy.org/other/12345678-1234-1234-1234-123456789abc",
    ])
        await expect(fetchPinnedAttachment(bad, spec, "test-token", fetcher)).rejects.toThrow(
            /URL/,
        );
    expect(calls).toBe(1);
    await expect(fetchPinnedAttachment(url, spec, "", fetcher)).rejects.toThrow(/token/);
    expect(calls).toBe(1);
    await expect(
        fetchPinnedAttachment(url, { ...spec, max: 4 }, "test-token", fetcher),
    ).rejects.toThrow(/limit/);
    await expect(
        fetchPinnedAttachment(url, { ...spec, sha256: "0".repeat(64) }, "test-token", fetcher),
    ).rejects.toThrow(/checksum/);
    await expect(
        fetchPinnedAttachment(url, spec, "test-token", async () => response("", { status: 302 })),
    ).rejects.toThrow(/response/);
    await expect(
        fetchPinnedAttachment(url, spec, "test-token", async () => {
            throw new Error("test-token");
        }),
    ).rejects.toThrow(/^attachment request failed$/);
});

it("refuses incomplete attachment bodies without exposing stream errors", async () => {
    const spec = { sha256: digest(Buffer.from("proof")), max: 5 };
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (pulls++ === 0) controller.enqueue(Buffer.from("pro"));
                else controller.error(new Error("test-token"));
            },
        },
        { highWaterMark: 0 },
    );
    await expect(
        fetchPinnedAttachment(url, spec, "test-token", async () => new Response(stream)),
    ).rejects.toThrow(/^attachment stream failed or exceeds byte limit$/);
    expect(pulls).toBe(2);
    await expect(
        fetchPinnedAttachment(url, spec, "test-token", async () =>
            response("proof", { headers: { "content-length": "4" } }),
        ),
    ).rejects.toThrow(/^attachment length mismatch$/);
    await expect(
        fetchPinnedAttachment(url, spec, "test-token", async () => response("")),
    ).rejects.toThrow(/^attachment checksum mismatch$/);
});

it("retains the approved mapping and reports adapter acceptance and refusal without modifying inputs", () => {
    expect(mapping).toEqual({
        state: { id: 3, address: "thalorna-note-affiliation-kngdmmrdd" },
        cultures: { "6": "thalorna-note-lore-dunhariclt" },
    });
    const map = Buffer.from("map"),
        json = Buffer.from("json");
    const accepted = inspectMap(map, json, (args: any) => {
        expect(args.mapping).toEqual(mapping);
        return {
            state: { i: 3 },
            cells: [
                {
                    id: 10,
                    gridId: 20,
                    state: { i: 3 },
                    culture: { i: 6 },
                    cultureAddress: mapping.cultures["6"],
                    burg: null,
                    burgCultureId: null,
                    burgCultureAddress: null,
                },
            ],
        };
    });
    expect(accepted.unchanged).toBe(true);
    expect(accepted.findings).toEqual([]);
    expect(accepted.selected.cells[0]).toMatchObject({
        id: 10,
        gridId: 20,
        stateId: 3,
        cultureId: 6,
    });
    const refused = inspectMap(map, json, () => {
        throw new Error("invalid map");
    });
    expect(refused.findings).toEqual(["invalid map"]);
    expect(refused.selected).toBeNull();
    expect(refused.unchanged).toBe(true);
    const mutated = inspectMap(Buffer.from("map"), json, ({ map: input }: any) => {
        input[0] = 0;
        throw new Error("mutation");
    });
    expect(mutated.unchanged).toBe(false);
    const actual = inspectMap(map, json);
    expect(actual.findings[0]).toContain("hash differs from the pin");
    expect(actual.unchanged).toBe(true);
    expect(inputs.map.sha256).toHaveLength(64);
    expect(fs.readFileSync("ci/.npmignore", "utf8")).toMatch(/^real-map-adapter-probe\.mjs$/m);
});
