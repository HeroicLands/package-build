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
 * Whether the keys a package **references** and the keys it **declares** are
 * the same set.
 *
 * A missing key renders in the interface as its own raw key string; a key
 * nothing references is dead weight a translator is nonetheless asked to
 * translate. Both are invisible until someone plays in another language, which
 * is to say invisible.
 *
 * The two directions are deliberately not the same severity:
 *
 * - **A referenced key that is not declared is an error.** Something will
 *   render as `SOHL.Skill.label` to a player.
 * - **A declared key nothing references is advisory.** No scan can see every
 *   way a key is reached — a prefix held in a variable, a value read back out
 *   of a document — so a package that ships one is not broken, and refusing to
 *   ship it over one would teach everybody to switch the guard off.
 *
 * **What is generic, and what is not.** `{{localize}}`, `game.i18n.localize`,
 * a key in a string literal, a key built from a template literal, a DataModel's
 * `LOCALIZATION_PREFIXES` — those are Foundry, and they live here. A repository
 * that *generates* keys by a convention of its own (Song of Heroic Lands mints
 * one per member of an enum) contributes them through a module it names in
 * configuration, the same shape as `assetTransform` and `manifestFlags`: only
 * that repository can know the rule, and only this package can compare the
 * result against the file.
 *
 * Everything here is pure — source text in, references or findings out.
 *
 * @module
 */

import ts from "typescript";
import { positionOfLiteral } from "./engine/diagnostics.mjs";

/**
 * One place a key is referenced, and how firmly.
 *
 * @typedef {object} KeyReference
 * @property {string} key - The localization key, in full.
 * @property {string} file - Where it is referenced, relative to the repository
 *   root — the reference is the finding's site, not the localization file.
 * @property {number} [line] - 1-based line, when it can be established.
 * @property {number} [column] - 1-based column, likewise.
 * @property {boolean} [exact] - When true the key must be declared verbatim,
 *   even if it happens to be a prefix of keys that are. A *generated* key is
 *   minted whole, so keys sitting beneath it do not vouch for it; an ordinary
 *   textual reference to a family name does not have that property.
 * @property {string} [origin] - The verb phrase naming how the key is
 *   referenced, for the message: `references` by default, so a contributor of
 *   generated keys can say `defineType generates` instead.
 */

/**
 * Everything one scan learned about how a file addresses localization.
 *
 * @typedef {object} ReferenceSet
 * @property {KeyReference[]} keys - Concrete keys, each at its site.
 * @property {string[]} namespaces - Prefixes whose leaves are never named in
 *   source: a DataModel's `LOCALIZATION_PREFIXES`, the static head of a key
 *   built at runtime. A namespace vouches for *itself* being reachable, never
 *   for the keys beneath it.
 * @property {string[]} patterns - Key shapes a dynamic construction can build,
 *   with `*` standing for one segment: `` `SOHL.Month.${i}.label` `` is
 *   `SOHL.Month.*.label`, and vouches for exactly what that expression can
 *   produce.
 * @property {CoverageFinding[]} findings - What the scan could not resolve, in
 *   its own words.
 */

/**
 * A finding about coverage.
 *
 * Unlike the rules in {@link module:lang}, these carry their own `file`: one
 * run spans the localization file and every source that references it, so a
 * single path supplied by the caller could not be right for all of them.
 *
 * @typedef {object} CoverageFinding
 * @property {string} file - Path the finding is about.
 * @property {number} [line] - 1-based line, when known.
 * @property {number} [column] - 1-based column, when known.
 * @property {"error"|"warning"} severity - How it should be treated.
 * @property {string} message - What is wrong, in one sentence.
 */

/** A key segment carries only these characters. */
const SEGMENT_CHARS = "[A-Za-z0-9_]";

/**
 * Escape a string for literal use inside a `RegExp`.
 *
 * @param {string} text - The literal.
 * @returns {string} It, with every metacharacter escaped.
 */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The roots a set of declared keys uses.
 *
 * Derived rather than configured by default, because a package's roots are
 * already a fact about its localization file — asking for them again is one
 * more thing to state and to get wrong. A repository states them only when it
 * references a root the file does not yet declare at all.
 *
 * @param {Iterable<string>} keys - The declared keys.
 * @returns {string[]} The distinct first segments, in name order.
 */
