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

/** Explicit, source-preserving additions to a selected polity's settlements. @module */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";
import { canonicalKey, ownDocumentSystem, readCanonicalKey, renderAddress } from "./address.mjs";

const prepared = new WeakMap();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function fail(file, message, raw = "", offset = 0) {
    const prefix = raw.slice(0, offset);
    const line = prefix.split("\n").length;
    const column = offset - prefix.lastIndexOf("\n");
    throw new Error(`${file}:${line}:${column}: error: ${message}`);
}

function sourceAddress(frontmatter, contentPackage) {
    if (!object(frontmatter) || !frontmatter.type || !frontmatter.shortcode) return null;
    return canonicalKey(
        contentPackage,
        ownDocumentSystem(frontmatter.type),
        frontmatter.type,
        frontmatter.shortcode,
    );
}

function within(root, file) {
    const relative = path.relative(root, file);
    return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

/** Check every existing path component, including ancestors of the content root. */
function pathStats(file, directory = false) {
    const absolute = path.resolve(file);
    const parsed = path.parse(absolute);
    let current = parsed.root;
    const chain = [];
    for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink())
            fail(file, "symbolic link paths are not writable settlement sources");
        if (current !== absolute || directory) {
            if (!stat.isDirectory()) fail(file, "source parent must be a directory");
        } else {
            if (!stat.isFile()) fail(file, "settlement source must be a regular file");
            if (stat.nlink !== 1) fail(file, "hard linked settlement sources are not writable");
        }
        chain.push({ path: current, dev: stat.dev, ino: stat.ino });
    }
    return chain;
}

function readSource(root, file) {
    if (!within(root, file)) fail(file, "source lies outside the content root");
    pathStats(root, true);
    const chain = pathStats(file);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = fs.fstatSync(fd);
        const last = chain.at(-1);
        if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== last.dev || stat.ino !== last.ino)
            fail(file, "source identity changed while opening it");
        const bytes = fs.readFileSync(fd);
        const after = fs.fstatSync(fd);
        if (
            stat.size !== after.size ||
            stat.mtimeMs !== after.mtimeMs ||
            stat.ctimeMs !== after.ctimeMs ||
            !isDeepStrictEqual(chain, pathStats(file))
        )
            fail(file, "stale source: file or parent changes during capture");
        return { bytes, chain, mode: stat.mode & 0o7777, dev: stat.dev, ino: stat.ino };
    } finally {
        fs.closeSync(fd);
    }
}

function parseSource(bytes, file) {
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) fail(file, "source must contain valid UTF-8");
    const opening = /^(?:\uFEFF)?---\r?\n/.exec(raw);
    if (!opening) fail(file, "source requires a YAML frontmatter opening delimiter");
    const closePattern = /^---[ \t]*(?:\r?\n|$)/gm;
    closePattern.lastIndex = opening[0].length;
    const closing = closePattern.exec(raw);
    if (!closing) fail(file, "source requires a YAML frontmatter closing delimiter");
    const start = opening[0].length;
    const source = raw.slice(start, closing.index);
    const eol = opening[0].endsWith("\r\n") ? "\r\n" : "\n";
    if ((eol === "\r\n" && /(?<!\r)\n/.test(source)) || (eol === "\n" && source.includes("\r")))
        fail(file, "mixed frontmatter line endings require an explicit author edit", raw, start);
    const document = YAML.parseDocument(source, {
        keepSourceTokens: true,
        strict: true,
        uniqueKeys: true,
    });
    const error = document.errors[0] ?? document.warnings[0];
    if (error) fail(file, `unsupported YAML: ${error.message}`, raw, start + (error.pos?.[0] ?? 0));
    const reject = (node, message) => fail(file, message, raw, start + (node?.range?.[0] ?? 0));
    const inspect = (node) => {
        if (!node) return;
        if (YAML.isAlias(node) || node.anchor || node.tag)
            reject(node, "aliases, anchors and explicit YAML tags require an explicit author edit");
        if (YAML.isMap(node)) {
            for (const pair of node.items) {
                if (
                    !YAML.isScalar(pair.key) ||
                    typeof pair.key.value !== "string" ||
                    pair.key.value === "<<"
                )
                    reject(
                        pair.key,
                        "complex or merge mapping keys require an explicit author edit",
                    );
                inspect(pair.key);
                inspect(pair.value);
            }
        } else if (YAML.isSeq(node)) node.items.forEach(inspect);
    };
    inspect(document.contents);
    if (!YAML.isMap(document.contents) || document.contents.flow)
        reject(document.contents, "frontmatter requires a block root mapping");
    return {
        raw,
        source,
        start,
        eol,
        document,
        reject,
        frontmatter: document.toJS({ maxAliasCount: 0 }),
    };
}

