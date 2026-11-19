/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";

export function loadSettingCheckResources({
    indexFile,
    guideFile,
    englishWordsFile,
    englishSourcesFile,
}) {
    const guide = fs.readFileSync(guideFile, "utf8");
    const words = JSON.parse(fs.readFileSync(englishWordsFile, "utf8"));
    const sources = JSON.parse(fs.readFileSync(englishSourcesFile, "utf8"));
    if (!guide || !Array.isArray(words) || !sources.baseline?.name)
        throw new Error("setting resources are incomplete");
    return {
        resources: {
            index: {
                id: { name: "fixture", version: "1", source: indexFile },
                records: fs.readFileSync(indexFile, "utf8").trim().split("\n").map(JSON.parse),
            },
            guide: { id: { source: guideFile }, text: guide },
            englishWords: { id: { source: englishWordsFile }, words },
            words: new Set(words),
            names: new Set(["reserved"]),
        },
    };
}
export function createSettingChecks(resources, { selected }) {
    return {
        validators: {
            spelling: (name) => ({
                available: true,
                valid: resources.guide.text.includes("alphabet") && /^[a-z]+$/.test(name),
            }),
            language: (name, context) => ({
                available: Array.isArray(context.language.data.elements),
                valid: name === context.elements.map((part) => part.form).join(""),
            }),
            earthWords: (name) => ({
                available: resources.words instanceof Set,
                valid: !resources.words.has(name),
            }),
            earthNames: (name) => ({
                available: resources.names instanceof Set,
                valid: !resources.names.has(name),
            }),
            indexedNames: (name) => ({
                available: Array.isArray(selected),
                valid:
                    !selected.includes(name) &&
                    !resources.index.records.some((r) => r.name?.full?.toLowerCase() === name),
            }),
        },
    };
}
