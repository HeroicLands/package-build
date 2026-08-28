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
 * Build-time Skill Base evaluation — the small part of SoHL's `SafeExpression`
 * needed to compile a skill's opening mastery level into the pack (#46).
 *
 * A skill's `skillBaseFormula` is a `SafeExpression` in the `skill.base` scope:
 * an expression over one binding, `attr` (attribute scores by shortcode), with
 * the helper library in scope — in practice always `sb(attr.x, attr.y)`. The
 * client evaluates it in `SkillLogic.computeSkillBase`. Nothing here talks to
 * Foundry, so this reproduces the evaluation rather than importing it.
 *
 * **Reproduced deliberately, and it must not drift**: if SoHL changes `sb()`'s
 * rounding or the clamp, a pack compiled here and the client reading it stop
 * agreeing. The two rules copied are:
 *
 * - `sb()` (SoHL `ExpressionHelperRegistry`) — one value is itself; two are
 *   averaged and rounded **up** iff the first exceeds the second, **down**
 *   otherwise (so equal values round down); three or more are averaged and
 *   rounded to nearest.
 * - The clamp (SoHL `SkillLogic.computeSkillBase`) — the result is
 *   `Math.max(0, n)`, and a formula that does not yield a finite number is an
 *   error rather than a silent zero.
 *
 * What is **not** reproduced is the rest of the grammar. This evaluator accepts
 * numeric literals, `attr.<code>` / `attr["<code>"]` reads, calls to the
 * helpers below, parentheses and ordinary arithmetic — and rejects everything
 * else outright. A formula this cannot evaluate is reported, not guessed at.
 */

import { parse } from "acorn";

/**
 * The HârnMaster Skill Base reduction, mirroring SoHL's `sb()` helper exactly.
 *
 * @param {...number} values - One or more attribute values.
 * @returns {number} The reduced Skill Base.
 * @throws {Error} If called with no arguments.
 */
export function sb(...values) {
    if (values.length === 0) {
        throw new Error("sb() requires at least one attribute value");
    }
    const nums = values.map((v) => Number(v));
    if (nums.length === 1) return nums[0];
    if (nums.length === 2) {
        const average = (nums[0] + nums[1]) / 2;
        return nums[0] > nums[1] ? Math.ceil(average) : Math.floor(average);
    }
    const sum = nums.reduce((acc, n) => acc + n, 0);
    return Math.round(sum / nums.length);
}

/**
 * The helper functions a `skill.base` formula may call. SoHL's registry carries
 * far more; only those a Skill Base formula has any use for are offered here,
 * so an unsupported call fails loudly instead of evaluating to something
 * plausible.
 */
const HELPERS = Object.freeze({
    sb,
    min: (...v) => Math.min(...v.map(Number)),
    max: (...v) => Math.max(...v.map(Number)),
    floor: (v) => Math.floor(Number(v)),
    ceil: (v) => Math.ceil(Number(v)),
    round: (v) => Math.round(Number(v)),
    abs: (v) => Math.abs(Number(v)),
});

/** Binary operators the evaluator honours. */
const BINARY = Object.freeze({
    "+": (a, b) => a + b,
    "-": (a, b) => a - b,
    "*": (a, b) => a * b,
    "/": (a, b) => a / b,
    "%": (a, b) => a % b,
    "**": (a, b) => a ** b,
});

/**
 * Read `attr.<code>`, case-insensitively, defaulting to `0`.
 *
 * SoHL wraps its `attr` context in a Proxy so an attribute the actor does not
 * have reads as `0` instead of throwing (`SkillLogic.buildAttrContext`). A
 * plain lookup with the same fallback is equivalent for evaluation.
 *
 * @param {Record<string, number>} attrs - Attribute scores by shortcode.
 * @param {string} code - The attribute shortcode referenced.
 * @returns {number} The score, or `0` when the actor has no such attribute.
 */
