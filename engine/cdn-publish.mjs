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
 * `package-build cdn publish` — every picture a package has, on the CDN, and
 * the art the package leaves out as a named asset set.
 *
 * **The layout is the deployed one.** Each icon and image is uploaded flat, as
 * `icons/<basename>` or `images/<basename>`, under `<site.assets>/<package>/`
 * — the address {@link module:engine/pathnames.resolvePathname} gives the
 * website for the same file, so the site and the CDN agree by construction.
 * Shipped and excluded pictures both go up: the website shows all of them.
 *
 * **The bucket is served at `site.assets`.** An object's key is its path below
 * that URL, `<package>/images/<basename>`, so the key and the public address
 * differ only by the host.
 *
 * **The bytes are the staged bytes.** The repository's `assetTransform` runs
 * on each file exactly as the stage runs it, so a picture on the CDN and the
 * same picture in the Foundry package are one file.
 *
 * **The set lists only what the package leaves out.** `--set <file>` names it,
 * `<package>/<file>` on the CDN, in the shape
 * {@link module:engine/asset-shipping} describes, with each `source` the
 * file's absolute CDN URL. An address the set does not list resolves to the
 * shipped copy, so listing a shipped picture would only make a world download
 * a file it already has. `default.json` is refused: it is the shipped set's
 * name.
 *
 * **A second run uploads nothing.** A picture whose object already exists at
 * the same size is skipped. The set file is compared byte for byte, since a
 * changed set can keep its length.
 *
 * **A file is refused; a document is reported.** A file under a picture root
 * whose name is no address stops the run before anything is uploaded: the
 * CDN has no key to put it under. A note naming a picture the package does
 * not have, or naming left-out art the CDN does not hold once the run ends, is
 * a warning against the note — the compile draws its default art for the
 * first and the stand-in for the second, so neither stops a publish.
 *
 * Nothing here reads the environment or writes to the console: the command
 * line supplies the credentials, the store and the log.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { AwsClient } from "aws4fetch";

import { artTarget, ART_SLOTS } from "./art-fields.mjs";
import { collectAssetRecords } from "./asset-index.mjs";
import { deployedAssetPath, selectStagedAssets, SHIPPED_SET_FILE } from "./asset-shipping.mjs";
import {
    ASSET_SYSTEM,
    ASSET_TYPE_NAMES,
    DEPLOYED_ASSET_TYPES,
    isAssetType,
} from "./asset-types.mjs";
import { renderAddress } from "./address.mjs";
import { EMBED_DEFAULT_TYPE, embedsIn } from "./content-embeds.mjs";
import { imagesIn } from "./content-images.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
import { resolvePathname } from "./pathnames.mjs";

/**
 * The environment variables naming the S3-compatible store behind the CDN.
 *
 * For Cloudflare R2, `CDN_ENDPOINT` is the account's S3 endpoint,
 * `https://<account id>.r2.cloudflarestorage.com`, and the key pair is an R2
 * API token's.
 *
 * @type {Readonly<{endpoint: string, bucket: string, accessKeyId: string, secretAccessKey: string}>}
 */
export const CDN_ENV = Object.freeze({
    endpoint: "CDN_ENDPOINT",
    bucket: "CDN_BUCKET",
    accessKeyId: "CDN_ACCESS_KEY_ID",
    secretAccessKey: "CDN_SECRET_ACCESS_KEY",
});

/** How many requests run against the store at once. */
const CONCURRENCY = 8;

/**
 * The media type each picture extension is served with. A browser refuses to
 * draw an SVG served as anything but `image/svg+xml`.
 *
 * @type {Readonly<Record<string, string>>}
 */
const CONTENT_TYPES = Object.freeze({
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
});

/**
 * The media type a file is uploaded with.
 *
 * @param {string} name - A file name or key.
 * @returns {string} Its media type, `application/octet-stream` when unknown.
 */
