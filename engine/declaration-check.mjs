/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import ts from "typescript";

/** All declaration entry points advertised by a package's exports map. */
export function exportedDeclarationFiles(root) {
    const manifest = path.join(root, "package.json");
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const files = new Set();
    const findings = [];
    for (const entry of Object.values(pkg.exports ?? {})) {
        const declared = typeof entry === "object" && entry !== null ? entry.types : null;
        if (typeof declared !== "string") continue;
        const pattern = path.resolve(root, declared);
        const matches = pattern.includes("*") ? globSync(pattern) : [pattern];
        if (!matches.length || matches.some((file) => !fs.existsSync(file))) {
            findings.push({
                file: manifest,
                severity: "error",
                message: `exported declaration ${declared} does not exist`,
            });
        }
        for (const file of matches) {
            if (fs.existsSync(file)) files.add(file);
        }
    }
    return { files: [...files].sort(), findings };
}

/**
 * Type-check project declarations with library checking enabled.
 * @param {string} project - TypeScript project file.
 * @param {{exports?: boolean}} [options]
 * @returns {Array<{file: string, line?: number, column?: number, severity: "error", message: string}>}
 */
export function checkDeclarations(project, options = {}) {
    const requestedProject = path.resolve(project);
    const configFile =
        fs.existsSync(requestedProject) ? fs.realpathSync(requestedProject) : requestedProject;
    const root = path.dirname(configFile);
    const findings = [];
    const report = (diagnostic) => {
        if (diagnostic.file?.fileName.split(path.sep).includes("node_modules")) return;
        const position =
            diagnostic.file && diagnostic.start !== undefined ?
                diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
            :   null;
        findings.push({
            file: diagnostic.file?.fileName ?? configFile,
            ...(position ? { line: position.line + 1, column: position.character + 1 } : {}),
            severity: "error",
            message: `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
        });
    };
    const source = ts.readConfigFile(configFile, ts.sys.readFile);
    if (source.error) {
        report(source.error);
        return findings;
    }
    const parsed = ts.parseJsonConfigFileContent(
        source.config,
        ts.sys,
        root,
        {
            skipLibCheck: false,
            noEmit: true,
        },
        configFile,
    );
    for (const diagnostic of parsed.errors) {
        if (!(options.exports && diagnostic.code === 18003)) report(diagnostic);
    }
    const roots = new Set(parsed.fileNames);
    if (options.exports) {
        const exported = exportedDeclarationFiles(root);
        findings.push(...exported.findings);
        for (const file of exported.files) roots.add(file);
    }
    const program = ts.createProgram([...roots], parsed.options);
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) report(diagnostic);
    return findings;
}
