/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeId } from "../engine/ids.mjs";
import {
    verifyPopulationIndex,
    verifyPopulationSurfaces,
} from "../ci/consumer-proof-populations.mjs";

describe("consumer population index proof", () => {
    const raw = [
        {
            address: { canonical: "demo-note-place-harbor" },
            data: { population: { actual: 1200, apparent: 800 } },
        },
        {
            address: { canonical: "demo-note-affiliation-council" },
            data: {
                population: { actual: "50" },
                territorial_population: { actual: 4000, apparent: null },
                settlements: [{ population: { actual: 100, apparent: 0 } }],
            },
        },
    ];
    const projected = [
        {
            address: { canonical: "demo-note-place-harbor" },
            data: { population: { actual: null, apparent: 800 } },
        },
        {
            address: { canonical: "demo-note-affiliation-council" },
            data: {
                population: { actual: 50, apparent: 50 },
                territorial_population: { actual: null, apparent: null },
                settlements: [{ population: { actual: null, apparent: 0 } }],
            },
        },
    ];
    const addresses = ["demo-note-place-harbor", "demo-note-affiliation-council"];
    it("checks every requested note, including inline and territorial counts", () => {
        expect(verifyPopulationIndex(raw, projected, addresses)).toEqual({
            subjects: 2,
            figures: 4,
            differing: 3,
        });
    });
    it("checks selected public pages and Foundry documents against private entries", () => {
        const source = [raw[0]];
        const address = addresses[0];
        const surfaces = {
            indexDocuments: [{ address, text: "Harbor population 800" }],
            sites: [{ address, text: "Harbor population 800" }],
            publicDocuments: [{ address, text: "Harbor population 800" }],
            privateDocuments: [{ address, text: "Harbor actual 1,200 apparent 800" }],
        };
        expect(verifyPopulationSurfaces(source, [address], surfaces)).toEqual({
            subjects: 1,
            hiddenFigures: 1,
        });
        expect(() =>
            verifyPopulationSurfaces(source, [address], {
                ...surfaces,
                sites: [{ address, text: "Harbor has 1,200 people" }],
            }),
        ).toThrow(/public/);
        expect(() =>
            verifyPopulationSurfaces(source, [address], {
                ...surfaces,
                privateDocuments: [{ address, text: "Harbor unknown" }],
            }),
        ).toThrow(/private/);
    });
    it("refuses hidden actual figures and missing or ambiguous records", () => {
        const leaked = structuredClone(projected);
        leaked[0].data.population.actual = 1200;
        expect(() => verifyPopulationIndex(raw, leaked, addresses)).toThrow(/projection/);
        expect(() => verifyPopulationIndex(raw, projected.slice(1), addresses)).toThrow(
            /exactly one/,
        );
        expect(() => verifyPopulationIndex([...raw, raw[0]], projected, addresses)).toThrow(
            /exactly one/,
        );
    });
});

it("prepares and verifies an isolated mixed proof tree", () => {
    const scratch = process.env.TMPDIR || process.env.RUNNER_TEMP;
    if (!scratch) throw new Error("Population proof tests require TMPDIR or RUNNER_TEMP");
    const root = fs.mkdtempSync(path.join(scratch, "population-proof-"));
    const proof = path.join(root, "proof");
    const put = (name: string, text: string) => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };
    try {
        fs.mkdirSync(path.join(proof, "population-evidence"), { recursive: true });
        const address = "thalorna-note-place-harbor";
        put(
            "assets/content/Harbor.md",
            "---\ntype: place\nshortcode: harbor\nname: {full: Harbor}\ndata: {population: {actual: 1200, apparent: 800}}\n---\nBody.\n",
        );
        put(
            "assets/content/Other.md",
            "---\ntype: place\nshortcode: other\ndata: {population: 40}\n---\nBody.\n",
        );
        put("package-lock.json", "candidate lock");
        fs.writeFileSync(path.join(proof, "original-lock.json"), "original lock");
        fs.writeFileSync(path.join(proof, "candidate.tgz"), "candidate archive");
        const archiveSha256 = createHash("sha256").update("candidate archive").digest("hex");
        fs.writeFileSync(
            path.join(proof, "installed-archive.json"),
            JSON.stringify({ archiveSha256, verified: true }),
        );
        put(
            "package-build.config.yaml",
            "packs:\n  - {name: journals, type: JournalEntry}\n  - {name: private, type: JournalEntry, private: true}\n",
        );
        const env = {
            ...process.env,
            CANDIDATE_SHA: "a".repeat(40),
            CONSUMER_SHA: "b".repeat(40),
            POPULATION_PROOF_ADDRESSES: JSON.stringify([address]),
        };
        const script = fileURLToPath(
            new URL("../ci/consumer-proof-populations.mjs", import.meta.url),
        );
        const run = (mode: string) =>
            spawnSync(process.execPath, [script, mode, proof], {
                cwd: root,
                env,
                encoding: "utf8",
            });
        const prepared = run("prepare");
        expect(prepared.status, prepared.stderr).toBe(0);
        expect(fs.readFileSync(path.join(root, "assets/content/Other.md"), "utf8")).toContain(
            "{actual: 40}",
        );
        put(
            "build/content-index/thalorna-metadata.jsonl",
            JSON.stringify({
                address: { canonical: address },
                data: { population: { actual: null, apparent: 800 } },
            }) + "\n",
        );
        put("build/site/thalorna/place-harbor/index.html", "Harbor population 800");
        put(
            "build/packs-json/journals/harbor.json",
            JSON.stringify({ name: "Harbor", pages: ["population 800"] }),
        );
        put(
            "build/packs-json/private/harbor.json",
            JSON.stringify({
                _id: makeId("population-supplement", address),
                name: "Population: Harbor",
                pages: ["actual 1,200 apparent 800"],
            }),
        );
        const verified = run("verify");
        expect(verified.status, verified.stderr).toBe(0);
        const receipt = JSON.parse(
            fs.readFileSync(path.join(proof, "population-evidence/receipt.json"), "utf8"),
        );
        expect(receipt).toMatchObject({ subjects: 1, figures: 1, differing: 1, hiddenFigures: 1 });
        put("build/site/thalorna/place-harbor/index.html", "Harbor population 1200");
        expect(run("verify").status).not.toBe(0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