function jsonRows(rows, file) {
    const visit = (value, ancestors = new Set()) => {
        if (value === null || typeof value === "string" || typeof value === "boolean") return;
        if (typeof value === "number" && Number.isFinite(value)) return;
        if (!object(value) && !Array.isArray(value))
            fail(file, "reviewed rows must contain only JSON values");
        if (
            (!Array.isArray(value) &&
                Object.getPrototypeOf(value) !== Object.prototype &&
                Object.getPrototypeOf(value) !== null) ||
            ancestors.has(value)
        )
            fail(file, "reviewed rows require plain, acyclic JSON objects");
        ancestors.add(value);
        if (Object.getOwnPropertySymbols(value).length)
            fail(file, "reviewed rows cannot contain symbol keys");
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if (descriptor.get || descriptor.set)
                fail(file, "reviewed rows cannot contain accessors");
            visit(descriptor.value, ancestors);
        }
        ancestors.delete(value);
    };
    if (!Array.isArray(rows) || rows.some((row) => !object(row)))
        fail(file, "reviewed rows must be an array of row objects");
    visit(rows);
    const cloned = JSON.parse(JSON.stringify(rows));
    if (cloned.some((row) => !object(row)))
        fail(file, "reviewed rows cannot contain empty array slots");
    return cloned;
}

