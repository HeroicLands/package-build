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
 * The declared signatures of the package's exports, read from the source.
 *
 * `docs/api.md` states each function's signature. This module reads the same
 * signature from the code, resolving re-exports to the declaration that holds
 * the parameter list, so the document can be held to it.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * One export as the source declares it.
 *
 * @typedef {object} ExportedDeclaration
 * @property {"function"|"async function"|"class"|"const"|"namespace"} kind How the export is declared.
 * @property {string|undefined} params The parameter list, without parentheses; `undefined` for a non-function.
 * @property {string} file The file holding the declaration, relative to the package root.
 */

/**
 * Every `.mjs` file under a directory, sorted.
 *
 * @param {string} directory - The directory to list, absolute.
 * @returns {string[]} The files, absolute.
 */
function mjsFilesIn(directory) {
    return fs
        .readdirSync(directory)
        .filter((entry) => entry.endsWith(".mjs"))
        .sort()
        .map((entry) => path.join(directory, entry));
}

/**
 * Every module a consumer can import: the package's root-level subpath entries
 * and every module of the `engine`, `sohl` and `hm3` directories.
 *
 * @param {string} root - The package root, absolute.
 * @returns {string[]} The module files, absolute.
 */
export function reachableModuleFiles(root) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const files = new Set();
    for (const [entry, target] of Object.entries(manifest.exports)) {
        if (entry.endsWith("*") || entry === "./package.json") continue;
        const file = typeof target === "string" ? target : target.import;
        files.add(path.join(root, file));
    }
    for (const directory of ["engine", "sohl", "hm3"]) {
        for (const file of mjsFilesIn(path.join(root, directory))) files.add(file);
    }
    return [...files].sort();
}

/**
 * Render a binding name the way the reference writes it.
 *
 * @param {ts.BindingName} name - The parameter's or element's name.
 * @returns {string} `a`, `{ a, b, ...rest }`, an object member by its property name, or `[a, b]`, defaults dropped.
 */
function renderBinding(name) {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isObjectBindingPattern(name)) {
        if (!name.elements.length) return "{}";
        const members = name.elements.map((element) => {
            const rest = element.dotDotDotToken ? "..." : "";
            const target = renderBinding(element.name);
            return element.propertyName ?
                    `${rest}${element.propertyName.getText()}`
                :   `${rest}${target}`;
        });
        return `{ ${members.join(", ")} }`;
    }
    const members = name.elements.map((element) =>
        ts.isOmittedExpression(element) ? "" : (
            `${element.dotDotDotToken ? "..." : ""}${renderBinding(element.name)}`
        ),
    );
    return `[${members.join(", ")}]`;
}

/**
 * Whether JSDoc declares a parameter optional, as `[name]` or `{type=}`.
 *
 * @param {ts.ParameterDeclaration} param - The parameter.
 * @returns {boolean} Whether a `@param` tag marks it optional.
 */
function jsdocOptional(param) {
    return ts
        .getJSDocParameterTags(param)
        .some(
            (tag) =>
                tag.isBracketed ||
                (tag.typeExpression && ts.isJSDocOptionalType(tag.typeExpression.type)),
        );
}

/**
 * The source text of a default value, on one line and without wrapping parentheses.
 *
 * @param {ts.Expression} initializer - The default value.
 * @returns {string} The text, such as `{}`.
 */
function initializerText(initializer) {
    let node = initializer;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return node.getText().replace(/\s+/g, " ");
}

/**
 * Render one parameter the way the reference writes it.
 *
 * A plain name is followed by `?` when it has a default or JSDoc marks it
 * optional; a destructured pattern keeps its default, such as `= {}`.
 *
 * @param {ts.ParameterDeclaration} param - The parameter.
 * @returns {string} The rendered parameter.
 */
function renderParam(param) {
    const rest = param.dotDotDotToken ? "..." : "";
    const name = renderBinding(param.name);
    if (!ts.isIdentifier(param.name)) {
        return param.initializer ?
                `${rest}${name} = ${initializerText(param.initializer)}`
            :   `${rest}${name}`;
    }
    const optional = param.initializer || param.questionToken || jsdocOptional(param);
    return `${rest}${name}${optional ? "?" : ""}`;
}

/**
 * Render a function's parameter list the way the reference writes it.
 *
 * @param {ts.SignatureDeclaration} declaration - The function-like declaration.
 * @returns {string} The parameters, comma-separated.
 */
function renderParams(declaration) {
    return declaration.parameters.map(renderParam).join(", ");
}

/**
 * The function-like node behind a declaration, when it is one.
 *
 * @param {ts.Declaration} declaration - An exported symbol's declaration.
 * @returns {ts.SignatureDeclaration|undefined} The function, or `undefined`.
 */
function functionOf(declaration) {
    if (ts.isFunctionDeclaration(declaration)) return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        let initializer = declaration.initializer;
        while (ts.isParenthesizedExpression(initializer)) initializer = initializer.expression;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
            return initializer;
        }
    }
    return undefined;
}

/**
 * A program over the reachable modules, for resolving re-exports.
 *
 * @param {string} root - The package root, absolute.
 * @returns {ts.Program} The program.
 */
