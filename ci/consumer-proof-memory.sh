#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

phase="${1:?Expected before or after}"
case "$phase" in before|after) ;; *) exit 1 ;; esac
evidence="$RUNNER_TEMP/consumer-proof-memory"
mkdir -p "$evidence"
slice=/system.slice/system-giteacontent.slice
service="$slice/gitea-runner-build.service"
current=$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup)
case "$current" in
    "$service"|"$service"/*) ;;
    *) printf 'Expected the build runner cgroup, found %s\n' "$current" >&2; exit 1 ;;
esac

# These service and slice counters include other admitted content jobs.
{
    printf 'Shared full compile profile; current cgroup: %s\n' "$current"
    for group in "$service" "$slice"; do
        printf 'cgroup: %s\n' "$group"
        for metric in memory.high memory.max memory.swap.max memory.current memory.peak memory.events; do
            printf '%s\n' "$metric"
            cat "/sys/fs/cgroup$group/$metric"
        done
        test "$(cat "/sys/fs/cgroup$group/memory.high")" = 12884901888
        test "$(cat "/sys/fs/cgroup$group/memory.max")" = 15032385536
        test "$(cat "/sys/fs/cgroup$group/memory.swap.max")" = max
    done
} | tee "$evidence/$phase.txt"
