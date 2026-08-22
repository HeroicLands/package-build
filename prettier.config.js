/** @type {import("prettier").Config} */
export default {
    // Matched to the Song of Heroic Lands repository this package was extracted
    // from, so a module moving between the two does not reformat.
    printWidth: 80,
    tabWidth: 4,
    useTabs: false,
    semi: true,
    singleQuote: false,
    quoteProps: "as-needed",
    trailingComma: "all",
    bracketSpacing: true,
    bracketSameLine: true,
    arrowParens: "always",
    endOfLine: "lf",
    experimentalTernaries: true,
    overrides: [
        {
            // Markdown indents at 2, not the global 4 — the same carve-out the
            // system repository makes, so notes and docs move between the two
            // repositories unchanged.
            files: "**/*.md",
            options: { tabWidth: 2 },
        },
    ],
};
