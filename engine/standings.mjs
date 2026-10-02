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
 * **A being's standing, held in the body that confers it.**
 *
 * `data.affiliations` is a map keyed by the affiliation's Address, and each
 * entry carries the standing the being holds *in that body*:
 *
 * ```yaml
 * data:
 *     affiliations:
 *         vrystwldtrbs: { rank: 5, office: War Chief }
 *         greenwardens: { rank: 1 }
 * ```
 *
 * The key is what makes the pair expressible. A being in two bodies holds a
 * standing in each, two bodies may name a rung the same word, and both facts
 * are about one membership rather than about the being at large.
 *
 * **`rank` is a number, not a link.** The body declares `{level, title,
 * description}` for every rung of its `governance.ranks`, so a number indexes
 * into that ladder and the body stays the single source for what its level 5 is
 * called. **`office` is a string**, matched against the keys of the body's
 * `governance.offices` map: there are far more offices in a tree than bodies,
 * most of them held by one body alone, and an Address would make writing the
 * fact wait on authoring a page about the post.
 *
 * Both are resolved against the one affiliation the entry is keyed by, which is
 * what lets each be checked — a rung the body does not confer and an office it
 * does not hold are both findings naming the file, line and column.
 *
 * @module
 */

import { acceptsType, isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { AddressEntries } from "./address-values.mjs";
import { slugify } from "./content-slug.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { STANDING_BODY_TYPES, STANDING_KEYS } from "./standing-terms.mjs";

export { STANDING_BODY_TYPES, STANDING_KEYS };

/** Whether a value is a plain mapping. */
function mapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The standings a being authored, in one shape whichever shape it wrote.
 *
 * The list form names bodies and no standings; the map form names both. Three
 * spellings reach here and every reader downstream takes the same entries, so
 * none of them asks which it was handed:
 *
 * - an **{@link AddressEntries}** — the map after the note boundary decoded its
 *   keys into typed Addresses, which is the shape every compile sees;
 * - a **plain map**, which is the shape a checker reading raw YAML sees;
 * - a **list**, which names bodies and says nothing about standing in them.
 *
 * An emptied map arrives from the property editor as `[]` and means what `{}`
 * means — this being authors no membership — so both read as no entries.
 *
 * Each entry carries `body` for a message and `sourceKey` for a position: the
 * authored key is what a reader has to find in the file, and the decoded
 * Address is what a finding should name.
 *
 * @param {unknown} value - The authored `data.affiliations`.
 * @returns {{form: "absent"|"list"|"map"|"malformed",
 *   entries: Array<{body: unknown, sourceKey: string|number, standing: unknown}>}}
 *   The form it was written in, and its entries.
 */
export function readStandings(value) {
    if (value === undefined || value === null) return { form: "absent", entries: [] };
    if (value instanceof AddressEntries) {
        return {
            form: "map",
            entries: value.entries.map((entry) => ({
                body: entry.target,
                sourceKey: entry.sourceKey,
                standing: entry.value,
            })),
        };
    }
    if (Array.isArray(value)) {
        // An empty list is an emptied map, not a membership stated as a list.
        if (value.length === 0) return { form: "map", entries: [] };
        return {
            form: "list",
            entries: value.map((body, position) => ({
                body,
                sourceKey: position,
                standing: undefined,
            })),
        };
    }
    if (!mapping(value) || isAddressTuple(value)) return { form: "malformed", entries: [] };
    return {
        form: "map",
        entries: Object.entries(value).map(([body, standing]) => ({
            body,
            sourceKey: body,
            standing,
        })),
    };
}

/**
 * The rungs an affiliation's ladder declares, as level → title.
 *
 * A rung states its own `level`, so the ladder is read by that number rather
 * than by its position in the list: a body may write its rungs in any order,
 * and several start at zero.
 *
 * @param {unknown} ranks - An affiliation's `data.governance.ranks`.
 * @returns {Map<number, string>} Level → the title that level is called.
 */
export function rankLadder(ranks) {
    const ladder = new Map();
    if (!Array.isArray(ranks)) return ladder;
    for (const rung of ranks) {
        if (!mapping(rung)) continue;
        const level = Number(rung.level);
        if (!Number.isFinite(level)) continue;
        if (!ladder.has(level)) ladder.set(level, typeof rung.title === "string" ? rung.title : "");
    }
    return ladder;
}

/**
 * The offices an affiliation names, as key → description.
 *
 * An office is authored either as a bare description or as a `{description,
 * holders}` map, and a reader of the post's name wants the same string from
 * both.
 *
 * @param {unknown} offices - An affiliation's `data.governance.offices`.
 * @returns {Map<string, string>} Office key → its description.
 */
export function officeRoster(offices) {
    const roster = new Map();
    if (!mapping(offices)) return roster;
    for (const [office, value] of Object.entries(offices)) {
        if (typeof value === "string") roster.set(office, value);
        else if (mapping(value))
            roster.set(office, typeof value.description === "string" ? value.description : "");
        else roster.set(office, "");
    }
    return roster;
}

/**
 * The anchor an office's row is addressed by.
 *
 * Declared once, because the row that carries the anchor and the link that
 * reaches it are drawn by different passes: two spellings of the same
 * derivation is a link into a page that offers no such destination.
 *
 * An office whose name reduces to nothing URL-safe has no anchor, and the
 * caller is the one that can say what to do without one.
 *
 * @param {string} office - The office's key, as the body wrote it.
 * @returns {string} The anchor, or `""` where the name carries nothing.
 */
export function officeAnchor(office) {
    const slug = slugify(office);
    return slug ? `office-${slug}` : "";
}

/**
 * What an affiliation lends to a reference to it.
 *
 * A reference's value answers what was found as well as where it is — the same
 * reason a target's `subType` travels with it. A standing is read on the
 * *being*, and what it is called is declared on the *body*, so the ladder and
 * the office roster ride along to the one place that needs them.
 *
 * Nothing rides for a note that declares neither.
 *
 * @param {object} fm - The affiliation note's frontmatter.
 * @returns {{ranks?: Record<string, string>, offices?: Record<string, string>}|undefined}
 *   What a reference carries, or nothing.
 */
export function standingsDigest(fm) {
    const governance = fm?.data?.governance;
    if (!mapping(governance)) return undefined;
    const ladder = rankLadder(governance.ranks);
    const roster = officeRoster(governance.offices);
    if (!ladder.size && !roster.size) return undefined;
    return {
        ...(ladder.size ? { ranks: Object.fromEntries(ladder) } : {}),
        ...(roster.size ? { offices: Object.fromEntries(roster) } : {}),
    };
}

/**
 * How a standing reads beside the body that confers it.
 *
 * The office leads, because it is the more particular of the two: a reader
 * meeting "War Chief" has been told the rung as well. The body closes the
 * phrase, which is the whole point of keying the entry by it — a standing with
 * no body named is the lossy form.
 *
 * No article is supplied. One body's name reads with a "the" in front of it and
 * the next does not, and inventing one is this build editing the corpus.
 *
 * @param {object} standing - `{rank, office}`, either or both absent.
 * @param {string} body - What the body is called.
 * @param {{ranks?: Record<string, string>}} [digest] - The body's ladder.
 * @returns {string} The phrase, or the body's name where no standing is held.
 */
export function standingPhrase(standing, body, digest) {
    const parts = [];
    if (typeof standing?.office === "string" && standing.office.trim())
        parts.push(standing.office.trim());
    const level = Number(standing?.rank);
    if (Number.isFinite(level)) {
        const title = digest?.ranks?.[String(level)];
        parts.push(title ? title : `Rank ${level}`);
    }
    return parts.length ? `${parts.join(", ")}, of ${body}` : body;
}

/**
 * Validate a being's memberships and the standing it holds in each.
 *
 * Four questions, and the last two are what keying the entry by its body buys:
 *
 * 1. the value is a map keyed by Address (or the list this window still takes);
 * 2. every key names an affiliation that resolves, once;
 * 3. a `rank` is a level the named body's `governance.ranks` declares;
 * 4. an `office` is a key of that body's `governance.offices`.
 *
 * Both of the last two are read from the named body's own frontmatter as the
 * lint runs, so a renamed rung or a renamed post fails on every being pointing
 * at it rather than on a list somebody has to remember to edit.
 *
 * @param {object} note - The note.
 * @param {{index?: object}} [options] - The lint's options.
 * @returns {object[]} Located findings.
 */
export function checkStandings(note, { index } = {}) {
    const value = note.fm?.data?.affiliations;
    const { form, entries } = readStandings(value);
    if (form === "absent") return [];
    if (form === "malformed")
        return [
            {
                ...position(note, ["data", "affiliations"]),
                message:
                    "`data.affiliations` must be a map keyed by an affiliation Address, " +
                    "each entry holding that body's standing",
            },
        ];

    const findings = [];
    const seen = new Map();
    // The list form names bodies and has nowhere to put a standing. Its entries
    // are still held to being affiliations that resolve, so a tree part-way
    // through the sweep keeps the check it had.
    const isKey = form === "map";
    for (const { body, sourceKey, standing } of entries) {
        const path = ["data", "affiliations", sourceKey];
        const resolved = resolveBody(note, index, body);
        findings.push(...bodyFindings(note, body, path, isKey, resolved));
        if (resolved.address) {
            if (seen.has(resolved.address)) {
                findings.push({
                    ...position(note, path, isKey),
                    message:
                        `\`data.affiliations\` names ${resolved.address} twice, as ` +
                        `${JSON.stringify(String(seen.get(resolved.address)))} and ` +
                        `${JSON.stringify(String(sourceKey))}; one membership per body`,
                });
                continue;
            }
            seen.set(resolved.address, sourceKey);
        }
        if (!isKey) continue;
        if (standing === undefined || standing === null) continue;
        if (Array.isArray(standing) && standing.length === 0) continue;
        const named = resolved.address ?? String(body);
        if (!mapping(standing)) {
            findings.push({
                ...position(note, path),
                message:
                    `\`data.affiliations\` entry for ${named} must hold that body's standing ` +
                    "as a map of `rank` and `office`, but reads " +
                    JSON.stringify(standing),
            });
            continue;
        }
        for (const key of Object.keys(standing)) {
            if (STANDING_KEYS.includes(key)) continue;
            findings.push({
                ...position(note, [...path, key], true),
                message:
                    `\`data.affiliations\` entry for ${named} has unknown key \`${key}\`; a ` +
                    `standing holds ${STANDING_KEYS.map((name) => `\`${name}\``).join(" and ")}`,
            });
        }
        findings.push(...rankFindings(note, standing, named, path, resolved));
        findings.push(...officeFindings(note, standing, named, path, resolved));
    }
    return findings;
}

/**
 * Where a finding about one authored key sits.
 *
 * @param {object} note - The note.
 * @param {Array<string|number>} path - The frontmatter path.
 * @param {boolean} [key] - Whether the key itself is at fault.
 * @returns {object} The located, error-severity half of a finding.
 */
function position(note, path, key) {
    return {
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", path, key ? { key: true } : undefined),
        severity: "error",
    };
}

/**
 * The affiliation one key or entry names, and what that note declares.
 *
 * @param {object} note - The citing note.
 * @param {object|undefined} index - The lint's address index.
 * @param {unknown} body - The authored Address.
 * @returns {{address?: string, type?: string, reason?: string, fm?: object, missing?: boolean}}
 *   What it names.
 */
function resolveBody(note, index, body) {
    const tuple = parseAddress(
        body,
        {
            package: index?.contentPackage ?? note.fm?.package,
            system: "note",
            type: "affiliation",
            types: index?.types,
            packages: index?.packages,
        },
        { declared: true },
    );
    if (tuple.reason) return { reason: tuple.reason };
    if (!acceptsType(tuple, STANDING_BODY_TYPES)) return { type: tuple.type };
    const address = renderAddress(tuple);
    if (!index?.addressHit) return { address };
    const target = index.addressHit(address);
    if (!target) return { address, missing: true };
    return { address, fm: target.fm ?? target };
}

/** Findings about the body an entry names. */
function bodyFindings(note, body, path, isKey, found) {
    const at = position(note, path, isKey);
    const written = isAddressTuple(body) ? renderAddress(body) : String(body);
    const label = `\`data.affiliations\`${isKey ? " key" : ""} ${JSON.stringify(written)}`;
    if (found.reason)
        return [{ ...at, message: `${label} is not a complete Address (${found.reason})` }];
    if (found.type)
        return [{ ...at, message: `\`data.affiliations\` accepts affiliation, not ${found.type}` }];
    if (found.missing)
        return [
            {
                ...at,
                message:
                    `\`data.affiliations\` names ${found.address}, which does not resolve ` +
                    "in this package or its declared dependencies",
            },
        ];
    return [];
}

/** Whether a `rank` is a rung the named body confers. */
function rankFindings(note, standing, body, path, resolved) {
    if (standing.rank === undefined || standing.rank === null) return [];
    const at = position(note, [...path, "rank"]);
    const level = typeof standing.rank === "number" ? standing.rank : Number(standing.rank);
    if (typeof standing.rank !== "number" || !Number.isInteger(level))
        return [
            {
                ...at,
                message:
                    `\`data.affiliations\` entry for ${body}: \`rank\` must be the level on that body's own ` +
                    `ladder, as a whole number, but reads ${JSON.stringify(standing.rank)}`,
            },
        ];
    if (!resolved.fm) return [];
    const ladder = rankLadder(resolved.fm.data?.governance?.ranks);
    if (ladder.has(level)) return [];
    if (!ladder.size)
        return [
            {
                ...at,
                message:
                    `\`data.affiliations\` entry for ${body} states a rung, and that body ` +
                    "declares no `data.governance.ranks` ladder to hold one",
            },
        ];
    const levels = [...ladder.keys()].sort((a, b) => a - b);
    return [
        {
            ...at,
            message:
                `\`data.affiliations\` entry for ${body}: rank ${level} is not a level ` +
                `${resolved.address} confers; its ladder runs ${levels.join(", ")}`,
        },
    ];
}

/** Whether an `office` is a post the named body names. */
function officeFindings(note, standing, body, path, resolved) {
    if (standing.office === undefined || standing.office === null) return [];
    const at = position(note, [...path, "office"]);
    if (typeof standing.office !== "string" || !standing.office.trim())
        return [
            {
                ...at,
                message:
                    `\`data.affiliations\` entry for ${body}: \`office\` must name a post from its ` +
                    `\`governance.offices\`, but reads ${JSON.stringify(standing.office)}`,
            },
        ];
    if (!resolved.fm) return [];
    const roster = officeRoster(resolved.fm.data?.governance?.offices);
    if (roster.has(standing.office)) return [];
    if (!roster.size)
        return [
            {
                ...at,
                message:
                    `\`data.affiliations\` entry for ${body} names an office, and that body ` +
                    `${resolved.address} declares no \`data.governance.offices\` to hold one`,
            },
        ];
    return [
        {
            ...at,
            message:
                `\`data.affiliations\` entry for ${body}: office ${JSON.stringify(standing.office)} is not ` +
                `an office ${resolved.address} names; it holds ${[...roster.keys()].join(", ")}`,
        },
    ];
}
