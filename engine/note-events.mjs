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
 * The **event** schema: what one entry of `data.events` may say, and the check
 * that holds every entry to it.
 *
 * An event is an entry in `data.events` on a `lore`, `place` or `affiliation`
 * note. `note-vocabulary.mjs` declares the field once, as `EVENTS_FIELD`, and
 * spreads that one object into all three types, so the schema cannot differ
 * between them.
 *
 * **What an entry holds is declared once, in
 * {@link module:engine/note-event-terms}**, as an inner-key declaration the
 * field carries. The frontmatter lint's inner-key check reads it like every
 * other `data:` field's: every key of an entry, and of each map nested in one,
 * is closed, a required key is stated, and each value has its declared kind.
 * This module walks the same declaration for what the values mean: every
 * closed value is one of the lists the format reference documents as its
 * vocabulary tables, text is not blank, and every Address resolves through the
 * index the way a `data:` Address field does.
 *
 * **Identity.** An entry may carry `id`, an address segment, unique within its
 * note and required when the note holds two or more events. The `id` is an
 * anchor of kind `event` ({@link module:engine/anchors}), in the one namespace
 * the note's headings and blocks share, so an event is addressed as
 * `<note address>#<id>` — or as its note's address alone when the note holds
 * one. `follows[].event` and `where.reach[].attributedTo` are the keys that
 * accept an anchor, and only of kind `event`.
 *
 * **Consequence.** A `follows` edge is written on the later event and names an
 * earlier one, so an edge pointing at a later `when` is a finding, and the
 * graph of every edge in the corpus has no cycle. An edge touching a `when`
 * that has no position on the axis — `unknown`, or a year-`0` date that recurs
 * in every year — is not ordered. An edge into another package is resolved and
 * ordered against that package's published index, which carries each note's
 * anchors with their kinds and each event's resolved date.
 *
 * Every finding is positioned at the key or value that earned it, under
 * `["data", "events", position, ...]`.
 *
 * @module
 */

import {
    acceptsType,
    hasAnchor,
    isAddressTuple,
    parseAddress,
    renderAddress,
    splitAnchor,
} from "./address.mjs";
import { collectAnchors, eventAnchors, noteAnchorFindings } from "./anchors.mjs";
import { AddressLink } from "./address-values.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";

import {
    ACCOUNT_AGREES,
    EVENT_DEPTHS,
    EVENT_ENTRY,
    EVENT_ENTRY_KEYS,
    EVENT_KINDS,
    EVENT_STANDINGS,
    EVENT_VOCABULARIES,
    FOLLOWS_HOW,
    PARTICIPANT_ROLES,
    REACH_KNOWLEDGE,
} from "./note-event-terms.mjs";

export {
    ACCOUNT_AGREES,
    EVENT_DEPTHS,
    EVENT_ENTRY,
    EVENT_ENTRY_KEYS,
    EVENT_KINDS,
    EVENT_STANDINGS,
    EVENT_VOCABULARIES,
    FOLLOWS_HOW,
    PARTICIPANT_ROLES,
    REACH_KNOWLEDGE,
};

/** The declaration of one inner key of an entry, by its path of key names. */
function keyAt(...names) {
    let spec = EVENT_ENTRY;
    for (const name of names) {
        const inner = spec.entries ?? spec;
        spec = inner.fields.find((field) => field.name === name);
    }
    return spec;
}

/**
 * Every Address position inside one event entry, derived from the schema
 * above: its path from the entry (`*` for each list item), whether it holds one
 * Address or a list of them, and its default type, accepted types and anchor
 * kinds. The note boundary reads these Addresses into tuples, so the published
 * index writes them as it writes every other Address.
 *
 * @type {ReadonlyArray<{path: readonly string[], shape: "value"|"list",
 *   type?: string, accepts?: readonly string[], anchors?: readonly string[]}>}
 */
export const EVENT_ADDRESS_POSITIONS = Object.freeze(
    (function positions(spec, at) {
        if (spec.own) return [];
        if (spec.kind === "address")
            return [
                Object.freeze({
                    path: Object.freeze(at),
                    shape: "value",
                    ...(spec.ref ? { type: spec.ref } : {}),
                    ...(spec.accepts ? { accepts: spec.accepts } : {}),
                    ...(spec.anchors ? { anchors: spec.anchors } : {}),
                }),
            ];
        if (spec.kind === "list" && spec.entries) {
            if (spec.entries.kind === "address")
                return positions(spec.entries, at).map((one) =>
                    Object.freeze({ ...one, shape: "list" }),
                );
            return positions(spec.entries, [...at, "*"]);
        }
        if (spec.fields)
            return spec.fields.flatMap((field) => positions(field, [...at, field.name]));
        return [];
    })(EVENT_ENTRY, []),
);