export function createApiProgram(root) {
    return ts.createProgram(reachableModuleFiles(root), {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
    });
}

/**
 * Every export of one module, each resolved to its declaration.
 *
 * @param {ts.Program} program - From {@link createApiProgram}.
 * @param {string} file - The module, absolute.
 * @param {string} root - The package root, absolute.
 * @returns {Map<string, ExportedDeclaration>} Export name to declaration.
 */
export function moduleExports(program, file, root) {
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(file);
    const result = new Map();
    const symbol = source && checker.getSymbolAtLocation(source);
    if (!symbol) return result;
    for (const exported of checker.getExportsOfModule(symbol)) {
        const resolved =
            exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        if (!(resolved.flags & ts.SymbolFlags.Value)) continue;
        const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
        if (!declaration) continue;
        const where = path.relative(root, declaration.getSourceFile().fileName);
        if (ts.isSourceFile(declaration) || ts.isModuleDeclaration(declaration)) {
            result.set(exported.name, { kind: "namespace", params: undefined, file: where });
            continue;
        }
        const fn = functionOf(declaration);
        if (fn) {
            const isAsync = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
            result.set(exported.name, {
                kind: isAsync ? "async function" : "function",
                params: renderParams(fn),
                file: where,
            });
        } else {
            result.set(exported.name, {
                kind: ts.isClassDeclaration(declaration) ? "class" : "const",
                params: undefined,
                file: where,
            });
        }
    }
    return result;
}

/**
 * A signature as the code would render it, with the defaults inside a
 * destructured parameter dropped, so a row may show them (`prefix = "SOHL"`).
 *
 * @param {string} signature - A documented signature, such as `async f({ a = 1 } = {})`.
 * @returns {string} The signature in the form {@link renderParams} writes, or
 *   the text unchanged when it does not parse as a parameter list.
 */
function withoutInnerDefaults(signature) {
    const open = signature.indexOf("(");
    const close = signature.lastIndexOf(")");
    if (open < 0 || close < open) return signature;
    const source = ts.createSourceFile(
        "signature.mjs",
        `function f(${signature.slice(open + 1, close)}) {}`,
        ts.ScriptTarget.ES2022,
        true,
    );
    const declaration = source.statements[0];
    if (!declaration || !ts.isFunctionDeclaration(declaration)) return signature;
    return `${signature.slice(0, open)}(${renderParams(declaration)})${signature.slice(close + 1)}`;
}

/**
 * Split one Markdown table row into its cells; a `\|` inside a cell is a pipe.
 *
 * @param {string} line - A table row.
 * @returns {string[]} The trimmed cells.
 */
