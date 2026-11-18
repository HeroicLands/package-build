/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { expect, it } from "vitest";
import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { metadataFileName } from "../engine/metadata-index.mjs";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const write = (root: string, file: string, text: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
};
const source = (fm: object, body = "# Dossier {#dossier}\n\nA working vehicle.") =>
    `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
const vehicle = (data: object = {}) => ({
    type: "vehicle",
    id: "vehiclecart00000",
    shortcode: "cart",
    name: { full: "Cart" },
    data: {
        family: "Cart",
        size: 1,
        locomotion: ["wheeled"],
        role: ["utility"],
        capacity: 2,
        occupantCapacity: 2,
        movementProperties: [
            {
                medium: "terrestrial",
                rates: [{ prob: 1, distance: 0, distUnit: "feet", timeUnit: "hour" }],
            },
        ],
        movementProfiles: [{ medium: "terrestrial", feetPerRound: 30 }, { medium: "terrestrial" }],
        occupants: [{ address: "vehiclefixture-note-being-horse", role: "draft_animal" }],
        icon: "image-cart",
        tokenIcon: "image-carttoken",
        packFolder: "folder-transport",
        ...data,
    },
    sohl: { templatePriority: null, system: { carryingCapacity: 450 } },
});

/** A configured vehiclefixture consumer tree, with real artwork and a cached schema. */
function consumer() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vehicle-actor-consumer-"));
    write(root, "package.json", JSON.stringify({ name: "vehiclefixture", version: "1.0.0" }));
    write(
        root,
        "package-build.config.yaml",
        YAML.stringify({
            contentPackage: "vehiclefixture",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "vehiclebuild0000" },
            systems: { sohl: { compatibility: { verified: "0.9.0" } } },
            itemBuilders: ["sohl"],
            packs: [
                { name: "actors", label: "Actors", type: "Actor", system: "sohl", default: true },
                { name: "journals", label: "Journals", type: "JournalEntry", default: true },
            ],
            relationships: {
                requires: [
                    {
                        id: "foreign",
                        type: "module",
                        manifest: "https://example.invalid/module.json",
                    },
                ],
            },
        }),
    );
    write(
        root,
        "build/cache/foreign/sohl@0.9.0/schema.json",
        fs.readFileSync(
            path.join(packageRoot, "tests/fixtures/content-format/schema-sohl.json"),
            "utf8",
        ),
    );
    write(root, "assets/content/cart.md", source(vehicle()));
    write(
        root,
        "assets/content/horse.md",
        source(
            {
                type: "being",
                subType: "creature",
                id: "vehiclehorse0000",
                shortcode: "horse",
                name: { full: "Horse" },
                sohl: { templatePriority: null },
            },
            "# Dossier {#dossier}\n\nA draft animal.",
        ),
    );
    write(
        root,
        "assets/content/transport.md",
        source({ type: "folder", shortcode: "transport", name: { full: "Transport" } }, ""),
    );
    for (const name of ["cart", "carttoken"])
        write(
            root,
            `assets/images/${name}.svg`,
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>',
        );
    write(
        root,
        "assets/images/provenance.yaml",
        "attribution: Test\nlicense: CC-BY-4.0\nai: false\n",
    );
    const dependency = path.join(root, "dependency-content");
    write(
        dependency,
        "horse.md",
        source(
            {
                type: "being",
                subType: "creature",
                shortcode: "horse",
                name: { full: "Foreign horse" },
            },
            "A draft animal.",
        ),
    );
    const cache = "build/cache/metadata/foreign@1.0.0";
    write(
        root,
        `${cache}/${metadataFileName("foreign")}`,
        serializeContentIndex(
            collectContentIndex(dependency, { contentPackage: "foreign", skipDirectories: [] }),
        ),
    );
    write(root, `${cache}/.complete`, "");
    return root;
}

/** Run the normal pack JSON compile in the consumer's configuration process. */
function compile(root: string) {
    const module = pathToFileURL(path.join(packageRoot, "engine/generate.mjs")).href;
    const run = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
        const { generatePacksJson } = await import(${JSON.stringify(module)});
        console.log("ERRORS=" + await generatePacksJson());
    `,
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            encoding: "utf8",
            timeout: SUBPROCESS_TEST_TIMEOUT,
        },
    );
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    return { output, errors: Number(output.match(/ERRORS=(\d+)/)?.[1] ?? NaN), status: run.status };
}

it(
    "writes vehicle and being Actors with resolved artwork, folders and generic defaults",
    () => {
        const root = consumer();
        try {
            const result = compile(root);
            expect(result.status, result.output).toBe(0);
            expect(result.errors, result.output).toBe(0);
            const docs = fs
                .readdirSync(path.join(root, "build/packs-json/actors"))
                .filter((file) => file.endsWith(".json"))
                .map((file) =>
                    JSON.parse(
                        fs.readFileSync(path.join(root, "build/packs-json/actors", file), "utf8"),
                    ),
                );
            const cart = docs.find((doc) => doc.name === "Cart");
            expect(cart).toMatchObject({
                type: "vehicle",
                img: "modules/vehiclefixture/images/cart.svg",
                prototypeToken: {
                    texture: { src: "modules/vehiclefixture/images/carttoken.svg" },
                },
                system: {
                    shortcode: "cart",
                    occupantCapacity: 2,
                    carryingCapacity: 450,
                    movementProfiles: [
                        { medium: "terrestrial", feetPerRound: 30 },
                        { medium: "terrestrial" },
                    ],
                    occupants: [{ actorCodeOrUuid: "horse", role: "draftCreature", quantity: 1 }],
                },
            });
            expect(cart.system.dossier).toContain("A working vehicle.");
            expect(cart.system).not.toHaveProperty("capacity");
            expect(cart.system).not.toHaveProperty("family");
            expect(docs.find((doc) => doc.name === "Horse")).toMatchObject({ type: "being" });
            expect(cart.folder).toBe(docs.find((doc) => doc.name === "Transport")._id);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
    SUBPROCESS_TEST_TIMEOUT,
);

it(
    "reports an occupant shortcode collision at the authored address during normal compile",
    () => {
        const root = consumer();
        try {
            const text = source(
                vehicle({
                    occupants: [
                        { address: "vehiclefixture-note-being-horse", role: "draft_animal" },
                        { address: "foreign-note-being-horse", role: "crew" },
                    ],
                }),
            );
            write(root, "assets/content/cart.md", text);
            const result = compile(root);
            expect(result.errors, result.output).toBeGreaterThan(0);
            const line =
                text.split("\n").findIndex((value) => value.includes("foreign-note-being-horse")) +
                1;
            const column = text.split("\n")[line - 1].indexOf("foreign-note-being-horse") + 1;
            expect(result.output).toContain(`assets/content/cart.md:${line}:${column}: error:`);
            expect(result.output).toContain("share the shortcode");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
    SUBPROCESS_TEST_TIMEOUT,
);