/**
 * An Address as text: the note boundary reads an event's Addresses into tuples,
 * and an anchored one into an {@link AddressLink}, while a value it could not
 * read stays as written. Every one is checked in its written form.
 *
 * @param {unknown} value - The value at an Address key.
 * @returns {unknown} The canonical Address, with `#<anchor>` where it has one,
 *   or the value unchanged.
 */
function writtenOf(value) {
    if (isAddressTuple(value)) return renderAddress(value);
    if (value instanceof AddressLink) return `${renderAddress(value.target)}#${value.anchor}`;
    return value;
}

/** Whether a value is a plain map — not `null`, not an array, not a parsed Address. */
function mapping(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isAddressTuple(value)
    );
}

/** A path under the frontmatter as a message names it. */
const dotted = (path) => path.map(String).join(".");

/**
 * Walk one value against its declaration for what it means, collecting
 * findings and the Addresses to resolve.
 *
 * Shape is not asked here. An undeclared key, a required key left out and a
 * value of the wrong kind are the inner-key check's findings, made from the
 * same declaration, so a value of the wrong shape is passed over rather than
 * reported twice. What is asked is what only the event schema can say: a
 * closed value is one of its list, text holds something, and an Address is
 * collected for resolution.
 *
 * @param {unknown} value - The authored value.
 * @param {object} spec - Its declaration.
 * @param {Array<string|number>} path - Its frontmatter path.
 * @param {{at: Function, refs: object[]}} sink - Where findings and Addresses go.
 * @returns {object[]} Findings.
 */
function walk(value, spec, path, sink) {
    const findings = [];
    const name = dotted(path);
    if (spec.own || value === undefined || value === null) return findings;
    if (spec.oneOf) {
        if (typeof value === "string" && !spec.oneOf.values.includes(value))
            findings.push(
                sink.at(
                    path,
                    `\`${name}\` reads ${JSON.stringify(value)}, which \`${spec.name}\` does ` +
                        `not admit — it takes ${spec.oneOf.values.join(", ")}`,
                ),
            );
        return findings;
    }
    if (spec.kind === "string") {
        // A required key left blank is the inner-key check's finding.
        if (typeof value === "string" && !value.trim() && !spec.required)
            findings.push(sink.at(path, `\`${name}\` is a string, but reads ""`));
        return findings;
    }
    if (spec.kind === "address") {
        const written = writtenOf(value);
        if (typeof written === "string") sink.refs.push({ value: written, path, spec });
        else if (typeof value !== "object")
            findings.push(
                sink.at(path, `\`${name}\` is an Address, but reads ${JSON.stringify(value)}`),
            );
        return findings;
    }
    if (Array.isArray(value)) {
        if (spec.entries)
            value.forEach((entry, position) =>
                findings.push(...walk(entry, spec.entries, [...path, position], sink)),
            );
        return findings;
    }
    if (spec.fields && mapping(value)) {
        for (const field of spec.fields)
            findings.push(...walk(value[field.name], field, [...path, field.name], sink));
    }
    return findings;
}

/** Whether an index entry is a note of this tree, whose frontmatter is readable. */
function localNote(hit) {
    return Boolean(hit && typeof hit === "object" && hit.fm && typeof hit.file === "string");
}

/** The authored `data.events` of a note, or an empty list. */
function eventsOf(note) {
    const events = note?.fm?.data?.events;
    return Array.isArray(events) ? events : [];
}

/** Each local note's anchors, read once. */
const noteAnchorCache = new WeakMap();

/**
 * Every anchor the note an index entry names declares, each with its kind.
 *
 * A local note is read directly — its body's anchors and its events'. A note
 * another package publishes is read from that package's index record.
 *
 * @param {object} hit - The index entry.
 * @returns {Array<{slug: string, kind?: string}>} The anchors.
 */
