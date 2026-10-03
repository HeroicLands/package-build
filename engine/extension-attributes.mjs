/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A name an id, a class or an attribute key may carry.
 *
 * One letter first, then letters, digits, `_` and `-`: a CSS class and an
 * attribute key are written this way wherever they appear.
 */
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Read the shared braced attribute grammar used by body extensions.
 * Callers validate which names and classes their extension understands.
 * @param {string} source - Text inside the braces.
 * @param {object} [options={}]
 * @param {RegExp} [options.idPattern=NAME] - What an `#id` may be named. A
 *   construct whose id is published as an HTML `id` admits a digit first and
 *   passes a looser pattern; the default is the pattern every other name takes.
 * @returns {{id: string, classes: string[], values: Record<string, string>, problems: string[]}}
 */
export function parseExtensionAttributes(source, { idPattern = NAME } = {}) {
    const text = String(source ?? "");
    const result = { id: "", classes: [], values: {}, problems: [] };
    let at = 0;
    while (at < text.length) {
        while (/\s/.test(text[at] ?? "")) at++;
        if (at >= text.length) break;
        const start = at;
        if (text[at] === "#" || text[at] === ".") {
            const kind = text[at++];
            while (at < text.length && !/\s/.test(text[at])) at++;
            const name = text.slice(start + 1, at);
            if (!(kind === "#" ? idPattern : NAME).test(name)) {
                result.problems.push(
                    `invalid ${kind === "#" ? "id" : "class"} attribute ${text.slice(start, at)}`,
                );
            } else if (kind === "#") {
                if (result.id) result.problems.push("an attribute list has more than one id");
                else result.id = name;
            } else if (result.classes.includes(name)) {
                result.problems.push(`class .${name} is written twice`);
            } else result.classes.push(name);
            continue;
        }
        const key = /^[A-Za-z][A-Za-z0-9_-]*/.exec(text.slice(at))?.[0];
        if (!key || text[at + key.length] !== "=") {
            while (at < text.length && !/\s/.test(text[at])) at++;
            result.problems.push(`${text.slice(start, at)} is not a key=value attribute`);
            continue;
        }
        at += key.length + 1;
        let value = "";
        if (text[at] === '"') {
            at++;
            let closed = false;
            while (at < text.length) {
                if (text[at] === '"') {
                    at++;
                    closed = true;
                    break;
                }
                if (text[at] === "\\" && ["\\", '"'].includes(text[at + 1])) at++;
                value += text[at++];
            }
            if (!closed) result.problems.push(`${key} has an unclosed quoted value`);
            if (at < text.length && !/\s/.test(text[at])) {
                while (at < text.length && !/\s/.test(text[at])) at++;
                result.problems.push(`${key} has text after its quoted value`);
            }
        } else {
            while (at < text.length && !/\s/.test(text[at])) value += text[at++];
            if (/[{},"\[\]]/.test(value)) result.problems.push(`${key} needs a quoted value`);
        }
        if (!value) result.problems.push(`${key} needs a value`);
        if (Object.hasOwn(result.values, key)) result.problems.push(`${key} is written twice`);
        else result.values[key] = value;
    }
    return result;
}

/** A Boolean attribute is spelled exactly `true` or `false`. */
export function booleanAttribute(value, key) {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new TypeError(`${key} needs the literal value true or false`);
}
