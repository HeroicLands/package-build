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
    const fetcher = async (_url: string, init: any) => {
        options = init;
        return response("proof");
    };
    expect(await fetchPinnedAttachment(url, spec, fetcher)).toEqual(bytes);
    expect(options.redirect).toBe("error");
    expect(options.credentials).toBe("omit");
    for (const bad of [
        "http://git.pupluppy.org/attachments/12345678-1234-1234-1234-123456789abc",
        "https://evil.test/attachments/12345678-1234-1234-1234-123456789abc",
        url + "?redirect=x",
        "https://git.pupluppy.org/other/12345678-1234-1234-1234-123456789abc",
    ])
        await expect(fetchPinnedAttachment(bad, spec, fetcher)).rejects.toThrow(/URL/);
    await expect(fetchPinnedAttachment(url, { ...spec, max: 4 }, fetcher)).rejects.toThrow(/limit/);
    await expect(
        fetchPinnedAttachment(url, { ...spec, sha256: "0".repeat(64) }, fetcher),
    ).rejects.toThrow(/checksum/);
    await expect(
        fetchPinnedAttachment(url, spec, async () => response("", { status: 302 })),
    ).rejects.toThrow(/response/);
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