function anchorsOf(hit) {
    if (!localNote(hit)) return Array.isArray(hit?.noteAnchors) ? hit.noteAnchors : [];
    const cached = noteAnchorCache.get(hit);
    if (cached) return cached;
    const body =
        typeof hit.body === "string" ?
            hit.body
        :   String(hit.raw ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "");
    const anchors = [...collectAnchors(body), ...eventAnchors(hit.fm, hit.raw)];
    noteAnchorCache.set(hit, anchors);
    return anchors;
}

/**
 * The events of the note an index entry names, each with its `id` and its
 * place on the canonical axis.
 *
 * @param {object} hit - The index entry.
 * @param {object} dates - The corpus's reckoning context, for a local note.
 * @returns {Array<{id?: string, date: object|null}>} In entry order.
 */
function datedEventsOf(hit, dates) {
    if (localNote(hit))
        return eventsOf(hit).map((entry) => ({
            id: mapping(entry) && typeof entry.id === "string" ? entry.id : undefined,
            date: mapping(entry) ? placeOnAxis(entry.when, dates) : null,
        }));
    return (Array.isArray(hit?.events) ? hit.events : []).map((event) => ({
        id: event?.id ?? undefined,
        date: Number.isFinite(event?.when?.canonicalYear) ? event.when : null,
    }));
}

/**
 * The types a key accepts, as a message names them: `a place note`, `a being,
 * affiliation or lore note`.
 *
 * @param {readonly string[]} types - The accepted types.
 * @returns {string} The phrase.
 */
function typeList(types) {
    const article = /^[aeiou]/.test(types[0]) ? "an" : "a";
    const named =
        types.length === 1 ? types[0] : `${types.slice(0, -1).join(", ")} or ${types.at(-1)}`;
    return `${article} ${named} note`;
}

/** What a reference says of an anchor its key does not accept. */
const NO_ANCHOR = "takes no anchor — it names a whole note, so write the Address without `#…`";

/**
 * Resolve one Address an event writes.
 *
 * @param {unknown} value - The authored value.
 * @param {object} spec - Its schema node.
 * @param {object} index - The link index.
 * @param {object} dates - The corpus's reckoning context.
 * @returns {{problem?: string, hit?: object, position?: number, target?: string,
 *   date?: object|null}} What it names: the index entry, and for an event the
 *   entry's position in its note and its date; or why it names nothing.
 */
function resolveRef(value, spec, index, dates) {
    const anchored = hasAnchor(value);
    if (anchored && !spec.anchors) return { problem: NO_ANCHOR };
    const { address: written, anchor } = anchored ? splitAnchor(value) : { address: value };
    if (anchor !== undefined && !isAddressSegment(anchor))
        return { problem: `names the anchor \`${anchor}\`, which is not an address segment` };
    const tuple = parseAddress(
        written,
        {
            package: index.contentPackage,
            system: "note",
            ...(spec.ref ? { type: spec.ref } : {}),
            types: index.types,
            packages: index.packages,
        },
        { declared: true },
    );
    if (tuple.reason)
        return {
            problem:
                "should be an Address that states its type" +
                (spec.ref ? ` or a ${spec.ref} shortcode` : ""),
        };
    const target = renderAddress(tuple);
    if (spec.accepts && !acceptsType(tuple, spec.accepts))
        return {
            problem:
                `names ${target}, which is a ${tuple.type} — it must name ` +
                (spec.calendar ? "a calendar note" : typeList(spec.accepts)),
        };
    const hit = index.addressHit(target);
    if (!hit)
        return {
            problem: `names ${target}, which does not resolve in this package or its declared dependencies`,
        };
    if (spec.calendar) {
        const subType = (hit.fm ?? hit).subType;
        if (subType !== "calendar")
            return { problem: `names ${target}, a lore note whose subType is not calendar` };
    }

    if (anchor !== undefined) {
        const found = anchorsOf(hit).find((one) => one?.slug === anchor);
        if (!found)
            return {
                problem: `names ${target}#${anchor}, which does not resolve — that note declares no anchor ${anchor}`,
            };
        if (!spec.anchors.includes(found.kind))
            return {
                problem: `names ${target}#${anchor}, which is a ${found.kind ?? "no-kind"} anchor, not an ${spec.anchors.join(" or ")} anchor`,
            };
        const events = datedEventsOf(hit, dates);
        const position = events.findIndex((event) => event.id === anchor);
        return { hit, target, position, date: events[position]?.date ?? null };
    }
    if (spec.eventOrLore) {
        if (tuple.type === "lore" || datedEventsOf(hit, dates).length === 1) return { hit, target };
        return {
            problem: `names ${target}, which must name an event or a lore note — it is a ${tuple.type} note holding no single event`,
        };
    }
    if (!spec.single) return { hit, target };
    const events = datedEventsOf(hit, dates);
    if (events.length === 0) return { problem: `names ${target}, which holds no events` };
    if (events.length > 1)
        return {
            problem:
                `names ${target}, which holds ${events.length} events — name one as ` +
                `${tuple.type}-${tuple.shortcode}#<id>`,
        };
    return { hit, target, position: 0, date: events[0].date };
}

