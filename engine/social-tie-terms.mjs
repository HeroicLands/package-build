/* SPDX-License-Identifier: GPL-3.0-or-later */

/** Relationships a being states from its own point of view. */
export const SOCIAL_TIES = Object.freeze([
    { term: "patron", meaning: "Supports the subject from greater power, wealth, or status." },
    { term: "friend", meaning: "Supports the subject out of goodwill." },
    { term: "dependent", meaning: "Relies on the subject's support or protection." },
    { term: "acquaintance", meaning: "Knows the subject without a strong disposition." },
    { term: "rival", meaning: "Opposes the subject without implacable hostility." },
    { term: "nemesis", meaning: "Opposes the subject personally and implacably." },
]);