export function contentTypeOf(name) {
    return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Why a `--set` value cannot name a set file, or `""` when it can.
 *
 * @param {unknown} file - The value given.
 * @returns {string} The problem, as a clause, or `""`.
 */
export function setFileProblem(file) {
    const name = String(file ?? "");
    if (!name) return "`--set` names no file";
    if (name.includes("/") || name.includes("\\")) {
        return `\`--set ${name}\` is a path; a set file sits directly under the package's CDN root, so name a file`;
    }
    if (!name.endsWith(".json")) return `\`--set ${name}\` is not a \`.json\` file`;
    if (name === path.posix.basename(SHIPPED_SET_FILE)) {
        return (
            `\`--set ${name}\` is refused: \`${name}\` is the shipped set's name, the ` +
            "fallback every other set is read against. Name the set for its art"
        );
    }
    return "";
}

/**
 * The store's settings from the environment.
 *
 * @param {Record<string, string|undefined>} env - The environment.
 * @returns {{endpoint: string, bucket: string, accessKeyId: string,
 *   secretAccessKey: string}|null} The settings, or `null` when none of the
 *   variables is set.
 * @throws {Error} When some are set and others are not, naming the missing
 *   ones and never a value.
 */
export function cdnCredentials(env) {
    const values = Object.fromEntries(
        Object.entries(CDN_ENV).map(([key, name]) => [key, String(env[name] ?? "").trim()]),
    );
    const missing = Object.entries(CDN_ENV)
        .filter(([key]) => !values[key])
        .map(([, name]) => name);
    if (missing.length === Object.keys(CDN_ENV).length) return null;
    if (missing.length) {
        throw new Error(
            `the CDN store is half configured: ${missing.join(", ")} ` +
                `${missing.length === 1 ? "is" : "are"} not set. Set every one of ` +
                `${Object.values(CDN_ENV).join(", ")}, in the environment or \`.env.local\``,
        );
    }
    return /** @type {any} */ (values);
}

/**
 * A store holding the CDN's objects.
 *
 * @typedef {object} CdnStore
 * @property {(key: string) => Promise<number|undefined>} size - An object's
 *   size in bytes, `undefined` when there is none.
 * @property {(key: string) => Promise<Buffer|undefined>} read - An object's
 *   bytes, `undefined` when there is none.
 * @property {((key: string, body: Buffer, contentType: string) => Promise<void>)|undefined} write -
 *   Store an object; absent on a read-only store.
 * @property {string} describe - What the store is, for the log. Never a
 *   secret.
 */

/**
 * Throw for a response the store refused.
 *
 * @param {string} what - The request, as `METHOD key`.
 * @param {Response} response - The response.
 * @returns {never}
 */
function refused(what, response) {
    throw new Error(`${what} answered ${response.status} ${response.statusText}`.trim());
}

/**
 * The S3-compatible store the CDN is served from, signed with AWS SigV4.
 *
 * Addressed path-style, `<endpoint>/<bucket>/<key>`, which R2 and every other
 * S3-compatible server accept.
 *
 * @param {object} opts
 * @param {string} opts.endpoint - The S3 endpoint.
 * @param {string} opts.bucket - The bucket.
 * @param {string} opts.accessKeyId - The access key id.
 * @param {string} opts.secretAccessKey - The secret access key.
 * @param {typeof fetch} [opts.fetch] - The fetch to sign requests for.
 * @returns {CdnStore} The store.
 */
export function s3Store({ endpoint, bucket, accessKeyId, secretAccessKey, fetch: fetchImpl }) {
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
    const base = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`;
    const url = (key) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const send = async (key, init) => {
        const request = await client.sign(url(key), init);
        return (fetchImpl ?? fetch)(request);
    };
    return {
        describe: `bucket ${bucket} at ${new URL(endpoint).host}`,
        async size(key) {
            const response = await send(key, { method: "HEAD" });
            if (response.status === 404) return undefined;
            if (!response.ok) refused(`HEAD ${key}`, response);
            return Number(response.headers.get("content-length"));
        },
        async read(key) {
            const response = await send(key, { method: "GET" });
            if (response.status === 404) return undefined;
            if (!response.ok) refused(`GET ${key}`, response);
            return Buffer.from(await response.arrayBuffer());
        },
        async write(key, body, contentType) {
            const response = await send(key, {
                method: "PUT",
                body,
                headers: { "content-type": contentType, "content-length": String(body.length) },
            });
            if (!response.ok) refused(`PUT ${key}`, response);
        },
    };
}

/**
 * The CDN read through its public address — what a dry run without
 * credentials compares against. It cannot write.
 *
 * @param {string} host - `site.assets`, the URL the bucket is served at.
 * @param {typeof fetch} [fetchImpl] - The fetch to use.
 * @returns {CdnStore} The read-only store.
 */
export function publicStore(host, fetchImpl) {
    const base = host.replace(/\/+$/, "");
    const get = (key, method) => (fetchImpl ?? fetch)(`${base}/${key}`, { method });
    return {
        describe: `${base}, read-only`,
        async size(key) {
            const response = await get(key, "HEAD");
            if (response.status === 404 || response.status === 403) return undefined;
            if (!response.ok) refused(`HEAD ${key}`, response);
            return Number(response.headers.get("content-length"));
        },
        async read(key) {
            const response = await get(key, "GET");
            if (response.status === 404 || response.status === 403) return undefined;
            if (!response.ok) refused(`GET ${key}`, response);
            return Buffer.from(await response.arrayBuffer());
        },
        write: undefined,
    };
}

/**
 * One picture to publish.
 *
 * @typedef {object} CdnUpload
 * @property {object} record - The asset record.
 * @property {string} address - Its canonical address.
 * @property {string} target - `<icons|images>/<basename>`.
 * @property {string} key - The object key, `<package>/<target>`.
 * @property {Buffer} body - The bytes, transformed as the stage transforms
 *   them.
 * @property {string} contentType - The media type it is served with.
 * @property {boolean} shipped - Whether the Foundry package ships it.
 */

/**
 * Everything a publish uploads, worked out before anything is sent.
 *
 * @typedef {object} CdnPlan
 * @property {object[]} findings - What stops the publish; nothing is planned
 *   when non-empty.
 * @property {object[]} records - Every asset record the package has.
 * @property {CdnUpload[]} uploads - One per picture, in key order.
 * @property {{key: string, body: Buffer, set: object}|null} set - The set file.
 * @property {string} cdnRoot - `<site.assets>/<package>/`.
 */

/**
 * Work out what a publish uploads.
 *
 * @param {object} opts
 * @param {string} opts.assetsBase - The package's asset directory.
 * @param {string} opts.contentPackage - The content package.
 * @param {string} opts.host - `site.assets`.
 * @param {string} opts.setFile - The set file's name.
 * @param {string} opts.setName - The set's display name.
 * @param {(sourcePath: string) => string|null|undefined} [opts.transform] -
 *   The repository's per-file transform.
 * @param {readonly string[]} [opts.shippingLicenses] - The licences the
 *   package adds to the shipping list, so the set leaves out what the stage
 *   leaves out.
 * @returns {CdnPlan} The plan.
 */
export function planCdnPublish({
    assetsBase,
    contentPackage,
    host,
    setFile,
    setName,
    transform,
    shippingLicenses = [],
}) {
    const findings = [];
    const cdnRoot = `${host.replace(/\/+$/, "")}/${contentPackage}/`;
    const records = collectAssetRecords(assetsBase, { contentPackage, problems: findings });
    if (findings.length) return { findings, records, uploads: [], set: null, cdnRoot };

    const { staged, excluded } = selectStagedAssets(records, shippingLicenses);
    const shipped = new Set(staged);
    const uploads = [...staged, ...excluded.map(({ record }) => record)]
        .map((record) => {
            const from = path.join(assetsBase, ...record.asset.path.split("/"));
            const transformed = transform ? transform(from) : null;
            const body =
                transformed != null ? Buffer.from(transformed, "utf8") : fs.readFileSync(from);
            const target = /** @type {string} */ (deployedAssetPath(record));
            return {
                record,
                address: record.address.canonical,
                target,
                key: `${contentPackage}/${target}`,
                body,
                contentType: contentTypeOf(target),
                shipped: shipped.has(record),
            };
        })
        .sort((a, b) => (a.key < b.key ? -1 : 1));

    const set = {
        name: setName,
        package: contentPackage,
        assets: uploads
            .filter((upload) => !upload.shipped)
            .map((upload) => ({
                address: upload.address,
                source: `${cdnRoot}${upload.target}`,
                target: upload.target,
                size: upload.body.length,
            }))
            .sort((a, b) => (a.target < b.target ? -1 : 1)),
    };
    return {
        findings,
        records,
        uploads,
        set: {
            key: `${contentPackage}/${setFile}`,
            body: Buffer.from(`${JSON.stringify(set, null, 4)}\n`, "utf8"),
            set,
        },
        cdnRoot,
    };
}

/**
 * Run `work` over `items`, `limit` at a time, in order of completion.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} work
 * @returns {Promise<void>}
 */
async function pooled(items, limit, work) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await work(item);
        }
    });
    await Promise.all(runners);
}

/**
 * Upload a plan.
 *
 * A picture that fails is recorded and the rest carry on, so one refused file
 * costs one file rather than the run. The set file is written only when every
 * picture it lists is on the CDN: a set naming a file the CDN lacks sends a
 * world to fetch nothing.
 *
 * @param {CdnPlan} plan - From {@link planCdnPublish}, with no findings.
 * @param {object} opts
 * @param {CdnStore} opts.store - Where the objects go.
 * @param {boolean} [opts.dryRun] - Compare only; write nothing.
 * @param {(line: string) => void} [opts.log] - One line per object.
 * @returns {Promise<{uploaded: CdnUpload[], skipped: CdnUpload[],
 *   failed: {upload: CdnUpload, message: string}[],
 *   set: "uploaded"|"skipped"|"withheld", published: Set<string>}>} What was
 *   (or, in a dry run, would be) uploaded, skipped and refused; what became of
 *   the set file; and every address whose picture is on the CDN at its
 *   planned size once the run ends — or would be, in a dry run.
 */
export async function publishToCdn(plan, { store, dryRun = false, log = () => {} }) {
    if (!dryRun && !store.write) {
        throw new Error(`the store (${store.describe}) is read-only, so it can only be dry-run`);
    }
    const write = /** @type {NonNullable<CdnStore["write"]>} */ (store.write);
    const verb = dryRun ? "would upload" : "uploaded";
    const uploaded = [];
    const skipped = [];
    const failed = [];
    const published = new Set();
    await pooled(plan.uploads, CONCURRENCY, async (upload) => {
        try {
            const size = await store.size(upload.key);
            if (size === upload.body.length) {
                skipped.push(upload);
            } else {
                if (!dryRun) await write(upload.key, upload.body, upload.contentType);
                uploaded.push(upload);
            }
            published.add(upload.address);
        } catch (err) {
            failed.push({ upload, message: err instanceof Error ? err.message : String(err) });
        }
    });
    const byKey = (a, b) => (a.key < b.key ? -1 : 1);
    uploaded.sort(byKey);
    skipped.sort(byKey);
    failed.sort((a, b) => byKey(a.upload, b.upload));
    for (const upload of uploaded) log(`${verb} ${upload.key} (${upload.body.length} bytes)`);
    for (const upload of skipped) log(`skipped ${upload.key}, already present at that size`);

    const setPlan = /** @type {NonNullable<CdnPlan["set"]>} */ (plan.set);
    if (failed.length) {
        log(`withheld ${setPlan.key}: ${failed.length} of its pictures did not upload`);
        return { uploaded, skipped, failed, set: "withheld", published };
    }
    const current = await store.read(setPlan.key);
    if (current && current.equals(setPlan.body)) {
        log(`skipped ${setPlan.key}, unchanged`);
        return { uploaded, skipped, failed, set: "skipped", published };
    }
    if (!dryRun) await write(setPlan.key, setPlan.body, contentTypeOf(setPlan.key));
    log(`${verb} ${setPlan.key} (${setPlan.set.assets.length} assets)`);
    return { uploaded, skipped, failed, set: "uploaded", published };
}

/**
 * Line and column, 1-based, of an offset inside a note's body.
 *
 * @param {string} body - The body as the walk yields it.
 * @param {number} offset - Where in the body.
 * @param {number} bodyLine - The file line the body starts on.
 * @param {number} bodyColumn - The file column it starts at.
 * @returns {{line: number, column: number}} The file position.
 */
function bodyPosition(body, offset, bodyLine, bodyColumn) {
    const before = body.slice(0, offset);
    const lines = before.split("\n");
    return lines.length === 1 ?
            { line: bodyLine, column: bodyColumn + offset }
        :   { line: bodyLine + lines.length - 1, column: lines[lines.length - 1].length + 1 };
}

/**
 * Every place a package's notes name one of its own pictures, and what each
 * names.
 *
 * Reads the three places a note names art: an art slot under `data:`, an
 * embed (`![[address|label]]`) and a body image whose pathname is the
 * package's own. A reference naming another package, or one that does not
 * parse as an address, is another check's business and is not returned.
 *
 * @param {object} opts
 * @param {string} opts.contentBase - The content tree.
 * @param {readonly string[]} opts.skipDirectories - Directory names the walk
 *   ignores.
 * @param {string} opts.contentPackage - The content package.
 * @param {readonly object[]} opts.records - The package's asset records.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   written: string, record: object|null}>} One per reference, `record` `null`
 *   where the package has no such picture. `file` is relative to the working
 *   directory.
 */
export function noteArtReferences({ contentBase, skipDirectories, contentPackage, records }) {
    const byAddress = new Map(records.map((record) => [record.address.canonical, record]));
    const byPath = new Map(records.map((record) => [record.asset?.path, record]));
    const vocabulary = {
        system: ASSET_SYSTEM,
        package: contentPackage,
        types: ASSET_TYPE_NAMES,
        packages: new Set([contentPackage]),
    };
    /** @returns {string|undefined} The canonical address, when it is this package's. */
    const ownAddress = (value, defaultType, accepts) => {
        const tuple = artTarget(value, defaultType, accepts, vocabulary);
        if (tuple.reason || tuple.package !== contentPackage || !isAssetType(tuple.type)) {
            return undefined;
        }
        return renderAddress(tuple);
    };

    const out = [];
    for (const note of walkMarkdownTree(contentBase, { skipDirectories })) {
        if (!note.frontmatter) continue;
        const file = path.relative(process.cwd(), note.absPath);
        let raw;
        const rawText = () => (raw ??= fs.readFileSync(note.absPath, "utf8"));

        for (const slot of ART_SLOTS) {
            const value = note.frontmatter.data?.[slot.key];
            if (typeof value !== "string" || !value || value === slot.declines) continue;
            const address = ownAddress(value, slot.type, slot.accepts);
            if (!address) continue;
            out.push({
                file,
                ...positionOfFrontmatterPath(rawText(), ["data", slot.key]),
                written: value,
                record: byAddress.get(address) ?? null,
            });
        }

        const body = note.body ?? "";
        const at = (offset) => bodyPosition(body, offset, note.bodyLine ?? 1, note.bodyColumn ?? 1);
        for (const embed of embedsIn(body)) {
            const address = ownAddress(embed.written, EMBED_DEFAULT_TYPE, undefined);
            if (!address) continue;
            out.push({
                file,
                ...at(embed.index),
                written: embed.written,
                record: byAddress.get(address) ?? null,
            });
        }
        for (const image of imagesIn(body)) {
            let forms;
            try {
                forms = resolvePathname(image.src, { contentPackage });
            } catch {
                continue;
            }
            if (forms?.state !== "package" || forms.package !== contentPackage) continue;
            const root = forms.suffix.split("/")[0];
            if (!DEPLOYED_ASSET_TYPES.some((type) => type.root === root)) continue;
            out.push({
                file,
                ...at(image.index),
                written: image.src,
                record: byPath.get(forms.suffix) ?? null,
            });
        }
    }
    return out;
}

/**
 * The findings a publish reports against the package's notes.
 *
 * Both are warnings:
 *
 * - a note names a picture the package does not have, so no address answers
 *   it and nothing is published for it;
 * - a note names a picture the package leaves out, and the CDN does not hold
 *   it, so a world adding the set gets no file for that document.
 *
 * @param {ReturnType<typeof noteArtReferences>} references - From
 *   {@link noteArtReferences}.
 * @param {object} opts
 * @param {string} opts.contentPackage - The content package.
 * @param {ReadonlySet<string>} opts.published - Every address on the CDN at
 *   its planned size.
 * @param {ReadonlySet<object>} opts.excluded - The records the package leaves
 *   out.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "warning", message: string}>} In note order.
 */
export function noteArtFindings(references, { contentPackage, published, excluded }) {
    const findings = [];
    for (const { record, written, ...where } of references) {
        if (!record) {
            findings.push({
                ...where,
                severity: "warning",
                message:
                    `\`${written}\` names a picture the \`${contentPackage}\` package does not ` +
                    "have, so no address answers it and the CDN has nothing to publish for it",
            });
        } else if (excluded.has(record) && !published.has(record.address.canonical)) {
            findings.push({
                ...where,
                severity: "warning",
                message:
                    `\`${record.address.canonical}\` is left out of the package and is not on ` +
                    "the CDN, so a world adding this set has no file for it",
            });
        }
    }
    return findings;
}
