/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A package that declares no picture packages, built through the toolchain's
 * own entry points: the content session and published index, the asset stage,
 * the CDN plan, the dependency indexes, the compendium reference lookup, the
 * book's staging and the pathname forms.
 *
 * `no-picture-packages.json` holds what this produced against the engine of
 * origin/main at 3581002b (`git archive 3581002b` into `build/main-tree`, this
 * file copied beside it, then `node tests/fixtures/art-packages/no-picture-packages.mjs <out>`
 * run there). The test runs it against the current engine and expects the same.
 *
 * The package declares one ordinary dependency, `library`, whose index sits in
 * the cache, so the dependency lists the build reads are not empty. The CDN
 * plan takes its `picturePackages` from `art.packages` as the `cdn publish`
 * command does; that command's own wiring is outside what this fixture runs.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import YAML from "yaml";
import { assetAddressIndex, readAssetAddress } from "../../../engine/art-fields.mjs";
import { shippingAssetRecords } from "../../../engine/art-masters.mjs";
import { writeProvenance, writeSvgProvenance } from "../../../engine/art-provenance.mjs";
import { assetReferenceLookup } from "../../../engine/asset-references.mjs";
import { stagePackageBuildAssets } from "../../../engine/build-assets.mjs";
import { planCdnPublish } from "../../../engine/cdn-publish.mjs";
import { emitContentIndex } from "../../../engine/content-index.mjs";
import { createContentSession } from "../../../engine/content-session.mjs";
import {
    cachedMetadataIndexes,
    loadForeignIndexes,
    markComplete,
    metadataCacheDir,
} from "../../../engine/metadata-index.mjs";
import { configFromData } from "../../../engine/pack-config.mjs";
import { resolvePathname } from "../../../engine/pathnames.mjs";
import { stagedImagePath } from "../../../engine/pdf-build.mjs";
import { cachedDependencies } from "../../../engine/sql-tables.mjs";

/** An opaque PNG of the given size. */
function png(width, height) {
    const image = new PNG({ width, height });
    image.data.fill(255);
    return PNG.sync.write(image);
}

/** Write a file, making its directory. */
function write(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
}

/** Every file under a directory, with its SHA-256, by relative path. */
function tree(dir) {
    const out = [];
    const walk = (at) => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
            const file = path.join(at, entry.name);
            if (entry.isDirectory()) walk(file);
            else
                out.push([
                    path.relative(dir, file).split(path.sep).join("/"),
                    createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
                ]);
        }
    };
    walk(dir);
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * Build the fixture package under `root` and describe every output.
 *
 * @param {string} root - An empty directory.
 * @returns {Promise<object>} The outputs, with paths relative to `root`.
 */
