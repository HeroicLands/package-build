/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The timeout for a test whose body spawns this package's CLI, or any other
 * Node process, as a subprocess.
 *
 * Vitest's default per-test timeout is sized for in-process work. A spawned
 * Node process pays its own startup and this package's import graph on top of
 * whatever the CLI itself does, and that startup cost is CPU-bound: it grows
 * with however many other files the suite is running at the same moment,
 * which is a figure no single test can know in advance. Sizing the timeout
 * from an unloaded run therefore answers the wrong question — the number
 * needed is not "how long does this take" but "how much contention must a
 * passing run tolerate," and that is a property of the machine running the
 * suite, not of the test. `SUBPROCESS_TEST_TIMEOUT` is wide enough to absorb
 * that contention while still catching a genuine hang.
 */
export const SUBPROCESS_TEST_TIMEOUT = 20000;

/**
 * The timeout for a test whose body spawns `spawns` subprocesses.
 *
 * `SUBPROCESS_TEST_TIMEOUT` budgets one spawn under contention, so a test
 * that spawns several needs that budget once per spawn. A spawn inside a loop
 * counts once per iteration.
 *
 * @param spawns - The number of subprocesses the test spawns.
 * @returns The per-test timeout in milliseconds.
 */
export function subprocessTimeout(spawns: number): number {
    return spawns * SUBPROCESS_TEST_TIMEOUT;
}
