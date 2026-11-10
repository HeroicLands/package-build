// SPDX-License-Identifier: GPL-3.0-or-later
/** Generic spelling-program conformance, independent of the shared sound contract. */
import { compileRows, EncodingError } from "../../engine/encoding.mjs";
import { templateProgram } from "../../engine/encoding-template.mjs";
export * from "../../engine/encoding.mjs";
export function compileEncoding(data: any, options: any = {}) {
    const program = templateProgram(data, options, (key, message) => {
        throw new EncodingError(message, { key });
    });
    try {
        return compileRows(program.definition, program.metadata);
    } catch (error) {
        const row = error instanceof EncodingError && error.key?.match(/^rows\.(\d+)(?:\.|$)/u);
        if (row) error.key = program.rowKeys[Number(row[1])];
        throw error;
    }
}
