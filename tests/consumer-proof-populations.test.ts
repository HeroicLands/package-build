/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeId } from "../engine/ids.mjs";
import { infoboxesToHtml } from "../engine/infobox-render.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { createPackRouter } from "../engine/pack-router.mjs";
import { indexRecordsForNote, serializeContentIndex } from "../engine/content-index.mjs";
import { flattenPublishedAddresses } from "../engine/address-values.mjs";
import { projectPopulationFrontmatter } from "../engine/population-values.mjs";
import {
    resolvePopulationSubject,
    selectSiteFile,
    verifyPopulationIndex,
    verifyPopulationSurfaces,
} from "../ci/consumer-proof-populations.mjs";

const address = "thalorna-sohl-affiliation-council";
const placeAddress = "thalorna-note-place-harbor";
const polity = {
    type: "affiliation",
    subType: "polity",
    shortcode: "council",
    name: { full: "Council" },
    sohl: {},
    data: {
        population: { actual: 160, apparent: 0 },
        territorial_population: { actual: 160, apparent: null },
        settlements: [
            { settlement: "Farm", population: { actual: 160, apparent: 20 } },
            { settlement: "Dock", population: { actual: 90 } },
        ],
    },
};
const place = {
    type: "place",
    subType: "settlement",
    shortcode: "harbor",
    name: { full: "Harbor" },
    data: { population: { actual: 1200, apparent: 800 } },
};
const packs = [
    { name: "items", type: "Item", system: "sohl", default: true },
    { name: "journals", type: "JournalEntry", default: true },
    { name: "private", type: "JournalEntry", private: true },
];
function produced(fm: any) {
    const manifest = {
        contentPackage: "thalorna",
        foundryPackageId: "thalorna",
        packRouter: createPackRouter(packs),
        docEntryTypes: new Set(["affiliation"]),
    };
    const records = indexRecordsForNote({
        frontmatter: projectPopulationFrontmatter(fm),
        body: "Visible prose.",
        relPath: `${fm.shortcode}.md`,
        contentPackage: "thalorna",
        manifest,
    });
    return serializeContentIndex(records)
        .trim()
        .split("\n")
        .map((line: string) => flattenPublishedAddresses(JSON.parse(line)));
}
const raw = [
    { ...polity, address: { canonical: address } },
    { ...place, address: { canonical: placeAddress } },
];
const publicPolity =
    '<dl class="infobox-rows"><dt>Population</dt><dd>0</dd></dl><table><tr><th>Settlement</th><th>Population</th></tr><tr><td>Farm</td><td>20</td></tr><tr><td>Dock</td><td>90</td></tr></table><style>.x { width: 160px }</style><p id=\"a160b\">There are 160 miles of road. Population records are at <a href=\"/160\">160</a>.</p>';
const privatePolity =
    "<table><tr><th>Population</th><th>Actual</th><th>Apparent</th></tr><tr><td>Membership</td><td>160</td><td>0</td></tr><tr><td>Territorial population</td><td>160</td><td>Unknown</td></tr><tr><td>Farm</td><td>160</td><td>20</td></tr></table>";
const publicPlace = '<dl class="infobox-rows"><dt>Population</dt><dd>800</dd></dl>';
const privatePlace =
    "<table><tr><th>Population</th><th>Actual</th><th>Apparent</th></tr><tr><td>Population</td><td>1,200</td><td>800</td></tr></table>";
const surfaces = () => ({
    sites: [
        { address, text: publicPolity },
        { address: placeAddress, text: publicPlace },
    ],
    publicDocuments: [
        { address, text: publicPolity },
        { address: placeAddress, text: publicPlace },
    ],
    privateDocuments: [
        { address, text: privatePolity },
        { address: placeAddress, text: privatePlace },
    ],
});