/**
 * Where an event sits on the canonical axis, or `null` when it has no
 * position: `unknown`, a year-`0` date that recurs in every year, or a `when`
 * that does not parse.
 *
 * @param {unknown} when - The authored `when`.
 * @param {object} dates - The corpus's reckoning context.
 * @returns {object|null} The parsed date.
 */
function placeOnAxis(when, dates) {
    const { date } = parseNoteDate(when, { ...dates, allowUnknown: true, allowZeroYear: true });
    if (!date?.known || !Number.isFinite(date.canonicalYear)) return null;
    return date;
}

/**
 * Whether `earlier` falls after `later`. Two dates both stating a day compare
 * by day; otherwise they compare by year, so a year and a day within it are
 * never out of order.
 *
 * @param {object} earlier - The date the edge names.
 * @param {object} later - The date of the event writing the edge.
 * @returns {boolean} Whether the edge points forward in time.
 */
function pointsForward(earlier, later) {
    const byDay =
        earlier.day != null &&
        later.day != null &&
        Number.isFinite(earlier.sort) &&
        Number.isFinite(later.sort);
    return byDay ? earlier.sort > later.sort : earlier.canonicalYear > later.canonicalYear;
}

/** One analysed `follows` graph per corpus index. */
const graphs = new WeakMap();

/**
 * The `follows` edges of the whole corpus that lie on a cycle.
 *
 * Built once per index from every note it holds, resolving each edge the way
 * the per-note check does, then split into strongly connected components: an
 * edge whose two ends share a component — or that names its own event — is on
 * a cycle.
 *
 * @param {object} index - The link index.
 * @returns {Set<string>} `<file>#<event>#<edge>` for every edge on a cycle.
 */
function cyclicEdges(index) {
    const cached = graphs.get(index);
    if (cached) return cached;

    const nodeOf = (note, position) => `${note.file}#${position}`;
    /** @type {Map<string, Array<{to: string, edge: string}>>} */
    const out = new Map();
    for (const note of index.notes ?? []) {
        eventsOf(note).forEach((entry, position) => {
            const from = nodeOf(note, position);
            if (!out.has(from)) out.set(from, []);
            const follows = mapping(entry) && Array.isArray(entry.follows) ? entry.follows : [];
            follows.forEach((edge, k) => {
                if (!mapping(edge)) return;
                const resolved = resolveRef(
                    writtenOf(edge.event),
                    keyAt("follows", "event"),
                    index,
                    reckoningContext(index),
                );
                if (resolved.position === undefined || !localNote(resolved.hit)) return;
                out.get(from).push({
                    to: nodeOf(resolved.hit, resolved.position),
                    edge: `${from}#${k}`,
                });
            });
        });
    }

    // Tarjan's strongly connected components, iterative so a long chain
    // cannot exhaust the stack.
    const component = new Map();
    const low = new Map();
    const order = new Map();
    const stack = [];
    const onStack = new Set();
    let counter = 0;
    for (const root of out.keys()) {
        if (order.has(root)) continue;
        const work = [{ node: root, next: 0 }];
        order.set(root, counter);
        low.set(root, counter);
        counter += 1;
        stack.push(root);
        onStack.add(root);
        while (work.length) {
            const frame = work[work.length - 1];
            const edges = out.get(frame.node) ?? [];
            if (frame.next < edges.length) {
                const { to } = edges[frame.next];
                frame.next += 1;
                if (!order.has(to)) {
                    order.set(to, counter);
                    low.set(to, counter);
                    counter += 1;
                    stack.push(to);
                    onStack.add(to);
                    work.push({ node: to, next: 0 });
                } else if (onStack.has(to)) {
                    low.set(frame.node, Math.min(low.get(frame.node), order.get(to)));
                }
                continue;
            }
            work.pop();
            if (work.length) {
                const parent = work[work.length - 1].node;
                low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
            }
            if (low.get(frame.node) === order.get(frame.node)) {
                let member;
                do {
                    member = stack.pop();
                    onStack.delete(member);
                    component.set(member, frame.node);
                } while (member !== frame.node);
            }
        }
    }

    const cyclic = new Set();
    for (const [from, edges] of out) {
        for (const { to, edge } of edges) {
            if (from === to || component.get(from) === component.get(to)) cyclic.add(edge);
        }
    }
    graphs.set(index, cyclic);
    return cyclic;
}

