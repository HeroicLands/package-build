/* SPDX-License-Identifier: GPL-3.0-or-later */

/** English cardinal words for finite whole numbers. */
const ONES = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];

function underThousand(value) {
    const parts = [];
    const hundreds = Math.floor(value / 100);
    if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
    const rest = value % 100;
    if (rest >= 20) {
        const ten = TENS[Math.floor(rest / 10)];
        parts.push(rest % 10 ? `${ten}-${ONES[rest % 10]}` : ten);
    } else if (rest) parts.push(ONES[rest]);
    return parts.join(" ");
}

/** Spell a SQL integer in running prose, using American cardinal style. */
export function numberWords(value) {
    if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isSafeInteger(value))) {
        throw new TypeError("words needs a whole number; use digits for decimals");
    }
    let remaining = BigInt(value);
    if (remaining === 0n) return "zero";
    const negative = remaining < 0n;
    if (negative) remaining = -remaining;
    const parts = [];
    let scale = 0;
    while (remaining > 0n) {
        if (scale >= SCALES.length) throw new RangeError("words cannot spell a number this large");
        const group = Number(remaining % 1000n);
        if (group)
            parts.unshift(`${underThousand(group)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
        remaining /= 1000n;
        scale++;
    }
    return `${negative ? "minus " : ""}${parts.join(" ")}`;
}

/** Render a SQL number with grouped thousands and its fractional part. */
export function numberDigits(value) {
    if (typeof value === "bigint") return value.toLocaleString("en-US");
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("digits needs a finite number");
    }
    if (/[eE]/.test(String(value))) {
        return new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 }).format(value);
    }
    const [whole, fraction] = String(value).split(".");
    const grouped = BigInt(whole).toLocaleString("en-US");
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
