/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { inspectPublicDerivative } from "../engine/art-public-derivative.mjs";
import { writeDerivativeProvenance } from "../engine/art-provenance.mjs";

const address = "sample-none-image-example";
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
function derivative() {
    return writeDerivativeProvenance(
        svg,
        {
            address,
            creator: ["Artist"],
            rights: "Terms",
            derivedFrom: address,
        },
        { repeat: ["derivedFrom"] },
    ).bytes;
}
describe("public artwork boundary", () => {
    it("accepts the sanitized public identity and refuses a different owning package", () => {
        const bytes = derivative();
        expect(inspectPublicDerivative("example.svg", bytes, "sample").metadata.address).toBe(
            address,
        );
        expect(() => inspectPublicDerivative("example.svg", bytes, "other")).toThrow(/identity/);
    });
    it("rejects an extension mismatch and unsanitized script", () => {
        const bytes = derivative();
        expect(() => inspectPublicDerivative("example.webp", bytes, "sample")).toThrow();
        const unsafe = Buffer.from(
            bytes.toString().replace("</svg>", "<script>alert(1)</script></svg>"),
        );
        expect(() => inspectPublicDerivative("example.svg", unsafe, "sample")).toThrow();
    });
});
