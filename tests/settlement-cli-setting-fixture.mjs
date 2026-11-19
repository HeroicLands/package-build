/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";

export function loadSettingCheckResources({ indexFile }) {
    return {
        resources: {
            index: {
                id: { name: "fixture", version: "1", source: indexFile },
                records: fs.readFileSync(indexFile, "utf8").trim().split("\n").map(JSON.parse),
            },
            words: new Set(["blocked"]),
            names: new Set(["reserved"]),
        },
    };
}
export function createSettingChecks(resources, { selected }) {
    return {
        validators: {
            spelling: (name) => ({ available: true, valid: /^[a-z]+$/.test(name) }),
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