function tableCells(line) {
    const cells = [];
    let current = "";
    let inCode = false;
    for (let index = 1; index < line.length; index++) {
        const char = line[index];
        if (char === "\\" && line[index + 1] === "|") {
            current += "|";
            index++;
        } else if (char === "`") {
            inCode = !inCode;
            current += char;
        } else if (char === "|" && !inCode) {
            cells.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    return cells;
}

/**
 * The module file a heading of `docs/api.md` introduces, when it names one.
 *
 * @param {string} heading - A `##` or `###` heading line.
 * @param {ts.Program} program - From {@link createApiProgram}.
 * @param {string} root - The package root, absolute.
 * @returns {string|undefined} The module, absolute, or `undefined`.
 */
function moduleOfHeading(heading, program, root) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    let match = heading.match(/^### `(engine|sohl|hm3)\.([A-Za-z0-9_$]+)`/);
    if (match) {
        const barrel = path.join(root, match[1], "index.mjs");
        const found = moduleExports(program, barrel, root).get(match[2]);
        return found ? path.join(root, found.file) : undefined;
    }
    match = heading.match(/^## `(\.[^`]*)`/);
    if (match) {
        const target = manifest.exports[match[1]];
        if (!target || match[1].includes("*") || match[1] === "./package.json") return undefined;
        const file = typeof target === "string" ? target : (target.import ?? target.default);
        return path.join(root, file);
    }
    match = heading.match(/^### `\.?\/?(engine|sohl|hm3)\/([a-z0-9-]+)(?:\.mjs)?`/);
    return match ? path.join(root, match[1], `${match[2]}.mjs`) : undefined;
}

/**
 * The function signatures `docs/api.md` states that differ from the code.
 *
 * Every row whose signature cell begins `function` or `async function` is
 * compared with the parameter list of the declaration it names. The module
 * comes from the nearest heading; a row under another heading resolves by
 * name when every module exporting that name declares one signature.
 *
 * @param {string} markdown - The text of `docs/api.md`.
 * @param {string} root - The package root, absolute.
 * @returns {string[]} One message per row that differs or cannot be resolved.
 */
export function signatureProblems(markdown, root) {
    const program = createApiProgram(root);
    const modules = new Map(
        reachableModuleFiles(root).map((file) => [file, moduleExports(program, file, root)]),
    );
    const byName = new Map();
    for (const exported of modules.values()) {
        for (const [name, declaration] of exported) {
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push(declaration);
        }
    }
    const problems = [];
    const seen = new Set();
    let current;
    let heading = "";
    for (const [index, line] of markdown.split("\n").entries()) {
        if (/^#{2,3} /.test(line)) {
            current = moduleOfHeading(line, program, root);
            heading = line;
            continue;
        }
        const row = line.match(/^\| `([A-Za-z0-9_$]+)` +\| /);
        if (!row) continue;
        const signature = tableCells(line)[1]?.replace(/^`|`$/g, "");
        const name = row[1];
        const isFunction = /^(async )?function /.test(signature ?? "");
        const bare = signature?.replace(/^(?:async|await) /, "");
        if (!signature || !(isFunction || bare.startsWith(`${name}(`))) continue;
        const where = `docs/api.md:${index + 1}: \`${name}\``;
        const key = `${heading}:${name}`;
        if (seen.has(key)) problems.push(`${where} is documented twice in one module`);
        seen.add(key);
        let declaration = current && modules.get(current)?.get(name);
        if (!declaration) {
            const candidates = byName.get(name) ?? [];
            const distinct = new Set(candidates.map((entry) => `${entry.kind} ${entry.params}`));
            if (distinct.size === 1) declaration = candidates[0];
        }
        if (declaration?.params === undefined) {
            problems.push(`${where} names no function the code declares`);
            continue;
        }
        const expected =
            isFunction ?
                `${declaration.kind} ${name}(${declaration.params})`
            :   `${declaration.kind === "async function" ? "async " : ""}${name}(${declaration.params})`;
        if (withoutInnerDefaults(signature) !== expected) {
            problems.push(`${where} states \`${signature}\`; the code declares \`${expected}\``);
        }
    }
    return problems;
}

/**
 * The names `docs/api.md` documents: a table row's first cell, and the member
 * of a `engine.`, `sohl.` or `hm3.` namespace heading.
 *
 * @param {string} markdown - The text of `docs/api.md`.
 * @returns {Set<string>} The documented names.
 */
export function documentedNames(markdown) {
    const names = new Set();
    for (const match of markdown.matchAll(/^\|\s*`([A-Za-z0-9_$]+)`\s*\|/gm)) names.add(match[1]);
    for (const match of markdown.matchAll(/^### `(?:engine|sohl|hm3)\.([A-Za-z0-9_$]+)`/gm)) {
        names.add(match[1]);
    }
    return names;
}

/**
 * The exports `docs/api.md` documents, each identified by the file that declares
 * it and its export name, so a same-named export of another module is not
 * credited by a row it does not own.
 *
 * A row under a module's heading documents that module's export of the name;
 * a row elsewhere documents every declaration of that name.
 *
 * @param {string} markdown - The text of `docs/api.md`.
 * @param {string} root - The package root, absolute.
 * @param {ts.Program} program - From {@link createApiProgram}.
 * @returns {Set<string>} Keys of the form `<declaring file>#<name>`.
 */
function documentedExports(markdown, root, program) {
    const modules = new Map(
        reachableModuleFiles(root).map((file) => [file, moduleExports(program, file, root)]),
    );
    const key = (declaration, name) => `${declaration.file}#${name}`;
    const credited = new Set();
    let current;
    for (const line of markdown.split("\n")) {
        if (/^#{2,3} /.test(line)) {
            current = moduleOfHeading(line, program, root);
            const space = line.match(/^### `(engine|sohl|hm3)\.([A-Za-z0-9_$]+)`/);
            if (space) {
                const barrel = modules.get(path.join(root, space[1], "index.mjs"));
                const declaration = barrel?.get(space[2]);
                if (declaration) credited.add(key(declaration, space[2]));
            }
            continue;
        }
        const row = line.match(/^\|\s*`([A-Za-z0-9_$]+)`\s*\|/);
        if (!row) continue;
        const own = current && modules.get(current)?.get(row[1]);
        if (own) {
            credited.add(key(own, row[1]));
            continue;
        }
        for (const exported of modules.values()) {
            const declaration = exported.get(row[1]);
            if (declaration) credited.add(key(declaration, row[1]));
        }
    }
    return credited;
}

/**
 * Every module of `engine/`, `sohl/` and `hm3/` with the status the reference
 * must give it: `supported` when every export of the module is documented
 * there, `internal` otherwise.
 *
 * @param {string} markdown - The text of `docs/api.md`.
 * @param {string} root - The package root, absolute.
 * @returns {Map<string, "supported"|"internal">} Module name, such as
 *   `engine/content-address`, to status, in directory then name order.
 */
export function moduleStatuses(markdown, root) {
    const program = createApiProgram(root);
    const documented = documentedExports(markdown, root, program);
    const statuses = new Map();
    for (const directory of ["engine", "sohl", "hm3"]) {
        for (const file of mjsFilesIn(path.join(root, directory))) {
            const exported = moduleExports(program, file, root);
            const supported =
                exported.size > 0 &&
                [...exported].every(([name, declaration]) =>
                    documented.has(`${declaration.file}#${name}`),
                );
            statuses.set(
                `${directory}/${path.basename(file, ".mjs")}`,
                supported ? "supported" : "internal",
            );
        }
    }
    return statuses;
}
