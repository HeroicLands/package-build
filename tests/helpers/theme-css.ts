/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Reading the shared theme's stylesheet, for the guards that assert what it
 * covers.
 *
 * Enough of a stylesheet to answer "is this class styled, and with what?" —
 * not a CSS parser. The guards ask only that question.
 */

export interface CssRule {
    selector: string;
    body: string;
}

/**
 * Every style rule in a stylesheet, as a selector and the declarations under
 * it. At-rule preludes are dropped and the rules nested inside them kept, so a
 * declaration inside a media query counts exactly as one outside it.
 */
export function rules(css: string): CssRule[] {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const preludes: string[] = [];
    const out: CssRule[] = [];
    let buf = "";
    for (const ch of clean) {
        if (ch === "{") {
            preludes.push(buf.trim());
            buf = "";
        } else if (ch === "}") {
            const selector = preludes.pop() ?? "";
            if (!selector.startsWith("@")) out.push({ selector, body: buf });
            buf = "";
        } else {
            buf += ch;
        }
    }
    return out;
}

/** The line a class is first named on, so a failure can point at the rule. */
export function lineOf(source: string, className: string): number {
    const index = source.split("\n").findIndex((l) => l.includes(`.${className}`));
    return index === -1 ? 0 : index + 1;
}

/** Whether any rule naming every class in `classNames` declares `property`. */
export function declares(
    styles: CssRule[],
    classNames: string | string[],
    property: string,
): boolean {
    const names = [classNames].flat();
    return styles.some(
        (rule) =>
            names.every((name) => rule.selector.includes(`.${name}`)) &&
            new RegExp(`(^|[\\s;{])${property}\\s*:`).test(rule.body),
    );
}

/** Whether any rule names every class in `classNames`. */
export function styled(styles: CssRule[], classNames: string | string[]): boolean {
    const names = [classNames].flat();
    return styles.some((rule) => names.every((name) => rule.selector.includes(`.${name}`)));
}
