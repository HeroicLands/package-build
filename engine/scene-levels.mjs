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
 * **Scene ↔ Level integrity** for a compiled compendium pack (issue #1538).
 *
 * A v14 Scene keeps its map image on an embedded `Level`, and a compiled pack
 * stores the two in *separate* LevelDB keys: the Scene at `!scenes!<id>`
 * holding `levels` as an array of ids, and each Level at
 * `!scenes.levels!<sceneId>.<levelId>`. Nothing in Foundry ties them together
 * on read. If a Level record is missing, `EmbeddedCollectionField#expandEmbedded`
 * merely warns
 *
 * > _N embedded levels records in Level `<sceneId>` were undefined and not
 * > retrieved from the scenes.levels sublevel_
 *
 * and yields an empty collection. The very next world launch migrates that
 * scene, **persists `levels: []`**, and leaves `initialLevel` pointing at an id
 * that no longer exists — measured on both 14.359 and 14.367. The map image is
 * gone for good, and the only symptom a human sees is a blank battlemap.
 *
 * Foundry is behaving correctly there: a scene with no Level records genuinely
 * has no levels. The damage is that the condition is *unobservable* until it is
 * permanent. So the pack build asserts the invariant on the artefact it just
 * wrote — the compiled LevelDB, not the JSON it was compiled from — because the
 * gap this closes is the write path (the emitter is already unit-tested, and
 * the compendium CLI has previously mishandled Scene Levels).
 *
 * An {@link https://foundryvtt.com/api/classes/foundry.documents.BaseAdventure.html Adventure}
 * carries its scenes *inline*, levels and all, so the same invariant has a
 * second shape and a second way to ship a mapless map; both are checked here.
 *
 * Plain ESM with no Foundry, so the rule itself is a pure function over records
 * and is unit-tested directly.
 *
 * **What a report has to say (#9).** The likeliest way to meet any of this is a
 * compendium CLI older than {@link LEVEL_SPLITTING_CLI}, which does not split
 * Scene Levels into the sublevel at all — so the guard fires on every scene at
 * once, and each `levels` entry is an inline Level *object* rather than an id.
 * Two rules keep that legible: an entry is named by the **shape it has** (an
 * object interpolated into a key reads `[object Object]` and names a key that
 * could not exist), and a pack with **no** `!scenes.levels!` records at all is
 * one fact about the compile, reported once, not once per scene.
 *
 * @module
 */

import { createRequire } from "node:module";

import { ClassicLevel } from "classic-level";

/** LevelDB key prefix for a pack's primary Scene records. */
const SCENE_PREFIX = "!scenes!";

/** LevelDB key prefix for the `levels` sublevel of those Scene records. */
const LEVEL_PREFIX = "!scenes.levels!";

/** LevelDB key prefix for a pack's Adventure records. */
const ADVENTURE_PREFIX = "!adventures!";

/**
 * The compendium CLI release that began splitting Scene Levels into the
 * `!scenes.levels!` sublevel. Anything older writes them inline on the Scene
 * document, which is the shape the reports below name (#9).
 */
const LEVEL_SPLITTING_CLI = "3.0.3";

/**
 * The version of `@foundryvtt/foundryvtt-cli` this build actually resolves.
 *
 * Resolved from *this* module, so it names the copy the pack compile runs on
 * rather than whatever a shell happens to find. The installed version is the
 * write path, so it is the fact a report should carry.
 *
 * @returns {string | undefined} The resolved version, or `undefined` when the
 *   package cannot be read (a pruned install, an exports-restricted copy).
 */
export function compendiumCliVersion() {
    try {
        return createRequire(import.meta.url)(
            "@foundryvtt/foundryvtt-cli/package.json",
        ).version;
    } catch {
        return undefined;
    }
}

/**
 * Is a `levels` entry an inline Level document rather than an id?
 *
 * @param {unknown} entry - One entry of a scene's `levels` array.
 * @returns {boolean} True for an object, which on a compiled `!scenes!` record
 *   is always the wrong shape.
 */
function isInlineLevel(entry) {
    return typeof entry === "object" && entry !== null;
}

/**
 * The Level id an entry names, in whichever shape it named it.
 *
 * @param {unknown} entry - One entry of a scene's `levels` array.
 * @returns {string | undefined} The id, or `undefined` when it names none.
 */
function levelIdOf(entry) {
    if (typeof entry === "string" && entry) return entry;
    if (isInlineLevel(entry) && typeof entry._id === "string" && entry._id) {
        return entry._id;
    }
    return undefined;
}

/**
 * Name a `levels` entry by the shape it actually has.
 *
 * @param {unknown} entry - One entry of a scene's `levels` array.
 * @param {number} index - Its position, which the report cites.
 * @returns {string} A phrase naming the entry, never `[object Object]`.
 */
function describeEntry(entry, index) {
    if (isInlineLevel(entry))
        return `\`levels[${index}]\` is ${describeShape(entry)}`;
    return `\`levels[${index}]\` is ${JSON.stringify(entry) ?? String(entry)}`;
}

/**
 * Name an inline Level object by its `_id`, the fact that identifies it.
 *
 * @param {object} entry - An inline Level object.
 * @returns {string} A phrase naming it, never `[object Object]`.
 */
function describeShape(entry) {
    const id = levelIdOf(entry);
    return `an inline Level object (\`_id\`: ${id ? `"${id}"` : "absent"})`;
}

/**
 * The `levels` a scene declares, in whatever shape it declared them.
 *
 * @param {object} scene - The scene document.
 * @returns {unknown[]} Its declared entries, empty when it declares none.
 */
function declaredLevels(scene) {
    return Array.isArray(scene?.levels) ? scene.levels : [];
}

/**
 * How to name a scene in a problem report.
 *
 * @param {string} sceneId - The scene's id.
 * @param {object} scene - The scene document.
 * @returns {string} A phrase naming it by name and id.
 */
function nameScene(sceneId, scene) {
    return `Scene "${scene?.name ?? sceneId}" [${sceneId}]`;
}

/**
 * Does a compendium CLI version predate {@link LEVEL_SPLITTING_CLI}?
 *
 * @param {string | undefined} version - A resolved version, if one is known.
 * @returns {boolean | undefined} Whether it predates the split, or `undefined`
 *   when there is no version to judge or it does not parse.
 */
function predatesLevelSplitting(version) {
    const parse = (value) => String(value).split(/[.+-]/, 3).map(Number);
    const found = parse(version);
    if (found.length < 3 || found.some((part) => !Number.isInteger(part))) {
        return undefined;
    }
    const want = parse(LEVEL_SPLITTING_CLI);
    for (const [index, part] of found.entries()) {
        if (part !== want[index]) return part < want[index];
    }
    return false;
}

/**
 * What to do about it, decided from the version actually resolved — so the
 * report ends in an instruction rather than a lead to follow (#9).
 *
 * @param {string | undefined} cliVersion - The resolved compendium CLI
 *   version, when it is known.
 * @returns {string} A sentence naming the next step.
 */
function describeRemedy(cliVersion) {
    const older = predatesLevelSplitting(cliVersion);
    if (older === true) {
        return (
            `The resolved \`@foundryvtt/foundryvtt-cli\` is ${cliVersion}, ` +
            `which predates ${LEVEL_SPLITTING_CLI}: install ` +
            `${LEVEL_SPLITTING_CLI} or newer and recompile.`
        );
    }
    if (older === false) {
        return (
            `The resolved \`@foundryvtt/foundryvtt-cli\` is ${cliVersion}, ` +
            `which does split them — so check ` +
            `\`npm ls @foundryvtt/foundryvtt-cli\` for a second, older copy, ` +
            `then recompile.`
        );
    }
    return (
        `Check the installed \`@foundryvtt/foundryvtt-cli\` ` +
        `(\`npm ls @foundryvtt/foundryvtt-cli\`; ${LEVEL_SPLITTING_CLI} or ` +
        `newer is required) and recompile.`
    );
}

/**
 * The pack declares Levels and holds **no** `!scenes.levels!` records at all.
 *
 * That is one fact about the compile, not one per scene, so it is reported
 * once with every affected scene named. A pack that lost a single record lost
 * it on that record's write path; a pack that has none never split them, which
 * is what a compendium CLI older than {@link LEVEL_SPLITTING_CLI} does — two
 * different diagnoses, so the message names whichever shape it found rather
 * than guessing (#9).
 *
 * @param {Array<[string, object]>} declaring - `[sceneId, scene]` for every
 *   scene declaring at least one level.
 * @param {string | undefined} cliVersion - The resolved compendium CLI
 *   version, when it is known.
 * @returns {string} One report covering every affected scene.
 */
function describeWholesaleLoss(declaring, cliVersion) {
    const inline = declaring.some(([, scene]) =>
        declaredLevels(scene).some(isInlineLevel),
    );
    const list = declaring
        .map(([sceneId, scene]) => {
            const entries = declaredLevels(scene)
                .map((entry) =>
                    isInlineLevel(entry) ? describeShape(entry) : `"${entry}"`,
                )
                .join(", ");
            return `${nameScene(sceneId, scene)} → ${entries}`;
        })
        .join("; ");
    const cause =
        inline ?
            `Those entries are inline Level objects rather than ids, which is ` +
            `what \`@foundryvtt/foundryvtt-cli\` older than ` +
            `${LEVEL_SPLITTING_CLI} writes: it does not split Scene Levels ` +
            `into the ${LEVEL_PREFIX} sublevel.`
        :   `The whole ${LEVEL_PREFIX} sublevel is missing rather than one ` +
            `record, so the fault is in the compile step and not in any one ` +
            `Scene.`;
    const count = declaring.length;
    return (
        `The compiled pack has no ${LEVEL_PREFIX} records at all, but ` +
        `${count} Scene${count === 1 ? "" : "s"} ` +
        `declare${count === 1 ? "s" : ""} Levels — ${list} — so every one of ` +
        `those map images is lost. ${cause} ${describeRemedy(cliVersion)}`
    );
}

/**
 * Check the `levels` a scene declares, whatever shape it declared them in.
 *
 * Each violation is reported once, at its most specific: a level id whose
 * record is missing is reported by the caller, and does not also count as the
 * scene "having no Level" — one broken fact, one message.
 *
 * @param {object} scene - The scene document.
 * @param {string[]} levelIds - The Level ids the scene declares.
 * @param {string} where - How to name the scene in a problem report.
 * @returns {string[]} A problem per broken rule; empty when the scene is sound.
 */
function checkDeclaredLevels(scene, levelIds, where) {
    if (!levelIds.length) {
        return [
            `${where} has no Level — its map image cannot be stored, and ` +
                `Foundry will persist \`levels: []\` on the next world launch.`,
        ];
    }
    const initial = scene.initialLevel;
    if (initial && !levelIds.includes(initial)) {
        return [
            `${where} names initialLevel "${initial}", which is not one of ` +
                `its levels (${levelIds.join(", ")}) — a dangling reference.`,
        ];
    }
    return [];
}

/**
 * Every way a compiled pack can ship a Scene that has lost its Level.
 *
 * @param {Iterable<[string, object]>} records - `[key, value]` pairs from a
 *   compiled pack's LevelDB, in any order.
 * @param {object} [options] - Reporting context.
 * @param {string} [options.cliVersion] - The resolved compendium CLI version,
 *   which decides what a wholesale loss is blamed on. Defaults to unknown,
 *   which leaves the report to say only what it can prove.
 * @returns {string[]} One human-readable problem per violation, empty when the
 *   pack is sound.
 */
export function checkSceneLevels(records, { cliVersion } = {}) {
    /** @type {Array<[string, object]>} `!scenes!` records, by key. */
    const scenes = [];
    /** @type {Set<string>} `<sceneId>.<levelId>` for every sublevel record. */
    const levelKeys = new Set();
    /** @type {Array<object>} `!adventures!` records. */
    const adventures = [];

    for (const [key, value] of records) {
        if (key.startsWith(LEVEL_PREFIX)) {
            levelKeys.add(key.slice(LEVEL_PREFIX.length));
        } else if (key.startsWith(SCENE_PREFIX)) {
            scenes.push([key.slice(SCENE_PREFIX.length), value]);
        } else if (key.startsWith(ADVENTURE_PREFIX)) {
            adventures.push(value);
        }
    }

    const problems = [];

    // No scene in the pack has a Level record: one fact about the compile,
    // which saying per scene would bury. Scenes declaring nothing are not
    // covered by it, so they are still judged individually below.
    const declaring = scenes.filter(
        ([, scene]) => declaredLevels(scene).length,
    );
    const wholesale = levelKeys.size === 0 && declaring.length > 0;
    if (wholesale) problems.push(describeWholesaleLoss(declaring, cliVersion));

    for (const [sceneId, scene] of scenes) {
        const declared = declaredLevels(scene);
        if (wholesale && declared.length) continue;
        const where = nameScene(sceneId, scene);

        // Judge each entry by the shape it has: a compiled `!scenes!` record
        // stores ids, so an inline Level object is itself the defect, and
        // naming it is what identifies the cause.
        const broken = [];
        declared.forEach((entry, index) => {
            const id = levelIdOf(entry);
            if (isInlineLevel(entry)) {
                broken.push(
                    `${where}: ${describeEntry(entry, index)}, not an id — a ` +
                        `compiled pack stores each Level as its own ` +
                        `${LEVEL_PREFIX}<sceneId>.<levelId> record, and none ` +
                        `exists at ${LEVEL_PREFIX}${sceneId}.${id ?? "<id>"}. ` +
                        `Inline Levels are what ` +
                        `\`@foundryvtt/foundryvtt-cli\` older than ` +
                        `${LEVEL_SPLITTING_CLI} writes.`,
                );
            } else if (!id) {
                broken.push(
                    `${where}: ${describeEntry(entry, index)}, not a Level id.`,
                );
            } else if (!levelKeys.has(`${sceneId}.${id}`)) {
                broken.push(
                    `${where} lists level "${id}", but no record exists at ` +
                        `${LEVEL_PREFIX}${sceneId}.${id} — the map image is ` +
                        `lost.`,
                );
            }
        });

        // A broken entry is already reported above; only the declaration
        // itself is judged here, so nothing is reported twice.
        if (broken.length) problems.push(...broken);
        else
            problems.push(...checkDeclaredLevels(scene ?? {}, declared, where));
    }

    for (const adventure of adventures) {
        const inline = Array.isArray(adventure?.scenes) ? adventure.scenes : [];
        for (const scene of inline) {
            const levelIds = declaredLevels(scene).map(
                (level) => levelIdOf(level) ?? level,
            );
            const where =
                `Adventure "${adventure?.name ?? adventure?._id}" scene ` +
                `"${scene?.name ?? scene?._id}"`;
            problems.push(...checkDeclaredLevels(scene ?? {}, levelIds, where));
        }
    }

    return problems;
}

/**
 * Read a compiled pack back off disk and check it.
 *
 * The pack is opened after the compendium CLI has closed it, so this reads the
 * bytes that will actually ship rather than the JSON they were compiled from.
 *
 * @param {string} packDir - Directory of the compiled LevelDB pack.
 * @returns {Promise<string[]>} The problems found, empty when the pack is sound.
 */
export async function verifyPackSceneLevels(packDir) {
    const db = new ClassicLevel(packDir, {
        keyEncoding: "utf8",
        valueEncoding: "json",
        createIfMissing: false,
    });
    await db.open();
    try {
        const records = [];
        for await (const entry of db.iterator()) records.push(entry);
        return checkSceneLevels(records, {
            cliVersion: compendiumCliVersion(),
        });
    } finally {
        await db.close();
    }
}
