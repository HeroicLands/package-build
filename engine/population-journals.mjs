/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty")
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { formatDiagnostic } from "./diagnostics.mjs";
import { makeId } from "./ids.mjs";
import { renderAddress } from "./address.mjs";
import { encodeAddresses } from "./address-values.mjs";
import { authoredFrontmatter, isNoteRecord, noteFile } from "./index-records.mjs";
import { journalHasContent } from "./note-state.mjs";
import { configSourcePath } from "./pack-config.mjs";
import { populationActual, populationApparent, populationDiffers } from "./population-values.mjs";

/**
 * Population facts whose public estimate differs from their actual value.
 * @param {object} fm - Complete source frontmatter.
 * @returns {Array<{label:string, actual:number|null, apparent:number|null}>}
 */
export function privatePopulationFacts(fm) {
    const facts = [];
    const add = (value, label) => {
        if (populationDiffers(value))
            facts.push({
                label,
                actual: populationActual(value),
                apparent: populationApparent(value),
            });
    };
    add(fm?.data?.population, fm?.type === "affiliation" ? "Membership" : "Population");
    add(fm?.data?.territorial_population, "Territorial population");
    for (const row of fm?.data?.settlements ?? []) {
        const location = row.location ? ` (${encodeAddresses(row.location)})` : "";
        add(row.population, `${row.settlement}${location}`);
    }
    return facts;
}

/**
 * Select the private journal destination and complete supplement subjects.
 * This preflight is shared by the compiler and the private journal writer.
 * @param {object[]} records - Complete captured index records.
 * @param {object} options
 * @param {object} options.router - This compile's pack router.
 * @param {object} options.config - This compile's configuration.
 * @param {Map<string, object>} [options.parsed] - Captured authored bodies.
 * @param {string} [options.contentBase] - The source root.
 * @param {Map<string, object[]>} [options.privateTables] - Private prepared sections establishing inline delivery.
 * @returns {{pack:string|undefined, subjects:object[]}}
 */
export function populationJournalPlan(
    records,
    { router, config, parsed, contentBase, privateTables },
) {
    const subjects = [];
    const compiledPack = (name) => !config.packs?.find((pack) => pack.name === name)?.prebuilt;
    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const fm = authoredFrontmatter(record);
        const facts = privatePopulationFacts(fm);
        if (!facts.length) continue;
        const ownPack = router.resolveOrNull(fm, "JournalEntry");
        const body =
            contentBase && record.file ?
                parsed?.get(noteFile(contentBase, record))?.body
            :   undefined;
        // An emitted private page already carries the note's population panel.
        // Prepared section metadata establishes whether inline rows reach that page.
        const inlineFacts = (fm.data?.settlements ?? []).some((row) =>
            populationDiffers(row.population),
        );
        const generatedInline =
            contentBase &&
            privateTables
                ?.get(noteFile(contentBase, record))
                ?.declared?.some((section) => section.slug === "settlements");
        if (
            compiledPack(ownPack) &&
            router.privateOf(ownPack) &&
            journalHasContent(body ?? "") &&
            (!inlineFacts || generatedInline)
        )
            continue;
        const address =
            record.address?.canonical ?
                encodeAddresses(record.address.canonical)
            :   renderAddress({
                    package: record.package ?? config.contentPackage,
                    system: "note",
                    type: fm.type,
                    shortcode: fm.shortcode,
                });
        subjects.push({
            address,
            name: fm.name?.full ?? fm.shortcode,
            facts,
            id: makeId("population-supplement", address),
        });
    }
    if (!subjects.length) return { pack: undefined, subjects };
    const candidates = router
        .packsOfType("JournalEntry")
        .filter((name) => compiledPack(name) && router.privateOf(name) && !router.systemOf(name));
    const preferred = router.defaultOf("JournalEntry");
    const pack =
        candidates.includes(preferred) ? preferred
        : candidates.length === 1 ? candidates[0]
        : undefined;
    if (!pack) {
        const file = configSourcePath(config) ?? "package-build.config.yaml";
        const message =
            "Differing actual and apparent populations require one private JournalEntry destination; configure a unique system-neutral private pack or a private default.";
        const finding = { file, severity: "error", message };
        throw Object.assign(new Error(formatDiagnostic(finding)), {
            located: true,
            findings: [finding],
        });
    }
    return { pack, subjects: subjects.sort((a, b) => a.address.localeCompare(b.address, "en")) };
}

/**
 * The small private population entry, without a copy of the subject's prose.
 * @param {object} subject - From populationJournalPlan.
 * @param {(address:string)=>object|undefined} [resolve] - Compiled references.
 * @returns {string} Markdown for the private journal only.
 */
export function populationJournalMarkdown(subject, resolve) {
    const escape = (value) =>
        String(value)
            .replace(/[\\|\[\]{}*_<>]/g, "\\$&")
            .replace(/[\r\n]+/g, " ");
    const target = resolve?.(subject.address);
    const name = escape(subject.name);
    const heading = target?.uuid ? `@UUID[${target.uuid}]{${name}}` : name;
    const number = (value) => (value === null ? "Unknown" : value.toLocaleString("en-US"));
    return (
        `${heading}\n\n| Population | Actual | Apparent |\n| --- | ---: | ---: |\n` +
        subject.facts
            .map(
                (fact) =>
                    `| ${escape(fact.label)} | ${number(fact.actual)} | ${number(fact.apparent)} |`,
            )
            .join("\n")
    );
}
