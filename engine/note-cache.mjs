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
 * **The content tree's records, kept under `build/` between renders of one
 * note.** {@link noteTree} answers what `./note-page`'s `renderNoteFile`
 * renders against: the tree's index records and the note's own query answers.
 * It derives them as every build does, through
 * {@link module:engine/content-index.indexRecordsFor} and
 * {@link module:engine/sql-tables.prepareTreeSqlTables}, and keeps what it
 * derived in {@link noteCacheDirectory}.
 *
 * **Nothing stale is ever served.** Every stored answer is keyed by a hash of
 * everything it was derived from, and is used only when that hash is the one
 * the inputs give now:
 *
 * - **the toolchain**: package-build's version and the bytes of its own
 *   modules, the Node.js version, and the DuckDB version;
 * - **the configuration**: the configuration file's bytes and the resolved
 *   configuration;
 * - **the dependencies**: the bytes of every fetched content index, and the
 *   installed script fonts' version and manifest;
 * - **the tree**: every note's path and the hash of its text, and the
 *   package's asset records.
 *
 * Three stores answer at three grains, so a change discards only what it
 * reaches:
 *
 * - `notes.v8` holds each note's parse, keyed by the hash of its text, and
 *   the records derived from that note alone, keyed also by everything the
 *   tree contributes to them (the calendars, the addresses the notes declare,
 *   the assets). A changed note re-derives itself and nothing else here.
 * - `tree.v8` holds the whole tree's records and parses, keyed by every
 *   input; any change replaces it.
 * - Beside the records, `tree.v8` holds each rendered note's query answers,
 *   valid for exactly the records they sit beside.
 *
 * A store that cannot be read, or that was written for other inputs, is
 * derived again and overwritten; a store is replaced by renaming a complete
 * file over it, so a reader never sees half of one. The cache is written
 * nowhere but its directory, and deleting the directory loses nothing but
 * time.
 *
 * @module
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import v8 from "node:v8";

import { AddressEntries, AddressLink } from "./address-values.mjs";
import { isAddressTuple, readCanonicalKey, renderAddress } from "./address.mjs";
import { collectAssetRecords } from "./asset-index.mjs";
import { readArtLock, loadPinnedArt } from "./art-lock.mjs";
import { collectArtMasters, masterAssetRecords } from "./art-masters.mjs";
import { formatDiagnostic } from "./diagnostics.mjs";
import { walkMarkdownFiles, parseMarkdownFile } from "./helpers.mjs";
import { cachedMetadataFiles, loadForeignIndexes } from "./metadata-index.mjs";
import { configFileIn } from "./note-calendars.mjs";
import { CONFIG_FILENAMES, readPackConfig } from "./pack-config.mjs";
import { PACKAGEBUILD_ROOT } from "./packagebuild-index.mjs";
import { resolveScriptFonts } from "./script-fonts.mjs";

/** The layout of the stores; a store of another layout is derived again. */
const FORMAT = 1;

/** The key that marks a typed value in a packed tree. */
const TAG = "\u0000pb";

/** Thrown for a value the cache cannot hold, which is then derived each time. */
class Uncacheable extends Error {}

/**
 * Whether a value is a plain object: one the codec copies key by key.
 *
 * @param {object} value - An object.
 * @returns {boolean} Whether its prototype is `Object.prototype` or `null`.
 */
