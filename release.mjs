/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The release archive — the two files a Foundry package's GitHub Release
 * carries.
 *
 * Foundry installs a package by fetching the `download` URL its manifest
 * advertises, so a release publishes `<artifact>.zip`, the whole staged tree,
 * and `<artifact>.json` beside it, which is what an already installed package
 * re-fetches to notice a new version. A package that ships content publishes a
 * third: the content index other packages resolve its addresses through,
 * named by the `flags.metadataUrl` the manifest advertises. Every name is fixed
 * by what the manifest says, not chosen here — see `manifest.mjs`.
 *
 * Kept apart from `stage.mjs` because this is the only part of assembling a
 * package that needs a dependency. A repository that never cuts a release from
 * a local build imports the staging half and pays nothing for this one.
 *
 * @module
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

// archiver 8 is pure ESM and exports **classes**, with no default export. The
// old `import archiver from "archiver"` factory call throws at import —
// `does not provide an export named 'default'` — which is how this repository's
// release job came to fail before a single byte was written.
import { ZipArchive } from "archiver";

/**
 * Zip the staged tree and place the manifest beside the archive.
 *
 * **Waits for the output stream to close, not merely for the archive to
 * finalize.** `finalize()` resolves once archiver has finished *appending*
 * entries, which is before the bytes have necessarily reached disk; returning
 * there can hand a later step — an upload, a checksum — a truncated file. The
 * failure is timing-dependent, so it survives every run that happens to be
 * fast enough, which is what makes it worth being explicit about.
 *
 * @param {object} [opts]
 * @param {string} [opts.stageDir] - The staged package tree.
 * @param {string} [opts.outDir] - Where the release assets are written.
 * @param {"system"|"module"} [opts.artifact] - Which artifact is shipped.
 *   Determines both asset names.
 * @param {string} [opts.metadataDir] - Where the build writes its content
 *   index, consulted when the advertised file was not staged.
 * @returns {Promise<{zip: string, manifest: string, metadata?: string,
 *   bytes: number, version: string}>} The paths written, the archive's size,
 *   and the version the manifest declares. `metadata` is absent when the
 *   manifest advertises no content index.
 * @throws {Error} When the stage has no manifest — there is nothing to release,
 *   and an archive without one installs as nothing.
 */