/**
 * Validate a note's `data.events`, entry by entry.
 *
 * Registered as the `events` field's `check`, so it runs on every note whose
 * type declares `events`, whatever its `subType`. Without an index the shape,
 * the closed values, the identity and the dates are checked and no Address is
 * resolved.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {{index?: object}} [options]
 * @returns {object[]} Findings, each positioned at the key or value that
 *   earned it.
 */
export function checkNoteEvents(note, { index } = {}) {
    const events = note.fm?.data?.events;
    if (!Array.isArray(events)) return [];

    const findings = [];
    const dates = reckoningContext(index);
    const at = (path, message, options = {}) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", path, options),
        severity: "error",
        message,
    });
    const resolving = Boolean(index?.addressHit);
    const cyclic = resolving && Array.isArray(index.notes) ? cyclicEdges(index) : new Set();
    const ids = new Map();
    findings.push(...noteAnchorFindings(note));

    events.forEach((entry, position) => {
        const base = ["data", "events", position];
        // An entry that is not a map is the inner-key check's finding.
        if (!mapping(entry)) return;

        const sink = { at, refs: [] };
        findings.push(...walk(entry, EVENT_ENTRY, base, sink));

        // Identity.
        if (entry.id === undefined || entry.id === null) {
            if (events.length > 1)
                findings.push(
                    at(
                        base,
                        `\`${dotted(base)}\` needs an \`id\` — a note holding two or more ` +
                            "events names each one, so `follows` can say which it means",
                    ),
                );
        } else if (typeof entry.id !== "string" || !isAddressSegment(entry.id)) {
            findings.push(
                at(
                    [...base, "id"],
                    `\`${dotted([...base, "id"])}\`: an \`id\` is an address segment of lowercase ` +
                        `letters and digits, but reads ${JSON.stringify(entry.id)}`,
                ),
            );
        } else if (ids.has(entry.id)) {
            findings.push(
                at(
                    [...base, "id"],
                    `\`${dotted([...base, "id"])}\`: \`id\` ${entry.id} is already used by ` +
                        `data.events.${ids.get(entry.id)} — an id is unique within its note`,
                ),
            );
        } else {
            ids.set(entry.id, position);
        }

        // `attributedTo` gives the cause a `misattributed` place names instead.
        const reach =
            mapping(entry.where) && Array.isArray(entry.where.reach) ? entry.where.reach : [];
        reach.forEach((row, k) => {
            if (!mapping(row) || row.attributedTo == null || row.knowledge === "misattributed")
                return;
            const path = [...base, "where", "reach", k, "attributedTo"];
            findings.push(
                at(
                    path,
                    `\`${dotted(path)}\` is written only beside \`knowledge: misattributed\` — ` +
                        "it names the cause that place gives instead",
                    { key: true },
                ),
            );
        });

        findings.push(...checkDates(entry, base, note, dates, at));

        if (!resolving) return;
        const own = placeOnAxis(entry.when, dates);
        for (const ref of sink.refs) {
            const resolved = resolveRef(ref.value, ref.spec, index, dates);
            if (resolved.problem) {
                findings.push(
                    at(
                        ref.path,
                        `\`${dotted(ref.path)}\` ${resolved.problem}, but reads ` +
                            JSON.stringify(
                                isAddressTuple(ref.value) ? renderAddress(ref.value) : ref.value,
                            ),
                    ),
                );
                continue;
            }
            if (!ref.spec.single || resolved.position === undefined) continue;
            const k = ref.path[ref.path.length - 2];
            if (cyclic.has(`${note.file}#${position}#${k}`)) {
                findings.push(
                    at(
                        ref.path,
                        `\`${dotted(ref.path)}\` names ${ref.value}, which closes a cycle of ` +
                            "`follows` edges — an event cannot follow from itself",
                    ),
                );
                continue;
            }
            const named = resolved.date;
            if (own && named && pointsForward(named, own)) {
                findings.push(
                    at(
                        ref.path,
                        `\`${dotted(ref.path)}\` names ${ref.value}, dated ${named.text}, which is ` +
                            `later than this event's ${own.text} — \`follows\` names an earlier event`,
                    ),
                );
            }
        }
    });

    return findings;
}

