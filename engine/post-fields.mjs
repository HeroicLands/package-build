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
 * **A blog post** is a `doc` of `subType: post`. It states the day it was
 * published in `data.date`, as `YYYY-MM-DD`, and may name its writer in
 * `data.author`; a post that names none carries the site's byline, the first
 * entry of `authors`. Its `tags` are the top-level ones any note carries.
 *
 * Both fields belong to a post alone. {@link checkPostFields} requires the date
 * on a post, refuses either field on any other `doc`, and refuses a date that
 * is not a calendar day or an author that is blank.
 *
 * @module
 */

import { positionInFrontmatter, positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The `doc` subType a post is. */
export const POST_SUBTYPE = "post";

/** A calendar day as a post states it. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a note's frontmatter, or a page's parameters, are a post's.
 *
 * @param {{type?: unknown, subType?: unknown}|null|undefined} fm - The frontmatter.
 * @returns {boolean} Whether it is a `doc` of `subType: post`.
 */
export function isPost(fm) {
    return (
        String(fm?.type ?? "").toLowerCase() === "doc" &&
        String(fm?.subType ?? "").toLowerCase() === POST_SUBTYPE
    );
}

/**
 * Whether a string is a calendar day, `YYYY-MM-DD`, that exists.
 *
 * @param {unknown} value - The value.
 * @returns {boolean} Whether it is one.
 */
export function isCalendarDay(value) {
    if (typeof value !== "string") return false;
    const match = DAY.exec(value);
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/** `data.date`, as the vocabulary declares it. */
export const POST_DATE_FIELD = Object.freeze({
    name: "date",
    shape: "string",
    kind: "string",
    describe:
        "The day a post was published, as `YYYY-MM-DD`. Required on a `post`; no other " +
        "subType states it. Posts are listed and fed newest first by it.",
});

/** `data.author`, as the vocabulary declares it. */
export const POST_AUTHOR_FIELD = Object.freeze({
    name: "author",
    shape: "string",
    kind: "string",
    describe:
        "Who wrote a post, as the byline prints them. A post that names none carries the " +
        "site's byline, the first entry of `authors`; no other subType states it.",
});

/**
 * Scope `data.date` and `data.author` to posts, and check their values.
 *
 * A post with no date is an error at its `subType:` line; a date that is not a
 * calendar day, or an author that is blank, is an error at the value. Either
 * field on a `doc` that is not a post is an error at the key.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @returns {object[]} Findings.
 */
export function checkPostFields(note) {
    const type = String(note?.type ?? note?.fm?.type ?? "").toLowerCase();
    if (type !== "doc") return [];
    const raw = note.raw ?? "";
    const data = note?.fm?.data;
    const has = (key) =>
        data !== null &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data[key] !== undefined &&
        data[key] !== null;
    const finding = (keyPath, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, keyPath, { key }),
        severity: "error",
        message,
    });

    if (!isPost({ type, subType: note?.fm?.subType })) {
        return ["date", "author"]
            .filter(has)
            .map((key) =>
                finding(
                    ["data", key],
                    `\`data.${key}\` is stated by a post, and this note's \`subType\` is not ` +
                        `\`${POST_SUBTYPE}\``,
                    true,
                ),
            );
    }

    const findings = [];
    if (!has("date")) {
        findings.push({
            file: note.file,
            ...positionInFrontmatter(raw, "subType", undefined, { topLevel: true }),
            severity: "error",
            message:
                "a post is listed and fed by the day it was published, so it must state " +
                "`data.date`, as `YYYY-MM-DD`",
        });
    } else if (typeof data.date === "string" && !isCalendarDay(data.date)) {
        findings.push(
            finding(
                ["data", "date"],
                `\`data.date\` is \`${String(data.date)}\`, which is not a calendar day written ` +
                    "`YYYY-MM-DD`",
            ),
        );
    }
    if (has("author") && typeof data.author === "string" && !data.author.trim()) {
        findings.push(
            finding(
                ["data", "author"],
                "`data.author` names who wrote the post; leave it out for the site's byline " +
                    "rather than writing it blank",
            ),
        );
    }
    return findings;
}
