/* SPDX-License-Identifier: GPL-3.0-or-later */
import { indexRecordsFor } from "./content-index.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { formatDiagnostic } from "./diagnostics.mjs";

/**
 * Derive an index with installed artwork resolved for this invocation.
 * @param {Parameters<typeof indexRecordsFor>[0]} options Index context.
 * @returns {Promise<object[]>} Validated content and asset records.
 */
export async function indexRecordsWithArtwork(options = {}) {
    const config = options.config ?? loadPackConfig();
    if (!config.art?.packages?.length) return indexRecordsFor({ ...options, config });
    const { createContentSession } = await import("./content-session.mjs");
    const session = await createContentSession({
        config,
        contentBase: options.contentBase,
        assetsBase: options.assetsBase,
        skipDirectories: options.skipDirectories,
    });
    try {
        options.problems?.push(...session.problems);
        if (!options.problems && session.problems.length)
            throw Object.assign(new Error(session.problems.map(formatDiagnostic).join("\n")), {
                located: true,
            });
        if (options.parsed)
            for (const [key, value] of session.parsed) options.parsed.set(key, value);
        return session.records;
    } finally {
        session.dispose();
    }
}