export async function noPicturePackageOutputs(root) {
    const credit = { ai: false, creator: ["Artist"], license: "CC-BY-SA-4.0" };
    write(
        path.join(root, "private", "deep", "harbor.png"),
        writeProvenance(png(3, 2), { address: "sample-none-image-harbor", ...credit }).bytes,
    );
    write(
        path.join(root, "private", "anvil.svg"),
        writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', {
            address: "sample-none-icon-anvil",
            ...credit,
        }).bytes,
    );
    write(
        path.join(root, "assets", "icons", "tools", "hammer.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    write(
        path.join(root, "assets", "icons", "tools", "provenance.yaml"),
        "attribution: Artist\nlicense: CC-BY-SA-4.0\nai: false\n",
    );
    const body =
        "The harbor.\n\n![[image-harbor|The harbor]]\n\n" +
        "![Hammer](sample/assets/icons/tools/hammer.svg)\n";
    write(
        path.join(root, "assets", "content", "harbor.md"),
        `---\n${YAML.stringify({
            type: "lore",
            subType: "history",
            shortcode: "harbor",
            name: { full: "The Harbor" },
            description: "The harbor.",
        })}---\n\n${body}`,
    );
    write(path.join(root, "package.json"), JSON.stringify({ name: "sample", version: "1.0.0" }));
    const data = {
        contentPackage: "sample",
        packageKind: "modules",
        stats: { lastModifiedBy: "samplebuilder000" },
        compatibility: { minimum: "14", verified: "14" },
        packs: [{ name: "journals", type: "JournalEntry", default: true }],
        relationships: {
            requires: [
                {
                    id: "library",
                    manifest:
                        "https://github.com/example/library/releases/download/v1.0.0/module.json",
                },
            ],
        },
        art: { masterRoots: ["private"] },
    };
    const configFile = path.join(root, "package-build.config.yaml");
    write(configFile, YAML.stringify(data));
    const config = configFromData(data, configFile);
    // The declared dependency's index, cached as `deps fetch` leaves it.
    const dependencyDir = metadataCacheDir(config, "library", "1.0.0");
    write(
        path.join(dependencyDir, "library-metadata.jsonl"),
        `${JSON.stringify({ package: "library", packageModules: [] })}\n${JSON.stringify({
            address: {
                canonical: { address: "library-none-icon-shield", anchor: null, anchorKind: null },
            },
            asset: {
                ai: false,
                attribution: ["Artist"],
                height: "",
                license: "CC-BY-SA-4.0",
                nonAiAlternative: null,
                notes: "",
                path: "icons/shield.svg",
                role: "",
                source: "",
                width: "",
            },
            package: "library",
            shortcode: "shield",
            type: "icon",
        })}\n`,
    );
    markComplete(dependencyDir, "library-metadata.jsonl");
    const picturePackages = (config.art?.packages ?? []).map((entry) => entry.package);

    const session = await createContentSession({ config });
    try {
        const findings = session.problems.map((finding) => finding.message);
        const indexDir = path.join(root, "build", "content-index");
        emitContentIndex({ config, publication: await session.publication(), outDir: indexDir });
        const index = fs
            .readFileSync(path.join(indexDir, "sample-metadata.jsonl"), "utf8")
            .split("\n");

        const stageDir = "build/stage";
        await stagePackageBuildAssets({
            config: {
                rootDir: root,
                assets: [],
                stageDir,
                baseStyles: false,
                shippingLicenses: [],
                manifest: { title: "Sample" },
            },
            packConfig: config,
            session,
        });

        const records = shippingAssetRecords(session.records);
        const prepared = new Map(
            [...session.masters].map(([address, master]) => [address, master.file]),
        );
        const plan = planCdnPublish({
            assetsBase: config.paths.assets,
            contentPackage: "sample",
            host: "https://cdn.example.test",
            setFile: "set.json",
            setName: "Sample",
            records,
            preparedMasters: prepared,
            picturePackages,
        });

        const foreign = loadForeignIndexes(config, [config.contentPackage]);
        const links = assetAddressIndex(session.records, { config, foreign });
        const lookup = assetReferenceLookup(links, config);
        const embedded = readAssetAddress(links, "image-harbor", "image").pathname;
        const site = { ...config, site: { ...config.site, assets: "https://cdn.example.test" } };
        const relative = (file) =>
            file ? path.relative(root, file).split(path.sep).join("/") : file;
        return {
            findings,
            index,
            stage: tree(path.join(root, stageDir)),
            cdn: plan.uploads.map((upload) => [upload.key, upload.size]).sort(),
            dependencies: {
                cached: cachedMetadataIndexes(config).map((entry) => [entry.id, relative(entry.file)]),
                sql: (await cachedDependencies(config)).map((entry) => [
                    entry.id,
                    relative(entry.file),
                ]),
                packages: [...foreign.packages].sort(),
                shield: foreign.index.get("library-none-icon-shield")?.asset?.path,
            },
            compendium: [...lookup.byAddress.values()]
                .filter((entry) => ["sample", "library"].includes(entry.package))
                .map((entry) => [entry.address, entry.foundry, entry.shipped])
                .sort(),
            book: [embedded, "sample/assets/icons/tools/hammer.svg"].map((src) => {
                const staged = stagedImagePath(src, config);
                return [src, relative(staged?.from), staged?.to, staged?.served === true];
            }),
            pathnames: [
                "sample/assets/images/deep/harbor.png",
                "images/harbor.png",
                "sample/assets/icons/tools/hammer.svg",
                "sohl/assets/icons/shield.svg",
                "library/assets/icons/shield.svg",
            ].map((pathname) => {
                const forms = resolvePathname(pathname, site);
                return [
                    pathname,
                    forms.foundry,
                    forms.local,
                    forms.web,
                    forms.pdf,
                    forms.own,
                    forms.served === true,
                ];
            }),
        };
    } finally {
        await session.dispose();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    fs.mkdirSync(path.resolve("build"), { recursive: true });
    const root = fs.mkdtempSync(path.resolve("build", "no-picture-packages-"));
    try {
        fs.writeFileSync(
            process.argv[2],
            `${JSON.stringify(await noPicturePackageOutputs(root), null, 4)}\n`,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
