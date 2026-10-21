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
 * Reads standard input to its end as UTF-8 text.
 *
 * The stream is read asynchronously, so a pipe whose writer is slower than the
 * reader, or a non-blocking descriptor, delivers the whole input instead of
 * failing with `EAGAIN`.
 *
 * @param {NodeJS.ReadableStream} [stream] The stream to drain; standard input by default.
 * @returns {Promise<string>} The complete input.
 */
export async function readStdin(stream = process.stdin) {
    stream.setEncoding("utf8");
    let text = "";
    for await (const chunk of stream) text += chunk;
    return text;
}
