#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
printf 'Candidate commit: %s\n' "$CANDIDATE_SHA"
npm ci
mkdir -p "$RUNNER_TEMP/consumer-proof"
npm pack --pack-destination "$RUNNER_TEMP/consumer-proof"
mv "$RUNNER_TEMP"/consumer-proof/heroiclands-package-build-*.tgz "$RUNNER_TEMP/consumer-proof/candidate.tgz"
sha512sum "$RUNNER_TEMP/consumer-proof/candidate.tgz"