function isPlain(value) {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * A value's own non-index properties, encoded, or nothing when it has none.
 *
 * @param {Array<unknown>|Map<unknown, unknown>|Set<unknown>} value - A container.
 * @param {WeakMap<object, unknown>} seen - Encoded containers.
 * @param {boolean} sources - As {@link encode} takes it.
 * @returns {Record<string, unknown>|undefined} The properties.
 */
function extraProperties(value, seen, sources) {
    const keys = Object.keys(value).filter((key) => !Array.isArray(value) || !/^\d+$/.test(key));
    if (!keys.length) return undefined;
    return Object.fromEntries(keys.map((key) => [key, encode(value[key], seen, sources)]));
}

/**
 * Encode a value as one `v8.serialize` keeps whole: an Address, an anchored
 * link, an Address map, a Map or a Set, and an array carrying properties
 * besides its elements, each become a tagged plain object. A value shared by
 * two places stays shared.
 *
 * @param {unknown} value - The value.
 * @param {WeakMap<object, unknown>} seen - Encoded objects, by original.
 * @param {boolean} [sources] - Encode a function as its source text, for a
 *   value that is hashed and never restored.
 * @returns {unknown} The encoded value.
 * @throws {Uncacheable} For a function, unless `sources`; for a symbol; and
 *   for an object of any other class.
 */
function encode(value, seen, sources = false) {
    if (typeof value === "function" && sources) return { [TAG]: "source", text: String(value) };
    if (typeof value === "function" || typeof value === "symbol")
        throw new Uncacheable(`a ${typeof value} cannot be cached`);
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    let out;
    if (isAddressTuple(value)) out = { [TAG]: "address", key: renderAddress(value) };
    else if (value instanceof AddressLink) {
        out = { [TAG]: "link", anchor: value.anchor, kind: value.kind };
        seen.set(value, out);
        out.target = encode(value.target, seen, sources);
    } else if (value instanceof AddressEntries) {
        out = { [TAG]: "entries" };
        seen.set(value, out);
        out.entries = encode(value.entries, seen, sources);
    } else if (value instanceof Map || value instanceof Set) {
        out = { [TAG]: value instanceof Map ? "map" : "set" };
        seen.set(value, out);
        out.items = [...value].map((item) => encode(item, seen, sources));
        out.props = extraProperties(value, seen, sources);
    } else if (Array.isArray(value)) {
        const props = Object.keys(value).some((key) => !/^\d+$/.test(key));
        if (props) {
            out = { [TAG]: "array" };
            seen.set(value, out);
            out.items = Array.from(value, (item) => encode(item, seen, sources));
            out.props = extraProperties(value, seen, sources);
        } else {
            out = [];
            seen.set(value, out);
            for (const item of value) out.push(encode(item, seen, sources));
        }
    } else if (value instanceof Date || value instanceof RegExp) out = value;
    else if (isPlain(value)) {
        const plain = Object.getPrototypeOf(value) === null;
        // A plain object that happens to hold the tag key is wrapped, so it
        // never reads back as a typed value.
        if (plain || Object.hasOwn(value, TAG)) {
            out = { [TAG]: plain ? "bare" : "object" };
            seen.set(value, out);
            out.entries = Object.entries(value).map(([key, item]) => [
                key,
                encode(item, seen, sources),
            ]);
        } else {
            out = {};
            seen.set(value, out);
            for (const [key, item] of Object.entries(value)) out[key] = encode(item, seen, sources);
        }
    } else throw new Uncacheable(`a ${value.constructor?.name ?? "class"} cannot be cached`);
    seen.set(value, out);
    return out;
}

/**
 * Restore what {@link encode} wrote.
 *
 * @param {unknown} value - An encoded value.
 * @param {Map<object, unknown>} seen - Decoded objects, by encoded one.
 * @returns {unknown} The value.
 */
function decode(value, seen) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date || value instanceof RegExp) return value;
    if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const item of value) out.push(decode(item, seen));
        return out;
    }
    const assign = (target, props) => {
        for (const [key, item] of Object.entries(props ?? {})) target[key] = decode(item, seen);
        return target;
    };
    switch (value[TAG]) {
        case undefined: {
            const out = {};
            seen.set(value, out);
            return assign(out, value);
        }
        case "address": {
            const out = readCanonicalKey(value.key);
            seen.set(value, out);
            return out;
        }
        case "link": {
            const out = new AddressLink(decode(value.target, seen), value.anchor, value.kind);
            seen.set(value, out);
            return out;
        }
        case "entries": {
            const out = Object.create(AddressEntries.prototype);
            seen.set(value, out);
            out.entries = decode(value.entries, seen);
            return out;
        }
        case "map":
        case "set": {
            const out = value[TAG] === "map" ? new Map() : new Set();
            seen.set(value, out);
            for (const item of value.items) {
                const decoded = decode(item, seen);
                if (out instanceof Map) out.set(decoded[0], decoded[1]);
                else out.add(decoded);
            }
            return assign(out, value.props);
        }
        case "array": {
            const out = [];
            seen.set(value, out);
            for (const item of value.items) out.push(decode(item, seen));
            return assign(out, value.props);
        }
        case "object":
        case "bare": {
            const out = value[TAG] === "bare" ? Object.create(null) : {};
            seen.set(value, out);
            for (const [key, item] of value.entries) out[key] = decode(item, seen);
            return out;
        }
        default:
            throw new Error(`unknown cached value ${JSON.stringify(value[TAG])}`);
    }
}

/**
 * Pack a value into bytes {@link unpackValue} restores as an equal copy:
 * Addresses, anchored links and Address maps keep their types, Maps, Sets,
 * Dates and `undefined` survive, and a value shared by two places is still
 * shared.
 *
 * @param {unknown} value - The value.
 * @returns {Buffer} The bytes.
 * @throws {Error} For a value holding a function, a symbol, or an object of
 *   another class.
 */
export function packValue(value) {
    return v8.serialize(encode(value, new WeakMap()));
}

/**
 * Restore a value {@link packValue} packed. Every call returns a fresh copy.
 *
 * @param {Buffer|Uint8Array} bytes - The packed value.
 * @returns {unknown} The value.
 * @throws {Error} When the bytes are not a packed value.
 */
export function unpackValue(bytes) {
    return decode(v8.deserialize(bytes), new Map());
}

/**
 * {@link packValue}, or nothing for a value the cache cannot hold.
 *
 * @param {unknown} value - The value.
 * @returns {Buffer|undefined} The bytes.
 */
function packIfCacheable(value) {
    try {
        return packValue(value);
    } catch (error) {
        if (error instanceof Uncacheable) return undefined;
        throw error;
    }
}

