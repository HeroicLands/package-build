/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Format generated text using the destination file's Prettier configuration.
 * @param {string} text
 * @param {string} filepath
 * @returns {Promise<string>}
 */
export async function formatGenerated(text, filepath) {
    const prettier = await import("prettier");
    const config = await prettier.resolveConfig(filepath);
    return prettier.format(text, { ...config, filepath });
}