/**
 * Check an entry's `when`, `until` and `recurs`.
 *
 * @param {object} row - The entry.
 * @param {Array<string|number>} base - Its frontmatter path.
 * @param {object} note - The note.
 * @param {object} dates - The corpus's reckoning context.
 * @param {Function} at - The finding builder.
 * @returns {object[]} Findings.
 */
function checkDates(row, base, note, dates, at) {
    const findings = [];
    const when = parseNoteDate(row.when, {
        ...dates,
        allowUnknown: true,
        allowZeroYear: true,
        field: "when",
        file: note.file,
        raw: note.raw,
        keyPath: [...base, "when"],
    });
    findings.push(...when.findings);

    const until = parseNoteDate(row.until, {
        ...dates,
        allowUnknown: false,
        field: "until",
        file: note.file,
        raw: note.raw,
        keyPath: [...base, "until"],
    });
    findings.push(...until.findings);

    const recurs = row.recurs;
    if (recurs === undefined || recurs === null) return findings;

    if (row.when === undefined || row.when === null) {
        findings.push(
            at(
                [...base, "recurs"],
                "`recurs` needs a `when` of its own — a recurrence counts from the anchor it names",
            ),
        );
        return findings;
    }
    if (when.date?.known && when.date.year === 0) {
        findings.push(
            at(
                [...base, "recurs"],
                "`recurs` is refused beside a `when` of year 0 — that date already recurs " +
                    "on that day every year, and `every` above 1 cannot be counted without " +
                    "an anchor year",
            ),
        );
        return findings;
    }
    // A `recurs` that is not a map, and a key it does not declare, are the
    // inner-key check's findings.
    if (!mapping(recurs)) return findings;

    const hasEvery = Object.hasOwn(recurs, "every");
    const hasOn = Object.hasOwn(recurs, "on");
    if (hasEvery && hasOn) {
        findings.push(
            at(
                [...base, "recurs"],
                "`recurs` declares exactly one of `every` or `on`, not both — a period " +
                    "with exceptions is written as an enumeration",
            ),
        );
        return findings;
    }
    if (!hasEvery && !hasOn) {
        findings.push(
            at(
                [...base, "recurs"],
                "`recurs` needs `every` or `on` — its absence is what says the occasion " +
                    "happened once",
            ),
        );
        return findings;
    }

    if (hasEvery) {
        const { every } = recurs;
        // Not a number at all is the inner-key check's finding.
        if (typeof every === "number" && !(Number.isInteger(every) && every >= 1)) {
            findings.push(
                at(
                    [...base, "recurs", "every"],
                    `\`recurs.every\` needs a whole number of years, 1 or more, but reads ` +
                        `${JSON.stringify(every)}`,
                ),
            );
        }
        return findings;
    }

    if (row.until !== undefined && row.until !== null) {
        findings.push(
            at(
                [...base, "until"],
                "`until` is refused beside `recurs.on` — the enumeration states its own " +
                    "last entry",
            ),
        );
    }

    const onList = recurs.on;
    // Not a list is the inner-key check's finding; an empty one is this one's.
    if (!Array.isArray(onList)) return findings;
    if (onList.length === 0) {
        findings.push(at([...base, "recurs", "on"], "`recurs.on` needs a list of dates"));
        return findings;
    }

    let previous = when.date?.known ? when.date : null;
    onList.forEach((onRaw, onPosition) => {
        const onPath = [...base, "recurs", "on", onPosition];
        const onParsed = parseNoteDate(onRaw, {
            ...dates,
            allowUnknown: false,
            field: "recurs.on",
            file: note.file,
            raw: note.raw,
            keyPath: onPath,
        });
        findings.push(...onParsed.findings);
        const onDate = onParsed.date;
        if (onDate?.known && previous?.known) {
            if (onDate.sort <= previous.sort) {
                findings.push(
                    at(
                        onPath,
                        onPosition === 0 ?
                            "`recurs.on` entry is at or before `when`, so it is not a " +
                                "later occurrence"
                        :   "`recurs.on` entries are not strictly increasing",
                    ),
                );
            }
        }
        if (onDate?.known) previous = onDate;
    });
    return findings;
}
