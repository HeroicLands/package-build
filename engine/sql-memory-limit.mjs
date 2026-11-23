/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The SQL engine's memory budget: its default and the form `sql.memoryLimit`
 * takes.
 *
 * @module engine/sql-memory-limit
 */

/** The budget the SQL engine holds when `sql.memoryLimit` is unset. */
export const DEFAULT_SQL_MEMORY_LIMIT = "2 GB";

/** A decimal number and a DuckDB byte unit, such as `6 GB` or `512MiB`. */
const SIZE = /^(\d+(?:\.\d+)?)\s*([KMGT]i?B)$/i;

/** Bytes per unit: `KB` counts powers of 1000, `KiB` powers of 1024. */
const UNIT_BYTES = Object.freeze({
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
});

/** Below this DuckDB cannot open a database; it fails on the first query. */
const MINIMUM_BYTES = 1000 ** 2;

/** DuckDB's parser refuses a size of 2^64 bytes or more. */
const MAXIMUM_BYTES = 2 ** 64;

/**
 * What is wrong with a `sql.memoryLimit` value, or `null` when DuckDB accepts
 * it. `KB`, `MB`, `GB` and `TB` count powers of 1000; `KiB`, `MiB`, `GiB` and
 * `TiB` count powers of 1024. A size is at least 1 MB and below 2^64 bytes.
 *
 * @param {string} value - The trimmed value.
 * @returns {string|null} The problem, phrased to follow the key name.
 */
export function sqlMemoryLimitProblem(value) {
    const match = SIZE.exec(value);
    if (!match) {
        return (
            "must be a size such as `2 GB` or `512 MiB`: a number followed by " +
            "KB, MB, GB, TB, KiB, MiB, GiB or TiB"
        );
    }
    const bytes = Number(match[1]) * UNIT_BYTES[match[2].toLowerCase()];
    if (bytes < MINIMUM_BYTES) return "must be at least 1 MB";
    if (bytes >= MAXIMUM_BYTES) return "must be below 2^64 bytes";
    return null;
}