/**
 * A hex SHA-256 of the given parts.
 *
 * @param {...(string|Buffer|Uint8Array)} parts - What is hashed, in order,
 *   each length-prefixed so no two lists hash alike.
 * @returns {string} The digest.
 */
function digest(...parts) {
    const hash = crypto.createHash("sha256");
    for (const part of parts) {
        const bytes = typeof part === "string" ? Buffer.from(part) : part;
        hash.update(`${bytes.length}:`);
        hash.update(bytes);
    }
    return hash.digest("hex");
}

/**
 * Where a package's note cache is kept: `build/cache/note-page/` under the
 * package root.
 *
 * @param {{rootDir: string}} config - The resolved configuration.
 * @returns {string} The directory.
 */
export function noteCacheDirectory(config) {
    return path.join(config.rootDir, "build", "cache", "note-page");
}

/**
 * Every file under a directory, recursively, in a stable order.
 *
 * @param {string} dir - The directory.
 * @param {(name: string) => boolean} keep - Which file names count.
 * @returns {string[]} Absolute paths.
 */
function filesUnder(dir, keep) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && keep(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort();
}

/** Fingerprint master identity, metadata and directory entries. */
function masterFingerprintParts(root) {
    const parts = [];
    const walk = (dir) => {
        parts.push(dir);
        if (!fs.existsSync(dir)) return;
        for (const entry of fs
            .readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) parts.push(file, fs.readlinkSync(file));
            else if (entry.isDirectory()) walk(file);
            else if (entry.isFile() && /\.(?:png|svg)$/i.test(entry.name)) {
                const stat = fs.statSync(file);
                parts.push(file, `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
            }
        }
    };
    walk(root);
    return parts;
}

/**
 * The version an installed package declares, resolved from `from`.
 *
 * @param {string} name - The package.
 * @param {string} from - A file the resolution starts at.
 * @returns {string} Its version, or `absent`.
 */
function installedVersion(name, from) {
    try {
        const file = createRequire(from).resolve(`${name}/package.json`);
        return `${file}@${JSON.parse(fs.readFileSync(file, "utf8")).version}`;
    } catch {
        return "absent";
    }
}

/**
 * The toolchain a cached answer was derived with: package-build's version and
 * the bytes of its own modules, the Node.js version, and the DuckDB version
 * the query answers came from.
 *
 * @returns {string} Its hash.
 */
export function toolchainFingerprint() {
    const own = path.join(PACKAGEBUILD_ROOT, "package.json");
    const modules = [
        ...filesUnder(path.join(PACKAGEBUILD_ROOT, "engine"), (name) => name.endsWith(".mjs")),
        ...fs
            .readdirSync(PACKAGEBUILD_ROOT)
            .filter((name) => name.endsWith(".mjs"))
            .sort()
            .map((name) => path.join(PACKAGEBUILD_ROOT, name)),
    ];
    return digest(
        String(FORMAT),
        fs.readFileSync(own),
        process.version,
        installedVersion("@duckdb/node-api", own),
        ...modules.flatMap((file) => [
            path.relative(PACKAGEBUILD_ROOT, file),
            fs.readFileSync(file),
        ]),
    );
}

/**
 * The configuration and dependencies a cached answer was derived with: the
 * configuration file's bytes, the resolved configuration, every fetched
 * content index's bytes, and the installed script fonts.
 *
 * @param {object} config - The resolved configuration.
 * @returns {string} Its hash.
 * @throws {Error} When a declared dependency has not been fetched, naming
 *   `package-build deps fetch`.
 */
function packageFingerprint(config) {
    const configFile = configFileIn(config.rootDir, CONFIG_FILENAMES);
    const resolved = resolvedText(config);
    const fonts = resolveScriptFonts(config.rootDir);
    return digest(
        configFile ? fs.readFileSync(configFile) : "",
        resolved,
        JSON.stringify(readArtLock(config)),
        JSON.stringify(fonts ? { root: fonts.root, version: fonts.version } : null),
        fonts?.root && fs.existsSync(path.join(fonts.root, "fonts.json")) ?
            fs.readFileSync(path.join(fonts.root, "fonts.json"))
        :   "",
        ...cachedMetadataFiles(config).flatMap((file) => [file, fs.readFileSync(file)]),
        ...[...(config.art?.masterRoots ?? []), ...(config.art?.componentRoots ?? [])].flatMap(
            masterFingerprintParts,
        ),
    );
}

/**
 * A resolved configuration as text, a function written as its source.
 *
 * @param {object} config - The resolved configuration.
 * @returns {string} The text.
 */
function resolvedText(config) {
    return JSON.stringify(config, (_, value) =>
        typeof value === "function" ? `function ${value.toString()}` : value,
    );
}

/**
 * Whether the configuration file now resolves to other than the configuration a
 * caller supplied, so nothing derived with that configuration may be keyed by
 * the file's present bytes. A code configuration is loaded once per process,
 * so only a data file is resolved again.
 *
 * @param {object} config - The resolved configuration.
 * @returns {boolean} Whether the file has moved on from it.
 */
function configMovedOn(config) {
    const file = configFileIn(config.rootDir, CONFIG_FILENAMES);
    if (!file || file.endsWith(".mjs")) return false;
    try {
        return resolvedText(readPackConfig(file)) !== resolvedText(config);
    } catch {
        return true;
    }
}

/**
 * Read a store, or nothing when it is absent, unreadable, of another layout,
 * or written for other inputs.
 *
 * @param {string} file - The store.
 * @param {string} key - The inputs it must have been written for.
 * @returns {Record<string, any>|undefined} The store.
 */
function readStore(file, key) {
    let store;
    try {
        store = v8.deserialize(fs.readFileSync(file));
    } catch {
        return undefined;
    }
    if (!store || typeof store !== "object" || store.format !== FORMAT || store.key !== key)
        return undefined;
    return store;
}

/**
 * Write a store whole: to a file beside it, which then takes its place.
 *
 * @param {string} file - The store.
 * @param {Record<string, any>} store - Its contents.
 * @returns {void}
 */
function writeStore(file, store) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const partial = `${file}.${process.pid}.${crypto.randomUUID()}.partial`;
    try {
        fs.writeFileSync(partial, v8.serialize({ ...store, format: FORMAT }));
        fs.renameSync(partial, file);
    } finally {
        fs.rmSync(partial, { force: true });
    }
}

/** Whether a value is a non-null object. */
const isObject = (value) => value !== null && typeof value === "object";

/** Whether every item of a value is an object: the shape of index records. */
const isRecords = (value) => Array.isArray(value) && value.every(isObject);

/** Whether a value is a parse as {@link parseMarkdownFile} returns one, its text aside. */
const isParse = (value) =>
    isObject(value) &&
    typeof value.body === "string" &&
    (value.frontmatter === null || isObject(value.frontmatter));

/**
 * Unpack bytes and keep the value only when it has the shape a caller needs.
 *
 * @param {unknown} bytes - Packed bytes, or anything else a store held.
 * @param {(value: unknown) => boolean} valid - The shape it must have.
 * @returns {unknown} The value, or `undefined` when the bytes cannot be
 *   unpacked or the value has another shape.
 */
function unpackChecked(bytes, valid) {
    if (!(bytes instanceof Uint8Array)) return undefined;
    try {
        const value = unpackValue(bytes);
        return valid(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The per-note store as {@link module:engine/content-index.indexRecordsFor}
 * consults it: each note's parse by the hash of its text, and the records
 * derived from that note alone. An entry that cannot be unpacked, or that
 * unpacks to another shape, is derived again and replaced.
 *
 * @param {Record<string, any>|undefined} stored - The store read from disk.
 * @param {Map<string, {raw: string, hash: string}>} texts - Every note's text
 *   and its hash, by absolute path.
 * @param {string} contentBase - The content tree.
 */
function noteMemo(stored, texts, contentBase) {
    const before = stored?.notes instanceof Map ? stored.notes : new Map();
    const after = new Map();
    let derived = 0;
    let changed = false;
    const entryFor = (absPath) => {
        const rel = path.relative(contentBase, absPath);
        const hash = texts.get(absPath)?.hash;
        if (!after.has(rel)) {
            const old = before.get(rel);
            const kept = isObject(old) && old.hash === hash;
            after.set(rel, kept ? old : { hash });
            if (!kept) changed = true;
        }
        return after.get(rel);
    };
    return {
        /** @type {typeof parseMarkdownFile} */
        parse(absPath, options = {}) {
            const text = texts.get(absPath);
            if (!text || options.addressContext)
                return parseMarkdownFile(absPath, { ...options, raw: options.raw ?? text?.raw });
            const entry = entryFor(absPath);
            const key = options.renderDescription === false ? "bare" : "described";
            const kept = unpackChecked(entry[key], isParse);
            if (kept) return { .../** @type {object} */ (kept), raw: text.raw };
            const parsed = parseMarkdownFile(absPath, { ...options, raw: text.raw });
            const { raw: _, ...rest } = parsed;
            const packed = packIfCacheable(rest);
            if (packed) entry[key] = packed;
            else delete entry[key];
            changed = true;
            return parsed;
        },
        /**
         * The records a note derives, from the store when they were derived
         * from the same text in the same context.
         *
         * @param {string} absPath - The note.
         * @param {string|undefined} context - The hash of the context.
         * @param {() => object[]} derive - Derives them.
         * @returns {object[]} The records, a copy the caller owns.
         */
        records(absPath, context, derive) {
            const entry = texts.has(absPath) && context ? entryFor(absPath) : undefined;
            if (entry && entry.context === context) {
                const kept = unpackChecked(entry.records, isRecords);
                if (kept) return /** @type {object[]} */ (kept);
            }
            derived++;
            const made = derive();
            if (entry) {
                const packed = packIfCacheable(made);
                if (packed) {
                    entry.context = context;
                    entry.records = packed;
                } else {
                    delete entry.context;
                    delete entry.records;
                }
                changed = true;
            }
            return made;
        },
        /**
         * The hash of what the tree contributes to every note's records, or
         * nothing when it cannot be hashed, and then nothing is reused. A
         * function in it, such as the pack router the configuration builds,
         * hashes as its source; what it closes over is the configuration,
         * which the store's own key already covers.
         *
         * @param {unknown} value - The context.
         * @returns {string|undefined} The hash.
         */
        context(value) {
            try {
                return digest(v8.serialize(encode(value, new WeakMap(), true)));
            } catch (error) {
                if (error instanceof Uncacheable) return undefined;
                throw error;
            }
        },
        /** How many notes derived their records rather than reading them. */
        get derived() {
            return derived;
        },
        /**
         * The store to write, holding only the notes the tree still has, or
         * nothing when it is unchanged.
         *
         * @returns {Map<string, object>|undefined} The entries.
         */
        changes() {
            return changed || after.size !== before.size ? after : undefined;
        },
    };
}

/** The tag of one note's stored query answers. */
const ANSWERS = "note-answers";

/** Whether a value is absent or an array of objects. */
const isObjects = (value) => value === undefined || (Array.isArray(value) && value.every(isObject));

/** Whether a value is absent or an array whose every item passes `check`. */
const isListOf = (value, check) =>
    value === undefined || (Array.isArray(value) && value.every(check));

/** Whether a value is a count: a whole number, zero or more. */
const isCount = (value) => Number.isInteger(value) && value >= 0;

/** Whether a value is absent or a boolean, as a directive's `allow-empty`. */
const isFlag = (value) => value === undefined || typeof value === "boolean";

/** Whether a value is absent or a 1-based position. */
const isPosition = (value) => value === undefined || (Number.isInteger(value) && value > 0);

/** Whether a value is a failure's message: a string the renderer reads as true. */
const isMessage = (value) => typeof value === "string" && value !== "";

/**
 * Whether a value is one query table's result, as the expander reads it:
 * either a failure, with its `reason` and where it sits, or a table, with its
 * Markdown and its counts.
 */
const isTableResult = (value) =>
    isObject(value) &&
    isFlag(value.allowEmpty) &&
    (isMessage(value.reason) ?
        isPosition(value.line) && isPosition(value.column)
    :   value.reason === undefined &&
        typeof value.markdown === "string" &&
        isCount(value.rows) &&
        (value.stubsExcluded === undefined || isCount(value.stubsExcluded)));

/**
 * Whether a value is one page list's result: either a failure, with its
 * `reason`, or a list, with its Markdown, its page count and what it says
 * when empty.
 */
const isPageListResult = (value) =>
    isObject(value) &&
    isFlag(value.allowEmpty) &&
    (isMessage(value.reason) ||
        (value.reason === undefined &&
            typeof value.markdown === "string" &&
            isCount(value.pages) &&
            (value.empty === undefined || typeof value.empty === "string")));

/** Whether a value is an anchor as a page's index carries it. */
const isAnchor = (value) => isObject(value) && typeof value.slug === "string";

/** Whether a value is a declared section the expander inserts. */
const isDeclared = (value) =>
    isObject(value) &&
    typeof value.slug === "string" &&
    typeof value.heading === "string" &&
    typeof value.markdown === "string";

/** Whether a value is an automatic lexical section the expander inserts. */
const isLexical = (value) =>
    isObject(value) &&
    typeof value.slug === "string" &&
    typeof value.heading === "string" &&
    Array.isArray(value.aliases) &&
    isObject(value.result) &&
    Array.isArray(value.result.columns) &&
    Array.isArray(value.result.rows) &&
    isObject(value.options);

/**
 * Whether a value is one note's query-table results, as
 * {@link module:engine/sql-tables.prepareTreeSqlTables} keys them by note:
 * an array of table results, carrying its anchors, generated and declared
 * sections, lexical lists and Foundry anchor maps beside them.
 */
const isRows = (value) =>
    value === undefined ||
    (Array.isArray(value) &&
        value.every(isTableResult) &&
        isListOf(value.anchors, isAnchor) &&
        isListOf(value.declared, isDeclared) &&
        isListOf(value.lexical, isLexical) &&
        (value.generated === undefined || typeof value.generated === "string") &&
        (value.anchorUuids === undefined || isObject(value.anchorUuids)) &&
        (value.docAnchorUuids === undefined || isObject(value.docAnchorUuids)));

/** Whether a value is one inline query's answer: a value, or an error's message. */
const isInlineAnswer = (value) =>
    isObject(value) &&
    (Object.hasOwn(value, "error") ? isMessage(value.error) : Object.hasOwn(value, "value"));

/** Whether a value is one note's stored query answers, every container and result its own type. */
const isAnswers = (value) =>
    isObject(value) &&
    value.kind === ANSWERS &&
    isRows(value.rows) &&
    (value.inline === undefined ||
        (value.inline instanceof Map &&
            [...value.inline].every(
                ([query, answer]) => typeof query === "string" && isInlineAnswer(answer),
            ))) &&
    isListOf(value.pageLists, isPageListResult);

/** Whether a value is the tree's parses: each note's file to its parse and text. */
const isParses = (value) =>
    value instanceof Map &&
    [...value].every(
        ([file, parse]) =>
            typeof file === "string" && isParse(parse) && typeof parse.raw === "string",
    );

/**
 * One note's part of a preparation.
 *
 * @param {Map<string, object[]>|undefined} prepared - From
 *   {@link module:engine/sql-tables.prepareTreeSqlTables}.
 * @param {string} file - The note.
 * @returns {{kind: string, rows?: object[], inline?: unknown, pageLists?: unknown}} Its answers.
 */
function answersOf(prepared, file) {
    return {
        kind: ANSWERS,
        rows: prepared?.get(file),
        inline: prepared?.inline?.get(file),
        pageLists: prepared?.pageLists?.get(file),
    };
}

/**
 * What a note that links another needs of its answers, for answers the cache
 * cannot hold whole: everything but the automatic lexical lists, whose
 * rendering options are functions. The lists add dictionary and glossary
 * entries and their anchors; the anchors are kept, in `anchors`, and the
 * entries hold no figure, so a linked note's anchors and figures read the
 * same from this view. The view is stored marked `linkedOnly`, and the note
 * itself is always prepared again when it is the one rendered.
 *
 * @param {ReturnType<typeof answersOf>} answers - One note's answers.
 * @returns {ReturnType<typeof answersOf> & {linkedOnly: true}} The view.
 */
function linkedView(answers) {
    const rows = answers.rows && Object.assign([...answers.rows], answers.rows);
    if (rows) delete rows.lexical;
    return { ...answers, rows, linkedOnly: true };
}

/**
 * Several notes' answers as one preparation, shaped as
 * {@link module:engine/sql-tables.prepareTreeSqlTables} returns it.
 *
 * @param {Map<string, ReturnType<typeof answersOf>>} byFile - Each note's answers.
 * @returns {Map<string, object[]>} The preparation.
 */
function preparedOf(byFile) {
    const prepared = /** @type {Map<string, object[]> & {inline: Map, pageLists: Map}} */ (
        new Map()
    );
    prepared.inline = new Map();
    prepared.pageLists = new Map();
    for (const [file, answers] of byFile) {
        if (answers.rows !== undefined) prepared.set(file, answers.rows);
        if (answers.inline !== undefined) prepared.inline.set(file, answers.inline);
        if (answers.pageLists !== undefined) prepared.pageLists.set(file, answers.pageLists);
    }
    return prepared;
}

/**
 * What a note of a package renders against.
 *
 * @typedef {object} NoteTree
 * @property {object[]} records - The tree's index records, as
 *   {@link module:engine/content-index.indexRecordsFor} derives them.
 * @property {{index: Map<string, object>}} foreign - The dependencies'
 *   indexes, as {@link module:engine/metadata-index.loadForeignIndexes}
 *   returns them: the very ones the records were derived with.
 * @property {(files: Iterable<string>, own?: string) => Promise<{sqlTables: Map<string, object[]>, tables: "hit"|"miss"|"off"}>} answers -
 *   The query answers and generated sections of the notes named, by absolute
 *   path, as {@link module:engine/sql-tables.prepareTreeSqlTables} prepares
 *   them; `tables` is `"hit"` when every one was read from the store. `own`
 *   is the note being rendered, whose answers are always whole; every other
 *   note named may be answered with the view a linking note needs. Rejects
 *   with {@link NoteInputsChanged}, storing nothing, when the configuration,
 *   fonts or dependency indexes are not the ones the records were derived
 *   from, before or after the preparation.
 * @property {(file: string) => string} textOf - A note's text, as the records
 *   were derived from it.
 * @property {{tree: "hit"|"miss"|"off", notes: number}} cache - What the
 *   cache answered: the tree's records whole or not, and how many notes
 *   derived their own records.
 */

/**
 * The content tree's records, and its notes' query answers on demand, from
 * the cache under `build/` while every input they were derived from is
 * unchanged, and derived and stored otherwise.
 *
 * The dependencies' indexes are read here, between two readings of every
 * input the store keys by: when the two differ, something changed while it
 * was read, and the whole reading is done again, so what is stored is always
 * derived from the bytes its key names.
 *
 * @param {object} config - The resolved configuration.
 * @param {object} [options]
 * @param {boolean} [options.cache=true] - Whether to read and write the
 *   cache; `false` derives everything and touches nothing.
 * @param {string} [options.toolchain] - The toolchain's fingerprint;
 *   {@link toolchainFingerprint} by default.
 * @param {typeof import("./sql-tables.mjs").prepareTreeSqlTables} [options.prepareTables] -
 *   Prepares query answers; {@link module:engine/sql-tables.prepareTreeSqlTables}
 *   by default.
 * @param {typeof loadForeignIndexes} [options.loadForeign] - Reads the
 *   dependencies' indexes; {@link module:engine/metadata-index.loadForeignIndexes}
 *   by default.
 * @returns {Promise<NoteTree>} The records, the indexes, the answers and what
 *   the cache did.
 * @throws {Error} As the derivation does: a note that cannot be indexed, a
 *   dependency that has not been fetched or cannot be read, naming
 *   `package-build deps fetch`; and when the inputs keep changing while they
 *   are read.
 */
export async function noteTree(
    config,
    {
        cache = true,
        toolchain = cache ? toolchainFingerprint() : "",
        loadForeign = loadForeignIndexes,
        prepareTables,
    } = {},
) {
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
        const read = await readTree(config, { cache, toolchain, loadForeign, prepareTables });
        if (read) return read;
    }
    throw new NoteInputsChanged(
        `the configuration, fonts or dependency indexes of ${config.rootDir} changed ` +
            `while they were read, ${READ_ATTEMPTS} times; render again once they are settled`,
    );
}

/** The error a reading raises when its inputs moved while it was read. */
export class NoteInputsChanged extends Error {}

/**
 * The error for inputs that moved while a reading was under way.
 *
 * @param {{rootDir: string}} config - The resolved configuration.
 * @returns {NoteInputsChanged} The error.
 */
function inputsChanged(config) {
    return new NoteInputsChanged(
        `the configuration, fonts or dependency indexes of ${config.rootDir} changed ` +
            "while they were read",
    );
}

/**
 * The tree's parses, from the texts its key was taken over, for a store whose
 * own parses cannot be used.
 *
 * @param {Map<string, {raw: string}>} texts - Every note's text, by absolute path.
 * @returns {Map<string, object>} Each note's parse.
 */
function parsesOf(texts) {
    return new Map(
        [...texts].map(([file, { raw }]) => [
            file,
            parseMarkdownFile(file, { raw, renderDescription: false }),
        ]),
    );
}

/** How often a reading is done again when its inputs move under it. */
export const READ_ATTEMPTS = 3;

/**
 * The dependencies' indexes, refused when one is unusable.
 *
 * @param {object} config - The resolved configuration.
 * @param {typeof loadForeignIndexes} loadForeign - Reads them.
 * @returns {ReturnType<typeof loadForeignIndexes>} The indexes.
 */
function readForeign(config, loadForeign) {
    const foreign = loadForeign(config, [config.contentPackage]);
    if (foreign.stale.length)
        throw new Error(
            foreign.stale
                .map((s) => `${s.package}: unusable content index: ${s.reason}`)
                .join("\n") + "\nrun `package-build deps fetch` again",
        );
    return foreign;
}

/**
 * One reading of {@link noteTree}, or nothing when an input changed while it
 * was read.
 *
 * @param {object} config - The resolved configuration.
 * @param {{cache: boolean, toolchain: string, loadForeign: typeof loadForeignIndexes,
 *   prepareTables?: typeof import("./sql-tables.mjs").prepareTreeSqlTables}} options
 * @returns {Promise<NoteTree|undefined>} The reading.
 */
async function readTree(config, { cache, toolchain, loadForeign, prepareTables }) {
    readArtLock(config);
    const { indexRecordsFor } = await import("./content-index.mjs");
    const prepareTreeSqlTables =
        prepareTables ?? (await import("./sql-tables.mjs")).prepareTreeSqlTables;
    const contentBase = path.resolve(config.paths.content);
    const skipDirectories = config.skipDirectories;
    if (cache && configMovedOn(config)) throw inputsChanged(config);
    const before = cache ? packageFingerprint(config) : "";
    const art = collectArtMasters(config.art?.masterRoots ?? [], config.contentPackage, {
        componentRoots: config.art?.componentRoots,
    });
    if (art.findings.length) throw new Error(art.findings.map(formatDiagnostic).join("\n"));
    const masterRecords = masterAssetRecords(art.masters);
    const prepare = (records, parsed, files) =>
        prepareTreeSqlTables(contentBase, {
            config,
            skipDirectories,
            records,
            parsed,
            audience: "public",
            foreignIndex: foreign.index,
            only: new Set(files),
        });

    // A configuration the file has moved on from is the caller's to resolve
    // again; reading the tree again with it would answer the same way.
    const foreign = readForeign(config, loadForeign);
    if (cache && packageFingerprint(config) !== before) return undefined;

    if (!cache) {
        const parsed = new Map();
        const records = indexRecordsFor({
            contentBase,
            config,
            skipDirectories,
            parsed,
            foreignIndex: foreign.index,
            masterRecords,
        });
        return {
            records,
            foreign,
            answers: async (files) => {
                const wanted = [...new Set(files)];
                const prepared = await prepare(records, parsed, wanted);
                return {
                    sqlTables: preparedOf(
                        new Map(wanted.map((file) => [file, answersOf(prepared, file)])),
                    ),
                    tables: "off",
                };
            },
            textOf: (file) => fs.readFileSync(file, "utf8"),
            cache: { tree: "off", notes: parsed.size },
        };
    }

    const dir = noteCacheDirectory(config);
    const inputs = digest(toolchain, before, contentBase);
    const texts = new Map();
    for (const file of walkMarkdownFiles(contentBase, { skipDirectories })) {
        const raw = fs.readFileSync(file, "utf8");
        texts.set(file, { raw, hash: digest(raw) });
    }
    // The asset records themselves, which are all the tree's assets give the
    // derivation.
    const assets = packIfCacheable(
        config.paths.assets ?
            collectAssetRecords(path.resolve(config.paths.assets), {
                contentPackage: config.contentPackage,
                problems: [],
                masterRecords,
            })
        :   [],
    );
    const treeKey = digest(
        inputs,
        assets ?? crypto.randomUUID(),
        ...[...texts]
            .map(([file, { hash }]) => [path.relative(contentBase, file), hash])
            .sort(([a], [b]) =>
                a < b ? -1
                : a > b ? 1
                : 0,
            )
            .flat(),
    );
    const treeFile = path.join(dir, "tree.v8");
    const textOf = (file) => texts.get(file)?.raw ?? fs.readFileSync(file, "utf8");

    /**
     * The answers for `files`: each from the store when it holds them, the
     * rest prepared together and added to it.
     *
     * @param {object[]} records - The records.
     * @param {() => Map<string, object>|undefined} parsedOf - The parses, when
     *   they can be had.
     * @param {Record<string, any>} store - What `tree.v8` holds or will hold.
     * @param {Iterable<string>} files - The notes, by absolute path.
     */
    const answersFor = async (records, parsedOf, store, files, own) => {
        const wanted = [...new Set(files)];
        const byFile = new Map();
        const missing = [];
        for (const file of wanted) {
            const kept = /** @type {any} */ (
                unpackChecked(store.tables.get(path.relative(contentBase, file)), isAnswers)
            );
            // A linked note's view serves only a note that links it.
            if (kept && !(kept.linkedOnly && file === own)) byFile.set(file, kept);
            else missing.push(file);
        }
        if (missing.length) {
            // The preparation reads the dependency indexes again, so it must
            // read the bytes the records were derived from.
            const moved = () => configMovedOn(config) || packageFingerprint(config) !== before;
            if (moved()) throw inputsChanged(config);
            const prepared = await prepare(records, parsedOf(), missing);
            if (moved()) throw inputsChanged(config);
            let added = false;
            for (const file of missing) {
                const answers = answersOf(prepared, file);
                byFile.set(file, answers);
                const packed = packIfCacheable(answers) ?? packIfCacheable(linkedView(answers));
                if (packed) {
                    store.tables.set(path.relative(contentBase, file), packed);
                    added = true;
                }
            }
            if (added && store.writable) {
                const { writable: _, ...kept } = store;
                writeStore(treeFile, kept);
            }
        }
        return { sqlTables: preparedOf(byFile), tables: missing.length ? "miss" : "hit" };
    };

    const tree = readStore(treeFile, treeKey);
    const records =
        tree && tree.tables instanceof Map ? unpackChecked(tree.records, isRecords) : undefined;
    if (records) {
        const store = { ...tree, writable: true };
        let parsed;
        return {
            records: loadPinnedArt(config, /** @type {object[]} */ (records)).records,
            foreign,
            answers: (files, own) =>
                answersFor(
                    /** @type {object[]} */ (records),
                    () =>
                        (parsed ??=
                            /** @type {Map<string, object>|undefined} */ (
                                unpackChecked(tree.parsed, isParses)
                            ) ?? parsesOf(texts)),
                    store,
                    files,
                    own,
                ),
            textOf,
            cache: { tree: "hit", notes: 0 },
        };
    }

    const notesFile = path.join(dir, "notes.v8");
    const memo = noteMemo(readStore(notesFile, inputs), texts, contentBase);
    const parsed = new Map();
    const derived = indexRecordsFor({
        contentBase,
        config,
        skipDirectories,
        parsed,
        foreignIndex: foreign.index,
        cache: memo,
        masterRecords,
    });
    if (configMovedOn(config)) throw inputsChanged(config);
    if (packageFingerprint(config) !== before) return undefined;
    const notes = memo.changes();
    if (notes) writeStore(notesFile, { key: inputs, notes });
    const packedRecords = packIfCacheable(derived);
    const packedParsed = packIfCacheable(parsed);
    const store = {
        key: treeKey,
        records: packedRecords,
        parsed: packedParsed,
        tables: new Map(),
        writable: Boolean(packedRecords && packedParsed),
    };
    if (store.writable) {
        const { writable: _, ...kept } = store;
        writeStore(treeFile, kept);
    }
    return {
        records: derived,
        foreign,
        answers: (files, own) => answersFor(derived, () => parsed, store, files, own),
        textOf,
        cache: { tree: "miss", notes: memo.derived },
    };
}