describe("consumer population proof", () => {
    it("uses the producer's SoHL record and lean documentation relation", () => {
        const records = produced(polity);
        const resolved = resolvePopulationSubject(records, address);
        expect(resolved.subjectAddress).toBe(address);
        expect(resolved.subject.data.population).toEqual({ actual: null, apparent: 0 });
        expect(resolved.journal.data).toBeUndefined();
        expect(resolved.uuid).toMatch(/^Compendium\.thalorna\.journals\.JournalEntry\./);
        expect(verifyPopulationIndex(raw.slice(0, 1), records, [address])).toEqual({
            subjects: 1,
            figures: 4,
            differing: 3,
        });
    });
    it("checks an unknown actual and a stated apparent figure", () => {
        const hidden = {
            type: "place",
            address: { canonical: placeAddress },
            data: { population: { actual: null, apparent: 10 } },
        };
        const output = {
            sites: [
                {
                    address: placeAddress,
                    text: '<dl class="infobox-rows"><dt>Population</dt><dd>10</dd></dl>',
                },
            ],
            publicDocuments: [
                {
                    address: placeAddress,
                    text: '<dl class="infobox-rows"><dt>Population</dt><dd>10</dd></dl>',
                },
            ],
            privateDocuments: [
                {
                    address: placeAddress,
                    text: "<table><tr><th>Population</th><th>Actual</th><th>Apparent</th></tr><tr><td>Population</td><td>Unknown</td><td>10</td></tr></table>",
                },
            ],
        };
        expect(verifyPopulationSurfaces([hidden], [placeAddress], output)).toEqual({
            subjects: 1,
            hiddenFigures: 1,
        });
        output.privateDocuments[0].text = output.privateDocuments[0].text.replace(
            "<td>Unknown</td>",
            "",
        );
        expect(() => verifyPopulationSurfaces([hidden], [placeAddress], output)).toThrow();
    });
    it("uses the published site URL before the ordinary slug", () => {
        const selected = selectSiteFile(
            [
                "build/site/thalorna/section/index.html",
                "build/site/thalorna/place-harbor/index.html",
            ],
            { siteURL: "/thalorna/section/", address: { slug: "place-harbor" } },
            {},
            placeAddress,
        );
        expect(selected).toBe("build/site/thalorna/section/index.html");
    });
    it("checks each field and inline row, including repeated actual and zero or unknown apparent", () => {
        expect(verifyPopulationSurfaces(raw, [address, placeAddress], surfaces())).toEqual({
            subjects: 2,
            hiddenFigures: 4,
        });
        const missing = surfaces();
        missing.privateDocuments[0].text = privatePolity.replace(
            "<tr><td>Territorial population</td><td>160</td><td>Unknown</td></tr>",
            "",
        );
        expect(() => verifyPopulationSurfaces(raw, [address], missing)).toThrow(/missing/);
        const swapped = surfaces();
        swapped.privateDocuments[0].text = privatePolity.replace(
            "<td>160</td><td>0</td>",
            "<td>0</td><td>160</td>",
        );
        expect(() => verifyPopulationSurfaces(raw, [address], swapped)).toThrow();
        const swappedRows = surfaces();
        swappedRows.privateDocuments[0].text = privatePolity
            .replace("<td>Membership</td>", "<td>Temporary</td>")
            .replace("<td>Territorial population</td>", "<td>Membership</td>")
            .replace("<td>Temporary</td>", "<td>Territorial population</td>");
        expect(() => verifyPopulationSurfaces(raw, [address], swappedRows)).toThrow();
        const missingApparent = surfaces();
        missingApparent.privateDocuments[0].text = privatePolity.replace("<td>Unknown</td>", "");
        expect(() => verifyPopulationSurfaces(raw, [address], missingApparent)).toThrow();
        const wrong = surfaces();
        wrong.sites[0].text = publicPolity.replace("<td>20</td>", "<td>0</td>");
        expect(() => verifyPopulationSurfaces(raw, [address], wrong)).toThrow();
        const absent = surfaces();
        absent.publicDocuments[0].text = publicPolity.replace("<dt>Population</dt><dd>0</dd>", "");
        expect(() => verifyPopulationSurfaces(raw, [address], absent)).toThrow();
        const prose = surfaces();
        prose.sites[0].text += "<p>The population is 160 people.</p>";
        expect(() => verifyPopulationSurfaces(raw, [address], prose)).toThrow(/prose/);
    });
});

