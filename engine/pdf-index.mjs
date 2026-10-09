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
 * The book's index: which terms it lists, in what order, and the Typst that
 * finds their pages.
 *
 * **Terms are decided here, pages are decided by layout.** The set of terms and
 * their order are known from the plan alone, so they are computed in this
 * module and written into the source as data. Which page a term lands on is
 * known only once the compiler has laid the book out, so every entry heading
 * and every authored mention carries an invisible `metadata` marker and the
 * chapter queries them from inside a `context`. The page numbers are therefore
 * right however the book reflows.
 *
 * - A note's own entry lists its name, with the entry's page in bold.
 * - An authored mention of a note in the book adds the page it appears on.
 * - An alias (`name.aliases`) and an event's in-world name
 *   (`data.events[].names`) list a cross-reference to the note's name.
 *
 * Terms sort on the ASCII fold the content index derives for names
 * ({@link module:engine/content-index.asciiName}), ignoring case, so an
 * accented name files under its base letter.
 *
 * @module
 */

import { asciiName } from "./content-index.mjs";

/**
 * The marker an entry heading or an authored mention carries.
 *
 * @param {string} slug - The address slug of the note the marker is about.
 * @param {boolean} [main] - Whether this is the note's own entry.
 * @returns {string} Typst markup occupying no space.
 */
export function indexMarker(slug, main = false) {
    return `#book-ix("${escapeString(slug)}"${main ? ", main: true" : ""})`;
}