export async function packRelease({
    stageDir = "build/stage",
    outDir = "build/dist",
    artifact = "system",
    metadataDir = "build/content-index",
    pdf = true,
} = {}) {
    const stage = path.resolve(stageDir);
    const out = path.resolve(outDir);
    const manifestName = `${artifact}.json`;
    const stagedManifest = path.join(stage, manifestName);

    if (!fs.existsSync(stagedManifest)) {
        throw new Error(
            `${stagedManifest} does not exist, so there is nothing to release. ` +
                `Build the package first.`,
        );
    }

    const manifest = JSON.parse(await fsp.readFile(stagedManifest, "utf8"));
    await fsp.mkdir(out, { recursive: true });

    const zipPath = path.join(out, `${artifact}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Settled before anything is appended, so an error raised during the walk
    // rejects rather than leaving the await below hanging forever.
    const closed = new Promise((resolve, reject) => {
        output.on("close", resolve);
        output.on("error", reject);
        archive.on("error", reject);
        // A warning archiver can recover from (a vanished file, say) still
        // means the archive is not the tree that was asked for.
        archive.on("warning", reject);
    });

    archive.pipe(output);
    // `false` — no top-level directory inside the zip. Foundry unpacks the
    // archive *into* the package directory, so an extra level would nest the
    // manifest one deeper than it looks for it.
    archive.directory(stage, false);
    await archive.finalize();
    await closed;

    await fsp.copyFile(stagedManifest, path.join(out, manifestName));

    const metadata = await publishMetadataIndex({ manifest, stage, out, metadataDir });

    // Last, and never fatal: the archive and the manifest are the release, and
    // a book that failed to set is a reported problem rather than a reason to
    // publish neither.
    const book =
        pdf ?
            await packReleasePdf({ out, version: manifest.version })
        :   { pdf: null, findings: [], reason: "the release was asked not to build one" };

    return {
        zip: zipPath,
        manifest: path.join(out, manifestName),
        ...(metadata ? { metadata } : {}),
        ...(book.pdf ? { pdf: book.pdf } : {}),
        pdfFindings: book.findings,
        pdfSkipped: book.pdf ? null : book.reason,
        bytes: archive.pointer(),
        version: manifest.version,
    };
}

/**
 * Build the book that ships beside the archive.
 *
 * **Imported when it is used, not when this module is.** The book build pulls
 * in a markdown parser, DuckDB and the whole content engine; `release.mjs`
 * otherwise exists to zip a directory, and every consumer that publishes no
 * book would pay for that graph on `import`. A dynamic import inside the one
 * function that needs it keeps the cost where the benefit is.
 *
 * **Not building is the normal case and never an error.** A package publishing
 * only a homepage, one with no `pdf:` block and one with no content tree have
 * each said they publish no book. Four of the six packages that install this
 * toolchain are in exactly that position, so a release that failed for the
 * absence of a PDF would break more releases than it helped.
 *
 * @param {object} opts - Options.
 * @param {string} opts.out - The release directory.
 * @param {string} opts.version - The version the manifest declares.
 * @returns {Promise<{pdf: string|null, findings: object[], reason: string|null}>}
 *   What was built, and what was found on the way.
 */
async function packReleasePdf({ out, version }) {
    let buildPdf;
    try {
        ({ buildPdf } = await import("./engine/pdf-build.mjs"));
    } catch (err) {
        return {
            pdf: null,
            findings: [
                {
                    severity: "warning",
                    message: `the book builder could not be loaded: ${err.message}`,
                },
            ],
            reason: null,
        };
    }
    const result = await buildPdf({ out, version });
    return { pdf: result.pdf, findings: result.findings, reason: result.reason };
}

/**
 * Place the content index the manifest advertises beside the archive.
 *
 * **The asset's name comes from the manifest, not from here.** `flags.metadataUrl`
 * is the URL every consumer fetches, so its basename is by definition the name
 * the file has to be published under — deriving it a second time would let the
 * two disagree, and a release whose asset is named differently from its
 * advertised URL fails at the consumer, not here.
 *
 * A manifest that advertises no index publishes none: a package with no content
 * tree has nothing to index, and is perfectly releasable. But a manifest that
 * *does* advertise one and cannot produce it is a build error. The alternative
 * is a release that promises an index it does not carry, whose symptom is a
 * dead cross-package link in somebody else's build weeks later — the silent
 * failure the vendored manifest was replaced to end.
 *
 * @param {object} opts
 * @param {object} opts.manifest - The parsed staged manifest.
 * @param {string} opts.stage - The staged tree.
 * @param {string} opts.out - Where release assets are written.
 * @param {string} opts.metadataDir - Where the build writes its index, tried
 *   when the file was not staged.
 * @returns {Promise<string|undefined>} The published path, or nothing when the
 *   manifest advertises no index.
 * @throws {Error} When one is advertised and no file backs it.
 */
async function publishMetadataIndex({ manifest, stage, out, metadataDir }) {
    const url = manifest.flags?.metadataUrl;
    if (!url) return undefined;

    const name = path.basename(new URL(url, "https://example.invalid").pathname);
    const candidates = [path.join(stage, name), path.resolve(metadataDir, name)];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) {
        throw new Error(
            `the manifest advertises ${name} as \`flags.metadataUrl\` but no such ` +
                `file exists — looked in ${candidates.join(" and ")}. Build the ` +
                `content index before packing the release.`,
        );
    }

    const dest = path.join(out, name);
    await fsp.copyFile(found, dest);
    return dest;
}