function readAttr(attrs, code) {
    const value = attrs[String(code).toLowerCase()];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Evaluate one parsed expression node.
 *
 * @param {object} node - An acorn expression node.
 * @param {Record<string, number>} attrs - Attribute scores by shortcode.
 * @returns {number} The node's value.
 * @throws {Error} On any construct outside the supported subset.
 */
function evalNode(node, attrs) {
    switch (node.type) {
        case "Literal": {
            if (typeof node.value !== "number") {
                throw new Error(
                    `unsupported literal ${JSON.stringify(node.value)}`,
                );
            }
            return node.value;
        }
        case "MemberExpression": {
            // Only `attr.<code>` and `attr["<code>"]`. Any other object, and
            // any computed key that is not a plain string, is out of scope.
            if (node.object?.type !== "Identifier") {
                throw new Error(
                    "only `attr.<code>` member reads are supported",
                );
            }
            if (node.object.name !== "attr") {
                throw new Error(
                    `unknown binding "${node.object.name}" — the skill.base scope binds only \`attr\``,
                );
            }
            if (node.computed) {
                if (
                    node.property.type !== "Literal" ||
                    typeof node.property.value !== "string"
                ) {
                    throw new Error(
                        "a computed `attr[...]` read needs a literal string shortcode",
                    );
                }
                return readAttr(attrs, node.property.value);
            }
            return readAttr(attrs, node.property.name);
        }
        case "CallExpression": {
            if (node.callee?.type !== "Identifier") {
                throw new Error(
                    "only direct calls to a named helper are supported",
                );
            }
            const helper = HELPERS[node.callee.name];
            if (!helper) {
                throw new Error(
                    `unknown helper "${node.callee.name}()" in a skill base formula`,
                );
            }
            return helper(...node.arguments.map((a) => evalNode(a, attrs)));
        }
        case "BinaryExpression": {
            const op = BINARY[node.operator];
            if (!op) {
                throw new Error(`unsupported operator "${node.operator}"`);
            }
            return op(evalNode(node.left, attrs), evalNode(node.right, attrs));
        }
        case "UnaryExpression": {
            const value = evalNode(node.argument, attrs);
            if (node.operator === "-") return -value;
            if (node.operator === "+") return value;
            throw new Error(`unsupported unary operator "${node.operator}"`);
        }
        case "ParenthesizedExpression":
            return evalNode(node.expression, attrs);
        default:
            throw new Error(`unsupported expression node "${node.type}"`);
    }
}

/**
 * Evaluate a `skillBaseFormula` against an actor's attribute scores.
 *
 * Mirrors `SkillLogic.computeSkillBase`: an absent or blank formula is Skill
 * Base `0` (not an error — a skill may legitimately have none), and the result
 * is clamped to `>= 0`.
 *
 * @param {string|null|undefined} formula - The expression source.
 * @param {Record<string, number>} attrs - Attribute scores by shortcode.
 * @returns {{ value: number, error?: string }} The Skill Base, or the reason it
 *   could not be computed. On error `value` is `0`, matching the client.
 */
export function evaluateSkillBase(formula, attrs = {}) {
    const source = typeof formula === "string" ? formula.trim() : "";
    if (!source) return { value: 0 };
    let node;
    try {
        const program = parse(source, { ecmaVersion: 2022 });
        if (
            program.body.length !== 1 ||
            program.body[0].type !== "ExpressionStatement"
        ) {
            return {
                value: 0,
                error: `skill base formula "${source}" is not a single expression`,
            };
        }
        node = program.body[0].expression;
    } catch {
        return {
            value: 0,
            error: `skill base formula "${source}" could not be parsed`,
        };
    }
    try {
        const raw = evalNode(node, attrs);
        if (!Number.isFinite(raw)) {
            return {
                value: 0,
                error: `skill base formula "${source}" did not return a number (got ${String(raw)})`,
            };
        }
        return { value: Math.max(0, raw) };
    } catch (err) {
        return {
            value: 0,
            error: `skill base formula "${source}": ${err.message}`,
        };
    }
}

/**
 * The mastery level an unopened skill opens at, or `null` when it does not
 * open at all.
 *
 * The client's rule (`SkillLogic.initialize`) is `Skill Base × initSkillMult`,
 * applied only when `masteryLevelBase` is unset and the skill is on an actor.
 * Two build-side refinements, neither of which changes what a client computes:
 *
 * - **A zero or absent `initSkillMult` stays `null`.** The multiplier is the
 *   switch for whether a skill opens at all, so writing the `0` the arithmetic
 *   yields would claim the skill opened at zero rather than that it never
 *   opened. `null` is what the field means by *not yet opened*, and the client
 *   arrives at the same place either way.
 * - **A fractional product is an error, not a rounding.** `masteryLevelBase` is
 *   an integer field (`min: 0`), so a fractional value cannot be persisted
 *   honestly — where the client multiplies raw into a modifier and is free to
 *   carry the fraction, this is not. Reporting it follows
 *   `resolveSkillAptitudes`, which rejects a fractional modifier rather than
 *   rounding one.
 *
 * @param {object} system - The merged skill `system` block.
 * @param {Record<string, number>} attrs - Attribute scores by shortcode.
 * @returns {{ value: number|null, error?: string }} The opening mastery level,
 *   `null` to leave the field unset, or the reason it could not be computed.
 */
export function openingMasteryLevel(system = {}, attrs = {}) {
    const mult = Number(system.initSkillMult);
    if (!Number.isFinite(mult) || mult <= 0) return { value: null };

    const base = evaluateSkillBase(system.skillBaseFormula, attrs);
    if (base.error) return { value: null, error: base.error };

    const opened = base.value * mult;
    if (!Number.isInteger(opened)) {
        return {
            value: null,
            error:
                `opening mastery level is ${opened} (skill base ${base.value} × ` +
                `initSkillMult ${mult}), but masteryLevelBase is a whole number — ` +
                `give the skill a multiplier that divides evenly, or state its ` +
                `masteryLevelBase outright`,
        };
    }
    return { value: opened };
}
