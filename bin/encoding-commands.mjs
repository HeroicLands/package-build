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
/** Bare encoding commands: a published definition, UTF-8 input and exact output. */
import fs from "node:fs";
import { encodeText, decodeText } from "../engine/encoding.mjs";
import { encodingAddress } from "../engine/encoding-notes.mjs";
import { readStdin } from "../engine/read-stdin.mjs";

/** Apply one of the bare commands; all conversion is shared with the build. */
async function execute(direction, argv) {
    const strings = argv.text ?? [];
    if (
        !argv.enc ||
        (argv.in !== undefined && strings.length) ||
        (argv.in === undefined && strings.length !== 1)
    ) {
        console.error(
            `package-build ${direction}: --enc is required; give one string or --in <file|->`,
        );
        process.exitCode = 2;
        return;
    }
    let source = "<text>";
    try {
        let encoding;
        if (argv.enc !== "default") {
            const [{ loadPackConfig }, { indexRecordsFor }, { runContext }] = await Promise.all([
                import("../engine/pack-config.mjs"),
                import("../engine/content-index.mjs"),
                import("../engine/content-scripts.mjs"),
            ]);
            const config = loadPackConfig(),
                problems = [];
            const records = indexRecordsFor({ config, problems });
            if (problems.length) throw new Error(problems.map((one) => one.message).join("\n"));
            const context = runContext(config, records);
            if (context.encodingFindings?.length)
                throw Object.assign(
                    new Error(context.encodingFindings[0].message),
                    context.encodingFindings[0],
                );
            encoding =
                context.encodings.get(String(argv.enc)) ??
                context.encodings.get(encodingAddress(String(argv.enc), config.contentPackage));
            if (!encoding) throw new Error(`Encoding document \`${argv.enc}\` does not resolve`);
        }
        source =
            argv.in === "-" ? "<stdin>"
            : argv.in === undefined ? "<text>"
            : String(argv.in);
        const input =
            argv.in === undefined ? String(strings[0])
            : argv.in === "-" ? await readStdin()
            : fs.readFileSync(String(argv.in), "utf8");
        let output;
        try {
            output =
                !encoding ? input
                : direction === "encode" ? encodeText(encoding, input)
                : decodeText(encoding, input);
        } catch (error) {
            error.file = source;
            throw error;
        }
        if (argv.out !== undefined) fs.writeFileSync(String(argv.out), output, "utf8");
        else process.stdout.write(output + (argv.in === undefined ? "\n" : ""));
    } catch (error) {
        const file = error.file ?? source;
        const position = error.line !== undefined ? `:${error.line}:${error.column ?? 1}` : "";
        console.error(`${file}${position}: error: ${error.message}`);
        process.exitCode = 1;
    }
}

/** Encode roman text through one explicitly selected encoding. */
function encodeCommand() {
    return {
        command: "encode [text..]",
        describe: "Encode roman text using an encoding document",
        builder: (yargs) =>
            yargs
                .positional("text", { type: "string", array: true, describe: "One input string" })
                .option("enc", {
                    type: "string",
                    requiresArg: true,
                    describe: "Required encoding document Address, or default",
                })
                .option("in", {
                    alias: "i",
                    type: "string",
                    requiresArg: true,
                    describe: "Read UTF-8 input from a file or - for stdin",
                })
                .option("out", {
                    alias: "o",
                    type: "string",
                    requiresArg: true,
                    describe: "Write the exact result to a file",
                }),
        handler: (argv) => execute("encode", argv),
    };
}

/** Decode code points through one explicitly selected encoding. */
function decodeCommand() {
    return {
        command: "decode [text..]",
        describe: "Decode code points using an encoding document",
        builder: (yargs) =>
            yargs
                .positional("text", { type: "string", array: true, describe: "One input string" })
                .option("enc", {
                    type: "string",
                    requiresArg: true,
                    describe: "Required encoding document Address, or default",
                })
                .option("in", {
                    alias: "i",
                    type: "string",
                    requiresArg: true,
                    describe: "Read UTF-8 input from a file or - for stdin",
                })
                .option("out", {
                    alias: "o",
                    type: "string",
                    requiresArg: true,
                    describe: "Write the exact result to a file",
                }),
        handler: (argv) => execute("decode", argv),
    };
}

/** Register the two bare conversion commands on the shared CLI. */
export function registerEncodingCommands(yargs) {
    return yargs.command(encodeCommand()).command(decodeCommand());
}