it("prepares an authored snapshot and verifies exact producer UUIDs", () => {
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
        put(
            "assets/content/Council.md",
            "---\ntype: affiliation\nsubType: polity\nshortcode: council\nname: {full: Council}\nsohl: {}\ndata: {population: {actual: 160, apparent: 0}, territorial_population: {actual: 160, apparent: null}, settlements: [{settlement: Farm, population: {actual: 160, apparent: 20}}, {settlement: Dock, population: {actual: 90}}]}\n---\nBody.\n",
        );
        put(
            "assets/content/Harbor.md",
            "---\ntype: place\nsubType: settlement\nshortcode: harbor\nname: {full: Harbor}\ndata: {population: {actual: 1200, apparent: 800}}\n---\nBody.\n",
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
            POPULATION_PROOF_ADDRESSES: JSON.stringify([address, placeAddress]),
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
        const content = path.join(root, "assets/content");
        const hashes = (directory: string): [string, string][] =>
            fs
                .readdirSync(directory, { withFileTypes: true })
                .flatMap((entry): [string, string][] => {
                    const file = path.join(directory, entry.name);
                    return entry.isDirectory() ?
                            hashes(file)
                        :   [
                                [
                                    path.relative(content, file),
                                    createHash("sha256")
                                        .update(fs.readFileSync(file))
                                        .digest("hex"),
                                ],
                            ];
                })
                .sort(([a], [b]) => a.localeCompare(b));
        const original = hashes(content);
        const prepared = run("prepare");
        expect(prepared.status, prepared.stderr).toBe(0);
        expect(hashes(content)).toEqual(original);
        const index = [...produced(polity), ...produced(place)];
        put(
            "build/content-index/thalorna-metadata.jsonl",
            index.map((record: any) => JSON.stringify(record)).join("\n") + "\n",
        );
        const renderBox = (value: string) =>
            infoboxesToHtml([
                {
                    id: "note",
                    title: "Details",
                    sections: [
                        { layout: "rows", rows: [{ label: "Population", kind: "number", value }] },
                    ],
                },
            ]);
        const renderer = createRenderer("foundry");
        const generatedPolity =
            renderBox("0") +
            renderer.render(
                "| Settlement | Population |\n| --- | ---: |\n| Farm | 20 |\n| Dock | 90 |\n",
            );
        const generatedPlace = renderBox("800");
        const generatedPrivatePolity = renderer.render(
            "| Population | Actual | Apparent |\n| --- | ---: | ---: |\n| Membership | 160 | 0 |\n| Territorial population | 160 | Unknown |\n| Farm | 160 | 20 |\n",
        );
        const generatedPrivatePlace = renderer.render(
            "| Population | Actual | Apparent |\n| --- | ---: | ---: |\n| Population | 1,200 | 800 |\n",
        );
        for (const [fm, key, publicHtml, privateHtml] of [
            [polity, address, generatedPolity, generatedPrivatePolity],
            [place, placeAddress, generatedPlace, generatedPrivatePlace],
        ] as const) {
            const resolved = resolvePopulationSubject(index, key);
            const id = resolved.uuid.split(".").at(-1);
            put(`build/site/thalorna/${resolved.journal.address.slug}/index.html`, publicHtml);
            put(
                `build/packs-json/journals/${fm.shortcode}.json`,
                JSON.stringify({
                    _id: id,
                    name: fm.name.full,
                    pages: [{ text: { content: publicHtml } }],
                }),
            );
            put(
                `build/packs-json/private/${fm.shortcode}.json`,
                JSON.stringify({
                    _id: makeId("population-supplement", key),
                    name: fm.name.full,
                    ownership: { default: 0 },
                    pages: [{ text: { content: privateHtml } }],
                }),
            );
        }
        put(
            "build/packs-json/private/decoy.json",
            JSON.stringify({
                _id: "wrong-private",
                name: "Council",
                ownership: { default: 0 },
                pages: [{ text: { content: privatePolity } }],
            }),
        );
        put(
            "build/packs-json/journals/decoy.json",
            JSON.stringify({
                _id: "wrong",
                name: "Council",
                pages: [{ text: { content: "decoy" } }],
            }),
        );
        const verified = run("verify");
        expect(verified.status, verified.stderr).toBe(0);
        const receipt = JSON.parse(
            fs.readFileSync(path.join(proof, "population-evidence/receipt.json"), "utf8"),
        );
        expect(receipt).toMatchObject({ subjects: 2, figures: 5, differing: 4, hiddenFigures: 4 });
        const privateFile = path.join(root, "build/packs-json/private/council.json");
        const privateEntry = JSON.parse(fs.readFileSync(privateFile, "utf8"));
        privateEntry.ownership.default = 1;
        fs.writeFileSync(privateFile, JSON.stringify(privateEntry));
        expect(run("verify").status).not.toBe(0);
        privateEntry.ownership.default = 0;
        fs.writeFileSync(privateFile, JSON.stringify(privateEntry));
        const publicFile = path.join(root, "build/packs-json/journals/council.json");
        fs.unlinkSync(publicFile);
        expect(run("verify").status).not.toBe(0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