/** @param {string} text @returns {string} The text inside a Typst string literal. */
function escapeString(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The slug a note is indexed under.
 *
 * @param {object} record - A plan entry's record.
 * @returns {string} The slug, or "".
 */
function slugOf(record) {
    return String(record?.address?.slug ?? record?.shortcode ?? "");
}

/**
 * The folded sort key of a term.
 *
 * @param {string} name - The term as printed.
 * @returns {string} Lower-case printable ASCII.
 */
function sortKey(name) {
    return (asciiName(name) ?? name).toLowerCase();
}

/**
 * The letter heading a term files under: `#` for anything that does not begin
 * with a letter.
 *
 * @param {string} key - The term's sort key.
 * @returns {string} A capital letter or `#`.
 */
function letterOf(key) {
    const first = key.charAt(0).toUpperCase();
    return first >= "A" && first <= "Z" ? first : "#";
}

/**
 * Every term the book's index lists, in index order.
 *
 * @param {object[]} entries - The plan's entries.
 * @returns {Array<{letter: string, name: string, slug: string, see?: string}>}
 *   Terms with `see` set for a cross-reference to the main name it points at.
 */
export function indexTerms(entries) {
    const terms = [];
    const info = new Map();
    const nameByCanonical = new Map();
    for (const entry of entries ?? []) {
        if (entry?.kind !== "note") continue;
        const canonical = entry.record?.address?.canonical;
        const name = String(entry.record?.name?.full ?? "").trim();
        if (canonical && name) nameByCanonical.set(String(canonical), name);
    }
    for (const entry of entries ?? []) {
        if (entry?.kind !== "note") continue;
        const slug = slugOf(entry.record);
        const name = String(entry.record?.name?.full ?? "").trim();
        if (!slug || !name || info.has(slug)) continue;
        const parents = Array.isArray(entry.record?.data?.parents) ? entry.record.data.parents : [];
        const parent = parents
            .map((one) =>
                nameByCanonical.get(String(typeof one === "string" ? one : one?.canonical)),
            )
            .find(Boolean);
        info.set(slug, {
            kind: String(entry.record?.subType || entry.record?.type || ""),
            parent: parent ?? "",
        });
        terms.push({ name, slug, main: true });
        const taken = new Set([sortKey(name)]);
        const names = [
            ...(Array.isArray(entry.record?.name?.aliases) ? entry.record.name.aliases : []),
            ...(Array.isArray(entry.record?.data?.events) ? entry.record.data.events : []).flatMap(
                (event) => (Array.isArray(event?.names) ? event.names.map((n) => n?.name) : []),
            ),
        ];
        for (const other of names) {
            if (typeof other !== "string" || !other.trim()) continue;
            const key = sortKey(other.trim());
            if (taken.has(key)) continue;
            taken.add(key);
            terms.push({ name: other.trim(), slug, main: false });
        }
    }
    // Terms printing one name for different notes are told apart: first by the
    // note's subtype (or its type), then, where that still collides, by the
    // place the note is within.
    const clashing = (shown) => {
        const owners = new Map();
        terms.forEach((term, i) => {
            const key = sortKey(shown[i]);
            if (!owners.has(key)) owners.set(key, new Set());
            owners.get(key).add(term.slug);
        });
        return terms.map((_, i) => owners.get(sortKey(shown[i])).size > 1);
    };
    const qualified = (term, withParent) => {
        const { kind, parent } = info.get(term.slug);
        const qualifier = withParent && parent ? `${kind}, ${parent}` : kind;
        return qualifier ? `${term.name} (${qualifier})` : term.name;
    };
    let shown = terms.map((term) => term.name);
    for (const withParent of [false, true]) {
        const clash = clashing(shown);
        if (!clash.some(Boolean)) break;
        shown = terms.map((term, i) => (clash[i] ? qualified(term, withParent) : shown[i]));
    }
    const mainShown = new Map();
    terms.forEach((term, i) => {
        if (term.main) mainShown.set(term.slug, shown[i]);
    });
    const keyed = terms.map((term, i) => ({
        name: shown[i],
        slug: term.slug,
        ...(term.main ? {} : { see: mainShown.get(term.slug) }),
        key: sortKey(shown[i]),
    }));
    keyed.sort((a, b) => {
        const la = letterOf(a.key);
        const lb = letterOf(b.key);
        if (la !== lb)
            return (
                la === "#" ? -1
                : lb === "#" ? 1
                : la < lb ? -1
                : 1
            );
        if (a.key !== b.key) return a.key < b.key ? -1 : 1;
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return (
            a.slug < b.slug ? -1
            : a.slug > b.slug ? 1
            : 0
        );
    });
    return keyed.map(({ key, ...term }) => ({ letter: letterOf(key), ...term }));
}

/**
 * The Typst function definitions the markers and the chapter rely on.
 *
 * @returns {string} Typst source.
 */
export function indexPreamble() {
    return [
        // Zero-size and invisible; the label is what the chapter queries.
        "#let book-ix(key, main: false) = [#metadata((key: key, main: main)) <book-index>]",
        "#let book-index(terms) = context {",
        "  set par(justify: false, first-line-indent: 0em, hanging-indent: 1em, spacing: 0.45em)",
        "  set text(size: 8.8pt)",
        "  let by = (:)",
        "  for m in query(<book-index>) {",
        "    let loc = m.location()",
        "    let n = counter(page).at(loc).first()",
        "    let pages = by.at(m.value.key, default: ())",
        "    pages.push((n: n, main: m.value.main, loc: loc))",
        "    by.insert(m.value.key, pages)",
        "  }",
        "  let merged(key) = {",
        "    let out = (:)",
        "    for p in by.at(key, default: ()) {",
        "      let at = str(p.n)",
        "      let seen = out.at(at, default: none)",
        "      if seen == none or (p.main and not seen.main) { out.insert(at, p) }",
        "    }",
        "    out.values().sorted(key: p => p.n)",
        "  }",
        "  let letter = none",
        "  for term in terms {",
        "    if term.letter != letter {",
        "      letter = term.letter",
        "      heading(level: 5, outlined: false, bookmarked: false)[#letter]",
        "    }",
        "    if term.see != none {",
        "      let main = merged(term.slug).filter(p => p.main)",
        "      let shown = if main.len() > 0 { link(main.first().loc)[#term.see] } else { term.see }",
        "      par[#term.name, #emph[see] #shown]",
        "    } else {",
        "      let numbers = merged(term.slug).map(p => link(p.loc)[#text(",
        '        weight: if p.main { "bold" } else { "regular" })[#numbering("1", p.n)]])',
        "      par[#term.name #h(0.35em) #numbers.join[, ]]",
        "    }",
        "  }",
        "}",
    ].join("\n");
}

/**
 * The index chapter, ready to follow the last entry.
 *
 * @param {object[]} entries - The plan's entries.
 * @param {string} title - The book's title, which kicks the chapter.
 * @returns {string} Typst source, or "" when the book has nothing to index.
 */
export function indexChapter(entries, title) {
    const terms = indexTerms(entries);
    if (!terms.length) return "";
    const rows = terms.map(
        (term) =>
            `(letter: "${escapeString(term.letter)}", name: "${escapeString(term.name)}", ` +
            `slug: "${escapeString(term.slug)}", see: ${
                term.see === undefined ? "none" : `"${escapeString(term.see)}"`
            })`,
    );
    return [
        "#set page(columns: 2, footer: book-footer[Index])",
        `#book-section("${escapeString(title)}", "Index", none)[` +
            "#heading(level: 1, outlined: true, bookmarked: true)[Index] <book-index-chapter>]",
        `#book-index((${rows.join(",\n  ")},))`,
        "",
    ].join("\n");
}