export function keyRootsOf(keys) {
    const roots = new Set();
    for (const key of keys) {
        const root = key.split(".")[0];
        if (root) roots.add(root);
    }
    return [...roots].sort();
}

/**
 * The two patterns every scan works from, built for one set of roots.
 *
 * The alternation is ordered longest first: it is tried in order, so `TYPE`
 * ahead of `TYPES` would claim the first four characters of every `TYPES.…`
 * key and leave the `S` to be read as the start of a segment.
 *
 * @param {readonly string[]} roots - The key roots.
 * @returns {{whole: RegExp, scan: RegExp}} `whole` tests a complete string;
 *   `scan` finds tokens inside a longer text.
 */
function patternsFor(roots) {
    const alternation = roots
        .slice()
        .sort((a, b) => b.length - a.length || a.localeCompare(b))
        .map(escapeRegExp)
        .join("|");
    const body = `(?:${alternation})\\.${SEGMENT_CHARS}+(?:\\.${SEGMENT_CHARS}+)*`;
    return {
        whole: new RegExp(`^${body}$`),
        // Not preceded by a word character or a dot, so the `TYPES.base` inside
        // Foundry's own `BEHAVIOR.TYPES.base` is not read as a key of this
        // package's.
        scan: new RegExp(`(?<![A-Za-z0-9_.])${body}`, "g"),
    };
}

/**
 * An empty reference set, for a caller with nothing to contribute.
 *
 * @returns {ReferenceSet} The set.
 */
function emptySet() {
    return { keys: [], namespaces: [], patterns: [], findings: [] };
}

/**
 * Where an offset sits in a text.
 *
 * @param {string} source - The text.
 * @param {number} index - A 0-based offset into it.
 * @returns {{line: number, column: number}} The 1-based position.
 */
function positionAt(source, index) {
    const before = source.slice(0, index);
    return {
        line: before.split("\n").length,
        column: index - before.lastIndexOf("\n"),
    };
}

/**
 * The static namespace a dynamically built key belongs to.
 *
 * `SOHL.Actor.` yields `SOHL.Actor`; a head that stops mid-segment because a
 * substitution completes it (`SOHL.Actor.Skill`) yields `SOHL.Actor`.
 *
 * @param {string} head - The literal text before the first substitution.
 * @param {readonly string[]} roots - The key roots.
 * @returns {string|null} The namespace, or `null` when it is not under a root.
 */
function namespaceOfHead(head, roots) {
    const text = head.replace(/[A-Za-z0-9_]*$/, "").replace(/\.$/, "");
    const under = roots.some((r) => text === r || text.startsWith(`${r}.`));
    return text && under ? text : null;
}

/**
 * The key shape a literal can produce, with `*` standing for one segment.
 *
 * A trailing dot is a substitution too — `'SOHL.Skill.' + kind` builds exactly
 * what a template literal would, and the guard should not care which spelling a
 * file used.
 *
 * @param {string} literal - Literal text, substitutions written as `${…}`.
 * @returns {string|null} The pattern, or `null` when nothing is substituted.
 */
function shapeOf(literal) {
    if (literal.includes("${")) return literal.replace(/\$\{[^}]*\}/g, "*");
    return literal.endsWith(".") ? `${literal}*` : null;
}

/**
 * Read every localization reference out of a script.
 *
 * The **AST**, not the text, because a key named in a JSDoc `@example` is
 * documentation: requiring it to exist would make the guard fail on prose, and
 * counting it as a reference would let a comment keep a dead key alive.
 *
 * TypeScript's parser reads plain JavaScript too, so both go down one path
 * rather than two that drift.
 *
 * @param {string} source - The file's contents.
 * @param {object} options
 * @param {string} options.file - Path to the file, for the findings.
 * @param {readonly string[]} options.roots - The key roots.
 * @returns {ReferenceSet} What the file references.
 */