function flowInsertion(node, source, text, reject) {
    const token = node.srcToken;
    if (token?.type !== "flow-collection")
        reject(node, "flow collection source tokens are required");
    const close = token.end.find(
        (part) => part.type === "flow-seq-end" || part.type === "flow-map-end",
    );
    if (!close) reject(node, "flow collection closing token is missing");
    let separator = "";
    if (node.items.length) {
        const item = node.items.at(-1);
        const last = YAML.isMap(node) ? (item.value ?? item.key) : item;
        const tail = source
            .slice(last.range[1], close.offset)
            .replace(/#[^\r\n]*/g, "")
            .replace(/\s/g, "");
        if (tail !== "" && tail !== ",")
            reject(node, "ambiguous flow collection separators require an explicit author edit");
        separator = tail === "," ? "" : ", ";
    }
    return { offset: close.offset, text: separator + text };
}

function blockInsertion(node, source, text, reject) {
    const offset = node.range?.[2];
    if (!Number.isInteger(offset) || (offset > 0 && source[offset - 1] !== "\n"))
        reject(node, "block collection must end at a line boundary");
    return { offset, text };
}

function insertion(parsed, additions) {
    const { source, document, eol, reject } = parsed;
    const root = document.contents;
    const dataPair = root.items.find((pair) => pair.key.value === "data");
    const serialized = additions.map((row) => JSON.stringify(row)).join(", ");
    if (!dataPair)
        return blockInsertion(root, source, `data: {settlements: [${serialized}]}${eol}`, reject);
    const data = dataPair.value;
    if (!YAML.isMap(data))
        reject(
            dataPair.key,
            "data must be a mapping; null or scalar data requires an explicit author edit",
        );
    const settlementsPair = data.items.find((pair) => pair.key.value === "settlements");
    if (!settlementsPair) {
        if (data.flow) return flowInsertion(data, source, `settlements: [${serialized}]`, reject);
        return blockInsertion(
            data,
            source,
            `${" ".repeat(data.srcToken.indent)}settlements: [${serialized}]${eol}`,
            reject,
        );
    }
    const settlements = settlementsPair.value;
    if (!YAML.isSeq(settlements))
        reject(settlementsPair.key, "data.settlements must be a sequence");
    if (settlements.flow) return flowInsertion(settlements, source, serialized, reject);
    if (settlements.srcToken?.type !== "block-seq")
        reject(settlements, "block sequence source tokens are required");
    const indent = " ".repeat(settlements.srcToken.indent);
    return blockInsertion(
        settlements,
        source,
        additions.map((row) => `${indent}- ${JSON.stringify(row)}${eol}`).join(""),
        reject,
    );
}

/**
 * Prepare an immutable edit handle without writing source or preview files.
 * The complete reviewed rows retain all existing rows as an unchanged prefix.
 *
 * @param {object} options - A captured index and source map from the same authoring session.
 * @param {string} options.contentRoot - Absolute local content root, without symlink components.
 * @param {string} options.contentPackage - The local package identity.
 * @param {string|object} options.polityAddress - Fully qualified Address or Address tuple.
 * @param {object[]} options.records - Structured content-index records.
 * @param {Map<string, {frontmatter: object, raw: string|Buffer}>} options.sources - Captured sources keyed by absolute path.
 * @param {object[]} options.rows - Complete, already reviewed source-form settlement rows.
 * @returns {object} Opaque prepared edit and immutable review metadata.
 */
export function prepareSettlementEdit({
    contentRoot,
    contentPackage,
    polityAddress,
    records,
    sources,
    rows,
}) {
    if (typeof contentRoot !== "string" || !path.isAbsolute(contentRoot))
        fail("settlement-source", "content root must be absolute");
    const root = path.resolve(contentRoot);
    const tuple = readCanonicalKey(polityAddress);
    if (
        !tuple ||
        tuple.package !== contentPackage ||
        tuple.system !== "note" ||
        tuple.type !== "affiliation"
    )
        fail(root, "select a fully qualified local polity Address");
    const selected = renderAddress(tuple);
    const matches = records.filter((record) => {
        const address = readCanonicalKey(record.address?.canonical);
        return address && renderAddress(address) === selected;
    });
    if (matches.length !== 1)
        fail(root, "exactly one indexed record must match the selected polity Address");
    const record = matches[0];
    if (
        record.package !== contentPackage ||
        record.type !== "affiliation" ||
        record.subType !== "polity" ||
        sourceAddress(record, contentPackage) !== selected
    )
        fail(root, "selected indexed record is not the expected local polity identity");
    const candidates = [...sources].filter(
        ([, source]) => sourceAddress(source.frontmatter, contentPackage) === selected,
    );
    if (candidates.length !== 1)
        fail(root, "exactly one captured local source must match the selected polity Address");
    const [sourcePath, captured] = candidates[0];
    if (!path.isAbsolute(sourcePath)) fail(sourcePath, "captured source path must be absolute");
    const file = path.resolve(sourcePath);
    if (!Buffer.isBuffer(captured.raw) && typeof captured.raw !== "string")
        fail(file, "captured source requires original bytes or UTF-8 text");
    const snapshot = readSource(root, file);
    if (!snapshot.bytes.equals(Buffer.from(captured.raw)))
        fail(file, "stale source: captured bytes differ from the current source");
    const parsed = parseSource(snapshot.bytes, file);
    if (
        sourceAddress(parsed.frontmatter, contentPackage) !== selected ||
        parsed.frontmatter.subType !== "polity"
    )
        fail(file, "source identity differs from the selected indexed polity");
    const reviewed = jsonRows(rows, file);
    const data = parsed.frontmatter.data;
    if (data !== undefined && !object(data))
        parsed.reject(parsed.document.contents.get("data", true), "data must be a mapping");
    const existing = data?.settlements ?? [];
    if (data && Object.hasOwn(data, "settlements") && !Array.isArray(data.settlements))
        parsed.reject(
            parsed.document.contents.getIn(["data", "settlements"], true),
            "data.settlements must be a sequence",
        );
    if (
        reviewed.length < existing.length ||
        existing.some((row, index) => !isDeepStrictEqual(row, reviewed[index]))
    )
        parsed.reject(
            parsed.document.contents.getIn(["data", "settlements"], true),
            "existing rows must remain an unchanged prefix; removal, reordering and refresh require an explicit author edit",
        );
    const additions = reviewed.slice(existing.length);
    const change = additions.length ? insertion(parsed, additions) : { offset: 0, text: "" };
    const absoluteOffset = additions.length ? parsed.start + change.offset : 0;
    const offset = Buffer.byteLength(parsed.raw.slice(0, absoluteOffset), "utf8");
    const added = Buffer.from(change.text, "utf8");
    const after = Buffer.concat([
        snapshot.bytes.subarray(0, offset),
        added,
        snapshot.bytes.subarray(offset),
    ]);
    if (additions.length) {
        const checked = parseSource(after, file).frontmatter;
        const expected = { ...parsed.frontmatter, data: { ...data, settlements: reviewed } };
        if (!isDeepStrictEqual(checked, expected))
            fail(file, "source-range edit does not preserve the expected frontmatter");
    }
    const edit = Object.freeze({
        polityAddress: selected,
        sourcePath: file,
        sha256: hash(snapshot.bytes),
        proposedSha256: hash(after),
        changed: additions.length > 0,
        patch: Object.freeze({ start: offset, end: offset, replacement: change.text }),
    });
    prepared.set(edit, { root, file, snapshot, after });
    return edit;
}

function stateFor(edit) {
    const state = prepared.get(edit);
    if (!state) fail("settlement-source", "an original prepared edit handle is required");
    return state;
}

function assertCurrent(state) {
    const current = readSource(state.root, state.file);
    const expected = state.snapshot;
    if (
        current.dev !== expected.dev ||
        current.ino !== expected.ino ||
        !isDeepStrictEqual(current.chain, expected.chain)
    )
        fail(state.file, "source identity or parent directory changed since preparation");
    if (current.mode !== expected.mode || !current.bytes.equals(expected.bytes))
        fail(state.file, "stale source: bytes or mode changed since preparation");
}

function patchText(before, after, label) {
    if (before.equals(after)) return "";
    const lines = (bytes) => bytes.toString("utf8").match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const a = lines(before);
    const b = lines(after);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    const first = Math.max(0, start - 3);
    const trailing = Math.min(3, a.length - endA);
    const shown = (prefix, value) =>
        prefix + value + (value.endsWith("\n") ? "" : "\n\\ No newline at end of file\n");
    return (
        `--- a/${label}\n+++ b/${label}\n@@ -${first + 1},${endA + trailing - first} +${first + 1},${endB + trailing - first} @@\n` +
        a
            .slice(first, start)
            .map((line) => shown(" ", line))
            .join("") +
        a
            .slice(start, endA)
            .map((line) => shown("-", line))
            .join("") +
        b
            .slice(start, endB)
            .map((line) => shown("+", line))
            .join("") +
        a
            .slice(endA, endA + trailing)
            .map((line) => shown(" ", line))
            .join("")
    );
}

/**
 * Write exact before/after files, a unified diff and snapshot metadata under build/.
 * @param {object} edit - The original prepared edit handle.
 * @param {object} options - Preview destination context.
 * @param {string} options.projectRoot - The local project containing the content root.
 * @returns {{directory: string}} The unique review directory.
 */
export function writeSettlementPreview(edit, { projectRoot }) {
    const state = stateFor(edit);
    const project = path.resolve(projectRoot);
    if (!within(project, state.root))
        fail(project, "preview project must contain the content root");
    pathStats(project, true);
    let parent = project;
    for (const segment of ["build", "settlement-previews"]) {
        parent = path.join(parent, segment);
        try {
            fs.mkdirSync(parent, { mode: 0o700 });
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
        pathStats(parent, true);
    }
    const directory = fs.mkdtempSync(path.join(parent, "review-"));
    try {
        const write = (name, data) =>
            fs.writeFileSync(path.join(directory, name), data, { flag: "wx", mode: 0o600 });
        write("before.md", state.snapshot.bytes);
        write("after.md", state.after);
        write(
            "change.patch",
            patchText(state.snapshot.bytes, state.after, path.relative(state.root, state.file)),
        );
        write("snapshot.json", JSON.stringify(edit, null, 2) + "\n");
    } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
    }
    return { directory };
}

/**
 * Explicitly replace one prepared source after a byte-exact stale check.
 * Cooperating writers share an exclusive sibling lock. The final read and rename
 * are separate operations; an uncooperative writer can race between them.
 *
 * @param {object} edit - The original prepared edit handle.
 * @returns {{written: boolean, cleanupErrors: string[]}} Commit result and cleanup failures.
 */
export function commitSettlementEdit(edit) {
    const state = stateFor(edit);
    assertCurrent(state);
    if (!edit.changed) return { written: false, cleanupErrors: [] };
    const parent = path.dirname(state.file);
    const basename = path.basename(state.file);
    const lock = path.join(parent, `.${basename}.settlement-write.lock`);
    const temporary = path.join(parent, `.${basename}.settlement-${randomUUID()}.tmp`);
    const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW;
    let lockFd;
    let temporaryFd;
    let ownsTemporary = false;
    let temporaryIdentity;
    let lockIdentity;
    let failure;
    let written = false;
    const cleanupErrors = [];
    try {
        try {
            lockFd = fs.openSync(lock, flags, 0o600);
        } catch (error) {
            fail(state.file, `cannot acquire settlement write lock: ${error.message}`);
        }
        lockIdentity = fs.fstatSync(lockFd);
        assertCurrent(state);
        temporaryFd = fs.openSync(temporary, flags, 0o600);
        temporaryIdentity = fs.fstatSync(temporaryFd);
        ownsTemporary = true;
        fs.writeFileSync(temporaryFd, state.after);
        fs.fsyncSync(temporaryFd);
        fs.fchmodSync(temporaryFd, state.snapshot.mode);
        fs.fsyncSync(temporaryFd);
        fs.closeSync(temporaryFd);
        temporaryFd = undefined;
        const staged = readSource(state.root, temporary);
        if (
            staged.dev !== temporaryIdentity.dev ||
            staged.ino !== temporaryIdentity.ino ||
            staged.mode !== state.snapshot.mode ||
            !staged.bytes.equals(state.after)
        )
            fail(state.file, "temporary replacement identity or bytes changed");
        assertOwned(lock, lockIdentity);
        assertCurrent(state);
        fs.renameSync(temporary, state.file);
        ownsTemporary = false;
        written = true;
    } catch (error) {
        failure = error;
    } finally {
        const clean = (action) => {
            try {
                action();
            } catch (error) {
                cleanupErrors.push(error.message);
            }
        };
        if (temporaryFd !== undefined) clean(() => fs.closeSync(temporaryFd));
        if (ownsTemporary)
            clean(() => {
                assertOwned(temporary, temporaryIdentity);
                fs.unlinkSync(temporary);
            });
        if (lockFd !== undefined) {
            clean(() => fs.closeSync(lockFd));
            clean(() => {
                assertOwned(lock, lockIdentity);
                fs.unlinkSync(lock);
            });
        }
    }
    if (failure) {
        if (cleanupErrors.length)
            throw new AggregateError(
                [failure, ...cleanupErrors.map((message) => new Error(message))],
                `${failure.message}; cleanup: ${cleanupErrors.join("; ")}`,
            );
        throw failure;
    }
    return { written, cleanupErrors };
}

function assertOwned(file, identity) {
    const current = fs.lstatSync(file);
    if (
        !identity ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
    )
        fail(file, "temporary file or lock identity changed; cleanup requires inspection");
}