export function collectScriptReferences(source, { file, roots }) {
    const { whole, scan } = patternsFor(roots);
    const result = emptySet();
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

    // `parseDiagnostics` is TypeScript's own and not part of its published
    // surface, hence the guard. A file that does not parse contributes no
    // references at all, which would quietly read as "needs nothing and
    // declares nothing" — worth saying out loud wherever it can be.
    const parseErrors = sourceFile.parseDiagnostics ?? [];
    if (parseErrors.length) {
        const [first] = parseErrors;
        result.findings.push({
            file,
            ...positionAt(source, first.start ?? 0),
            severity: "error",
            message:
                "does not parse, so its localization keys cannot be read: " +
                ts.flattenDiagnosticMessageText(first.messageText, " "),
        });
        return result;
    }

    /**
     * Record a concrete key, located by searching the node it came from.
     *
     * @param {string} key - The key.
     * @param {number} from - Offset to search from — the node's own start, so
     *   an earlier occurrence elsewhere in the file is not credited to it.
     */
    const addKey = (key, from) => {
        const at = source.indexOf(key, from);
        result.keys.push({
            key,
            file,
            ...(at === -1 ? {} : positionAt(source, at)),
        });
    };

    /**
     * Whether a node is a string with no substitutions in it.
     *
     * @param {ts.Node|undefined} node - The node.
     * @returns {boolean} Whether its `.text` is the whole literal.
     */
    const isPlainString = (node) =>
        Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));

    /**
     * Read the concrete keys out of one literal chunk of a template.
     *
     * A chunk that abuts a substitution is *open* at that end, and a token
     * touching an open end is only half a key — the expression completes it.
     * Crediting it anyway invents a key the file does not contain
     * (`SOHL.Skill.Action.` from `` `SOHL.Skill.Action.${kind}Test` ``) and
     * then reports it missing.
     *
     * @param {string} chunk - The literal text.
     * @param {object} ends
     * @param {boolean} ends.openStart - Whether a substitution precedes it.
     * @param {boolean} ends.openEnd - Whether one follows it.
     * @param {number} from - Offset to locate the keys from.
     */
    const addChunkKeys = (chunk, { openStart, openEnd }, from) => {
        for (const match of chunk.matchAll(scan)) {
            const start = match.index ?? 0;
            if (openStart && start === 0) continue;
            // A trailing dot is not a segment, so a token followed by only one
            // is touching the end just as much as a token flush against it.
            if (openEnd && /^\.?$/.test(chunk.slice(start + match[0].length))) {
                continue;
            }
            addKey(match[0], from);
        }
    };

    /** Elements of a `LOCALIZATION_PREFIXES` array, which are not keys. */
    const prefixLiterals = new Set();

    const visit = (node) => {
        if (ts.isStringLiteral(node) && whole.test(node.text) && !prefixLiterals.has(node)) {
            addKey(node.text, node.getStart());
        }

        // A template with no substitutions is one closed chunk. Its keys are
        // not string-literal nodes — inline markup in a helper puts them inside
        // the literal's text — so they would otherwise be invisible.
        if (ts.isNoSubstitutionTemplateLiteral(node)) {
            addChunkKeys(node.text, { openStart: false, openEnd: false }, node.getStart());
        }

        if (ts.isTemplateExpression(node)) {
            const spans = node.templateSpans;
            addChunkKeys(node.head.text, { openStart: false, openEnd: true }, node.getStart());
            spans.forEach((span, index) => {
                addChunkKeys(
                    span.literal.text,
                    { openStart: true, openEnd: index < spans.length - 1 },
                    node.getStart(),
                );
            });

            const namespace = namespaceOfHead(node.head.text, roots);
            if (namespace) {
                result.namespaces.push(namespace);
                let literal = node.head.text;
                for (const span of node.templateSpans) {
                    literal += "${}" + span.literal.text;
                }
                const pattern = shapeOf(literal);
                if (pattern) result.patterns.push(pattern);
            }
        }

        // A DataModel names the prefix and Foundry localizes the leaves under
        // it, so those leaves are never named in any source file.
        if (
            (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) &&
            node.name?.getText(sourceFile).replace(/["']/g, "") === "LOCALIZATION_PREFIXES" &&
            node.initializer &&
            ts.isArrayLiteralExpression(node.initializer)
        ) {
            for (const element of node.initializer.elements) {
                if (!isPlainString(element)) continue;
                // A prefix names a family; Foundry mints the leaves. Counting
                // it as a concrete key as well would let a DataModel's
                // declaration vouch for a key of the same name.
                prefixLiterals.add(element);
                result.namespaces.push(element.text);
            }
        }

        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    return result;
}

/**
 * Read every localization reference out of a template.
 *
 * A text scan, because a template has no AST worth building for this: its keys
 * sit in `{{localize "…"}}` calls and in helper hashes, and nothing in a `.hbs`
 * file resembles a comment closely enough to mislead one.
 *
 * @param {string} source - The file's contents.
 * @param {object} options
 * @param {string} options.file - Path to the file, for the findings.
 * @param {readonly string[]} options.roots - The key roots.
 * @returns {ReferenceSet} What the template references.
 */
export function collectTemplateReferences(source, { file, roots }) {
    const { scan } = patternsFor(roots);
    const result = emptySet();

    for (const match of source.matchAll(scan)) {
        const token = match[0];
        const index = match.index ?? 0;
        const rest = source.slice(index + token.length);

        // The token is a *prefix* when something is appended to it: a
        // substitution, or a literal that stops on a dot.
        if (!/^(?:\$\{|\.(?:\$\{|["'`]))/.test(rest)) {
            result.keys.push({
                key: token,
                file,
                ...positionAt(source, index),
            });
            continue;
        }

        // A substitution written directly against the token completes its last
        // segment, so the namespace is one segment shorter than the token.
        const namespace = rest.startsWith("${") ? token.replace(/\.[A-Za-z0-9_]*$/, "") : token;
        result.namespaces.push(namespace);

        // Recover the whole literal so its shape, not merely its head, decides
        // what it vouches for. The quote that opened it is the character before
        // the token; without one there is nothing to recover, and the namespace
        // stands alone.
        const quote = source[index - 1];
        if (quote === "'" || quote === '"' || quote === "`") {
            const end = source.indexOf(quote, index);
            const pattern = shapeOf(source.slice(index, end === -1 ? undefined : end));
            if (pattern) result.patterns.push(pattern);
        }
    }

    return result;
}

/**
 * Combine reference sets into one.
 *
 * Keys are kept whole — every site that references a missing key is worth
 * naming — while namespaces and patterns are de-duplicated, since neither says
 * anything about where it came from.
 *
 * @param {Iterable<ReferenceSet>} sets - The sets to combine.
 * @returns {ReferenceSet} One set holding all of them.
 */
export function mergeReferences(sets) {
    const merged = emptySet();
    const namespaces = new Set();
    const patterns = new Set();
    for (const set of sets) {
        merged.keys.push(...(set.keys ?? []));
        merged.findings.push(...(set.findings ?? []));
        for (const namespace of set.namespaces ?? []) namespaces.add(namespace);
        for (const pattern of set.patterns ?? []) patterns.add(pattern);
    }
    merged.namespaces = [...namespaces];
    merged.patterns = [...patterns];
    return merged;
}

/**
 * Turn a key pattern into the expression that matches what it can build.
 *
 * @param {string} pattern - A shape, `*` standing for one segment.
 * @returns {RegExp} The matcher.
 */
function matcherFor(pattern) {
    return new RegExp(`^${pattern.split("*").map(escapeRegExp).join("[^.]+")}$`);
}

/**
 * Compare what a package declares against what it references.
 *
 * @param {object} options
 * @param {string} options.langSource - The reference localization file's text.
 * @param {string} options.langFile - Its path, for the findings about it.
 * @param {ReferenceSet} options.references - Everything that references it.
 * @param {readonly string[]} [options.retained] - Key prefixes to leave out of
 *   the advisory half. Each is a repository's statement that the keys under it
 *   are reached in a way no scan can see; the honest fix for an unreferenced
 *   key is still to delete it.
 * @param {readonly string[]} [options.roots] - The key roots. Derived from the
 *   declared keys when absent.
 * @returns {{findings: CoverageFinding[], unreferenced: CoverageFinding[],
 *   stats: object}} What must be fixed, what is merely worth reading, and what
 *   the run looked at. The two are separate because they are different
 *   questions: one says the package is broken, the other that it carries
 *   something nobody could see a use for.
 */
export function analyzeCoverage({ langSource, langFile, references, retained = [], roots }) {
    let declared;
    try {
        declared = JSON.parse(langSource);
    } catch (err) {
        // Nothing further can be said about a file that does not parse, and
        // every key in the package would otherwise report as undeclared.
        return {
            findings: [
                {
                    file: langFile,
                    severity: "error",
                    message: `not valid JSON: ${err.message}`,
                },
            ],
            unreferenced: [],
            stats: {
                declared: 0,
                referenced: 0,
                namespaces: 0,
                patterns: 0,
                missing: 0,
                unreferenced: 0,
            },
        };
    }

    const declaredKeys = Object.keys(declared);
    const declaredSet = new Set(declaredKeys);
    const known = roots ?? keyRootsOf(declaredKeys);
    const namespaces = new Set(references.namespaces ?? []);

    /**
     * Whether a token is a family name rather than a key in its own right.
     *
     * @param {string} token - The referenced token.
     * @returns {boolean} Whether it is declared as a namespace, or something
     *   declared sits beneath it.
     */
    const isNamespace = (token) => {
        if (namespaces.has(token)) return true;
        const prefix = `${token}.`;
        for (const key of declaredSet) if (key.startsWith(prefix)) return true;
        return false;
    };

    const missing = [];
    const seen = new Set();
    for (const reference of references.keys ?? []) {
        const { key, file } = reference;
        if (declaredSet.has(key)) continue;
        if (!reference.exact && isNamespace(key)) continue;
        // One finding per site, not per occurrence: a file that localizes the
        // same missing key in six rows is one thing to fix.
        const site = `${key} ${file}`;
        if (seen.has(site)) continue;
        seen.add(site);
        missing.push({
            file,
            ...(reference.line === undefined ? {} : { line: reference.line }),
            ...(reference.line !== undefined && reference.column !== undefined ?
                { column: reference.column }
            :   {}),
            severity: "error",
            message:
                `${reference.origin ?? "references"} "${key}", which ` +
                `${langFile} does not declare`,
        });
    }

    const referenced = new Set((references.keys ?? []).map((reference) => reference.key));
    const shapes = (references.patterns ?? []).map(matcherFor);
    // Foundry localizes a DataModel's field labels and hints off the declared
    // prefix, so no source names them one by one.
    const fieldShapes = [...namespaces].map(
        (namespace) =>
            new RegExp(
                `^${escapeRegExp(namespace)}\\.FIELDS\\.` + `[A-Za-z0-9_.]+\\.(?:label|hint)$`,
            ),
    );

    const isReferenced = (key) =>
        referenced.has(key) ||
        shapes.some((shape) => shape.test(key)) ||
        fieldShapes.some((shape) => shape.test(key));
    const isRetained = (key) => retained.some((prefix) => key === prefix || key.startsWith(prefix));

    const unreferenced = declaredKeys
        .filter((key) => known.some((root) => key === root || key.startsWith(`${root}.`)))
        .filter((key) => !isReferenced(key) && !isRetained(key))
        .map((key) => ({
            file: langFile,
            ...positionOfLiteral(langSource, `"${key}"`),
            severity: "warning",
            message: `key "${key}" is unreferenced`,
        }));

    return {
        findings: [...missing, ...(references.findings ?? [])],
        unreferenced,
        stats: {
            declared: declaredKeys.length,
            referenced: referenced.size,
            namespaces: namespaces.size,
            patterns: shapes.length,
            missing: missing.length,
            unreferenced: unreferenced.length,
        },
    };
}
