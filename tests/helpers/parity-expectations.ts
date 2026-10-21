/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * What a reader must see, for every construct in the parity corpus, on every
 * target.
 *
 * Each construct names the text of the corpus that exercises it (`probe`) and,
 * for each target, patterns the target's rendering must match (`sees`) and
 * patterns it must not (`absent`). The patterns state what a reader meets, in
 * the target's own medium: HTML for Foundry, the web and the preview, Typst
 * source for the book.
 *
 * **A disagreement is recorded, not hidden.** Where a target shows a reader
 * something other than the others do, the expectation states what it shows
 * today and `differs` says how it departs. A construct whose targets agree
 * carries no `differs`.
 *
 * **The preview has two views.** Rendered with no content index it shows the
 * buffer's source: a link, a span, an expression and a query read as
 * highlighted authored text, since a buffer cannot resolve them. Rendered with
 * the package's content index, it resolves them as the website does. The
 * `preview` expectation states the buffer-only view; a construct that view
 * cannot resolve is marked `bufferOnly` and states the indexed view as
 * `indexed`. Every other construct reads the same in both views, and its
 * `preview` expectation holds for both.
 */

export type Target = "foundry" | "preview" | "web" | "book";

/** Every target, in the order a report lists them. */
export const TARGETS: readonly Target[] = ["foundry", "preview", "web", "book"];

/** The renderings the corpus is checked against: each target, and the preview with an index. */
export type Rendering = Target | "indexed";

/** Every rendering, in the order a report lists them. */
export const RENDERINGS: readonly Rendering[] = [...TARGETS, "indexed"];

/** Which rendering of the corpus an expectation reads. */
export type Subject = "corpus" | "lost" | "worded" | "fenced";

/** What one target must show for one construct. */
export interface Expectation {
    /** Patterns the rendering must match. */
    sees: RegExp[];
    /** Patterns the rendering must not match. */
    absent?: RegExp[];
    /** How this target departs from what the others show, when it does. */
    differs?: string;
    /** The rendering the patterns read; the corpus note unless stated. */
    of?: Subject;
    /**
     * The buffer-only preview shows what it cannot resolve as source, and the
     * construct states how the preview reads with an index as `indexed`.
     */
    bufferOnly?: true;
}

/** One construct and what each target shows for it. */
export interface Construct {
    /** What the construct is, in a reader's words. */
    summary: string;
    /** Text of the note that exercises the construct. */
    probe: string;
    /** The note the probe is in; the corpus note unless stated. */
    probeIn?: Subject;
    foundry: Expectation;
    preview: Expectation;
    web: Expectation;
    book: Expectation;
    /** The preview rendered with a content index, where it differs from `preview`. */
    indexed?: Expectation;
}

const UUID = String.raw`@UUID\[Compendium\.parity\.journals\.JournalEntry\.[0-9a-f]+(?:\.JournalEntryPage\.\w+)?\]`;

/** The buffer-only preview shows the authored source of a construct it cannot resolve. */
const SOURCE_ONLY =
    "The buffer-only preview shows the authored source, highlighted, where the other targets show the resolved result.";

/** An alert of one type, as the targets draw it. */
function alert(type: string, title: string, body: string, probe: string): Construct {
    const attrs = type === "warning" ? String.raw` seasonal" id="flood-warning` : "";
    const html = new RegExp(
        String.raw`<aside class="alert alert-${type}${attrs}">[\s\S]*?alert-title[^>]*>[\s\S]*?${title}</header>\s*<p>${body}</p>`,
    );
    return {
        summary: `A ${type} alert is a labelled, coloured callout.`,
        probe,
        foundry: { sees: [html] },
        web: { sees: [html] },
        preview: { sees: [html] },
        book: {
            sees: [
                new RegExp(
                    String.raw`#block\(width: 100%, stroke: \(left: 2pt \+ rgb\("#[0-9a-f]{6}"\)\)[\s\S]*?\) ${title}\]\s+${body}\]`,
                ),
            ],
        },
    };
}

/** An invented-language-free generic family run. */
function generic(family: string, text: string, probe: string): Construct {
    const literal = text.replace(/[()]/g, "\\$&");
    return {
        summary: `Text marked font=${family} is set in the ${family} family.`,
        probe,
        foundry: { sees: [new RegExp(String.raw`<span class="font-${family}">${literal}</span>`)] },
        web: { sees: [new RegExp(String.raw`<span class="font-${family}">${literal}</span>`)] },
        preview: {
            sees: [
                new RegExp(
                    String.raw`hl-preview-label">${literal}</span>[\s\S]*?\{font=${family}\}`,
                ),
            ],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: {
            sees: [new RegExp(String.raw`<span class="font-${family}">${literal}</span>`)],
        },
        book: {
            sees: [
                new RegExp(String.raw`#book-span\(classes: \("font-${family}",\)\)\[${literal}\]`),
            ],
        },
    };
}

/** An expression helper that prints a boolean. */
function boolean(name: string): Construct {
    const line = new RegExp(`${name} reads true`);
    return {
        summary: `{{${name} …}} reads true.`,
        probe: `- ${name} reads {{`,
        foundry: { sees: [line] },
        web: { sees: [line] },
        preview: { sees: [line] },
        book: { sees: [line] },
    };
}

/** Every construct the corpus exercises, by id. */
export const CONSTRUCTS: Record<string, Construct> = {
    "plain-markup": {
        summary:
            "Emphasis, strong text, strikethrough, code, links, breaks, quotes, lists and rules.",
        probe: "~~struck text~~",
        foundry: {
            sees: [
                /<em>emphasis<\/em>/,
                /<strong>strong text<\/strong>/,
                /<s>struck text<\/s>/,
                /<code>code span<\/code>/,
                /<a href="https:\/\/example\.org\/plain">plain link<\/a>/,
                /hard break<br>\s*and a soft break/,
                /<blockquote>\s*<p>A plain quotation stands apart\.<\/p>/,
                /<ul>\s*<li>A bullet item<\/li>/,
                /<ol>\s*<li>A numbered item<\/li>/,
                /<hr>/,
            ],
        },
        web: {
            sees: [
                /<em>emphasis<\/em>/,
                /<strong>strong text<\/strong>/,
                /<s>struck text<\/s>/,
                /<code>code span<\/code>/,
                /<a href="https:\/\/example\.org\/plain">plain link<\/a>/,
                /hard break<br>\s*and a soft break/,
                /<blockquote>\s*<p>A plain quotation stands apart\.<\/p>/,
                /<ul>\s*<li>A bullet item<\/li>/,
                /<ol>\s*<li>A numbered item<\/li>/,
                /<hr>/,
            ],
        },
        preview: {
            sees: [
                /<em>emphasis<\/em>/,
                /<strong>strong text<\/strong>/,
                /<s>struck text<\/s>/,
                /<code>code span<\/code>/,
                /<a href="https:\/\/example\.org\/plain">plain link<\/a>/,
                /hard break<br>\s*and a soft break/,
                /<blockquote>\s*<p>A plain quotation stands apart\.<\/p>/,
                /<ul>\s*<li>A bullet item<\/li>/,
                /<ol>\s*<li>A numbered item<\/li>/,
                /<hr>/,
            ],
        },
        book: {
            sees: [
                /#emph\[emphasis\]/,
                /#strong\[strong text\]/,
                /#strike\[struck text\]/,
                /#raw\("code span", block: false\)/,
                /#link\("https:\/\/example\.org\/plain"\)\[plain link\]/,
                /hard break \\\nand a soft break/,
                /#quote\(block: true\)\[A plain quotation stands apart\.\]/,
                /#list\(\[A bullet item\], \[A second bullet item\]\)/,
                /#enum\(\[A numbered item\], \[A second numbered item\]\)/,
                /#line\(length: 100%/,
            ],
        },
    },

    "commonmark-basics": {
        summary:
            "A setext heading, an indented code block, a reference link, an autolink, an entity and an escape.",
        probe: "A Setext Heading\n----------------",
        foundry: {
            sees: [
                /<h2>A Setext Heading<\/h2>/,
                /<pre><code>indented code line/,
                /<a href="https:\/\/example\.org\/reference">link<\/a>/,
                /<a href="https:\/\/example\.org\/auto">https:\/\/example\.org\/auto<\/a>/,
                /an entity &amp; and an escape \*star\*/,
            ],
            differs:
                "A setext heading stays inside the page it follows; only an ATX H1 or an anchored heading starts a journal page.",
        },
        web: {
            sees: [
                /<h2 id="a-setext-heading">A Setext Heading<\/h2>/,
                /<pre[^>]*><code>indented code line/,
                /<a href="https:\/\/example\.org\/reference">link<\/a>/,
                /<a href="https:\/\/example\.org\/auto">https:\/\/example\.org\/auto<\/a>/,
                /an entity &amp; and an escape \*star\*/,
            ],
        },
        preview: {
            sees: [
                /<h2>A Setext Heading<\/h2>/,
                /<pre><code>indented code line/,
                /<a href="https:\/\/example\.org\/reference">link<\/a>/,
                /<a href="https:\/\/example\.org\/auto">https:\/\/example\.org\/auto<\/a>/,
                /an entity &amp; and an escape \*star\*/,
            ],
        },
        book: {
            sees: [
                /#heading\(level: 3, outlined: false, bookmarked: false\)\[A Setext Heading\]/,
                /```\nindented code line\n```/,
                /#link\("https:\/\/example\.org\/reference"\)\[link\]/,
                /#link\("https:\/\/example\.org\/auto"\)\[https:\/\/example\.org\/auto\]/,
                /an entity & and an escape \\\*star\\\*/,
            ],
        },
    },

    "typographic-punctuation": {
        summary: "Straight quotes, a double hyphen and three full stops in prose.",
        probe: 'The keeper said "not yet" -- it\'s late... and dark.',
        foundry: { sees: [/The keeper said &quot;not yet&quot; -- it's late\.\.\. and dark\./] },
        web: {
            sees: [/The keeper said \u201cnot yet\u201d \u2013 it\u2019s late\u2026 and dark\./],
            differs:
                "The site sets straight quotes as curly ones, a double hyphen as an en dash and three full stops as an ellipsis, as a printed page does.",
        },
        preview: { sees: [/The keeper said &quot;not yet&quot; -- it's late\.\.\. and dark\./] },
        book: {
            sees: [/The keeper said \\"not yet\\" -- it\\'s late\.\.\. and dark\./],
            differs:
                "The book escapes the quotes, which Typst then prints straight, and leaves the hyphens and full stops for Typst to set as its dash and ellipsis.",
        },
    },

    "heading-attributes": {
        summary: "A heading's {#id} attribute block addresses the heading and is not typeset.",
        probe: "# Names and secrets {#names}",
        foundry: {
            sees: [/<!-- page "Names and secrets" type=text/],
            absent: [/\{#names\}/],
        },
        web: { sees: [/<h1 id="names">Names and secrets<\/h1>/], absent: [/\{#names\}/] },
        preview: { sees: [/<h1 id="names">Names and secrets<\/h1>/], absent: [/\{#names\}/] },
        book: {
            sees: [/\[Names and secrets\] <lore-corpus--names>/],
            absent: [/\{#names\}/],
        },
    },

    "name-marked": {
        summary: "A marked name stands out as a name.",
        probe: '[Hidden Hand]{.name data-type="being/npc"}',
        foundry: {
            sees: [/<span class="name" data-type="being\/npc">Hidden Hand<\/span>/],
        },
        web: { sees: [/<span class="name" data-type="being\/npc">Hidden Hand<\/span>/] },
        preview: {
            sees: [/hl-preview-label">Hidden Hand<\/span>[\s\S]*?\{\.name data-type=/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: {
            sees: [/<span class="name" data-type="being\/npc">Hidden Hand<\/span>/],
        },
        book: { sees: [/#book-span\(classes: \("name",\)\)\[Hidden Hand\]/] },
    },

    "name-in-emphasis": {
        summary: "A marked name inside strong text keeps both.",
        probe: "**a phrase with [Joe Blow]{.name} in it**",
        foundry: {
            sees: [/<strong>a phrase with <span class="name">Joe Blow<\/span> in it<\/strong>/],
        },
        web: {
            sees: [/<strong>a phrase with <span class="name">Joe Blow<\/span> in it<\/strong>/],
        },
        preview: {
            sees: [/<strong>a phrase with [\s\S]*?hl-preview-label">Joe Blow<\/span>/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: {
            sees: [/<strong>a phrase with <span class="name">Joe Blow<\/span> in it<\/strong>/],
        },
        book: {
            sees: [/#strong\[a phrase with #book-span\(classes: \("name",\)\)\[Joe Blow\] in it\]/],
        },
    },

    "secret-inline": {
        summary: "Inline secret text is concealed until the reader reveals it.",
        probe: "[under the **third** stair]{.secret}",
        foundry: {
            sees: [
                /<span class="secret" data-inline-spoiler="" tabindex="0"[^>]*>under the <strong>third<\/strong> stair<\/span>/,
            ],
        },
        web: {
            sees: [
                /data-inline-secret data-pagefind-ignore><button[^>]*>Show spoiler<\/button><span class="inline-secret-content" hidden>under the <strong>third<\/strong> stair<\/span>/,
            ],
        },
        preview: {
            sees: [
                /hl-preview-secret-content"><span class="hl-preview-label">under the <strong>third<\/strong> stair/,
            ],
            absent: [/\*\*third\*\*/],
        },
        indexed: {
            sees: [
                /<span class="secret" data-inline-spoiler="" tabindex="0"[^>]*>under the <strong>third<\/strong> stair<\/span>/,
            ],
        },
        book: {
            sees: [/The key is #box\[under the #strong\[third\] stair\]/],
            differs:
                "The book prints inline secret text plainly; a printed page has no reveal control.",
        },
    },

    "secret-block": {
        summary: "A secret block is a titled, concealed passage for the GM.",
        probe: ':::secret {title="For the GM"}',
        foundry: {
            sees: [
                /<section class="secret" id="secret-[0-9a-f]+">\s*<strong>For the GM<\/strong>:<br\/>\s*<p>The harbor master works for the smugglers\.<\/p>/,
            ],
        },
        web: {
            sees: [
                /<details class="secret" data-pagefind-ignore>\s*<summary class="secret">For the GM<\/summary>\s*<p>The harbor master works for the smugglers\.<\/p>/,
            ],
        },
        preview: {
            sees: [
                /<details class="secret"><summary>For the GM<\/summary>\s*<p>The harbor master works for the smugglers\.<\/p>/,
            ],
        },
        book: {
            sees: [/\[! For the GM\][\s\S]*?The harbor master works for the smugglers\.\]/],
            differs:
                "The book prints a secret block as a labelled box, open, since a printed page honours no reader permission.",
        },
    },

    "secret-heading": {
        summary: "A heading marked .secret withholds its whole section.",
        probe: "## The Cellar {#cellar .secret}",
        foundry: {
            sees: [
                /<!-- page "The Cellar" type=text ownership=0 -->\s*<p>The cellar door opens onto a cistern\.<\/p>/,
            ],
            differs:
                "Foundry withholds the section as a page whose default ownership is none; the others wrap it in a disclosure.",
        },
        web: {
            sees: [
                /<details class="secret" data-pagefind-ignore>\s*<summary class="secret">Secret<\/summary>\s*<h2 id="cellar" class="secret">The Cellar<\/h2>\s*<p>The cellar door opens onto a cistern\.<\/p>/,
            ],
            absent: [
                /<summary class="secret">Secret<\/summary>\s*<details/,
                /Secret<\/summary>[^]*Secret<\/summary>/,
            ],
        },
        preview: {
            sees: [
                /<details class="secret"><summary>Secret<\/summary><h2 id="cellar">The Cellar<\/h2>\s*<p>The cellar door opens onto a cistern\.<\/p>/,
            ],
        },
        book: {
            sees: [
                /\[! Secret\][\s\S]*?\[The Cellar\] <lore-corpus--cellar>[\s\S]*?The cellar door opens onto a cistern\.\]/,
            ],
        },
    },

    "alert-note": alert("note", "Note", "Note alert body\\.", "> [!NOTE]"),
    "alert-tip": alert("tip", "Tip", "Tip alert body\\.", "> [!TIP]"),
    "alert-important": alert("important", "Important", "Important alert body\\.", "> [!IMPORTANT]"),
    "alert-warning": alert(
        "warning",
        "Seasonal closure",
        "Warning alert body\\.",
        '> [!WARNING] {#flood-warning .seasonal title="Seasonal closure"}',
    ),

    "div-block": {
        summary: "A fenced div carries its id, classes and language to its content.",
        probe: "::: {#harbor-note .border lang=en}",
        foundry: {
            sees: [
                /<div class="border" id="harbor-note" lang="en">\s*<p>The harbor remains open through winter\.<\/p>/,
            ],
        },
        web: {
            sees: [
                /<div class="border" id="harbor-note" lang="en">\s*<p>The harbor remains open through winter\.<\/p>/,
            ],
        },
        preview: {
            sees: [
                /<div class="border" id="harbor-note" lang="en">\s*<p>The harbor remains open through winter\.<\/p>/,
            ],
        },
        book: {
            sees: [
                /#block\(width: 100%\)\[#book-script-text\(classes: \("border",\), lang: "en"\)\[The harbor remains open through winter\.\]\] <lore-corpus--harbor-note>/,
            ],
        },
    },

    "definition-list": {
        summary: "A term with several definitions sets as a dictionary row.",
        probe: "Janapada\n: A territorial community",
        foundry: {
            sees: [
                /<dl class="dictionary">\s*<div>\s*<dt>Janapada<\/dt><dd>A territorial community with its own institutions\.<\/dd>\s*<dd>Also the land associated with that community\.<\/dd>/,
            ],
        },
        web: {
            sees: [
                /<dl class="dictionary">\s*<div>\s*<dt>Janapada<\/dt><dd>A territorial community with its own institutions\.<\/dd>\s*<dd>Also the land associated with that community\.<\/dd>/,
            ],
        },
        preview: {
            sees: [
                /<dl class="dictionary">\s*<div>\s*<dt>Janapada<\/dt><dd>A territorial community with its own institutions\.<\/dd>\s*<dd>Also the land associated with that community\.<\/dd>/,
            ],
        },
        book: {
            sees: [
                /book-definition\(\[Janapada\],\[A territorial community with its own institutions\.\n\nAlso the land associated with that community\.\]\)/,
            ],
        },
    },

    "dictionary-entry": {
        summary: "A dictionary headword is marked as an entry and addressable.",
        probe: "[harbour]{#harbour .dictionary-entry}",
        foundry: {
            sees: [/<h6 id="harbour" class="dictionary-entry"[^>]*>harbour<\/h6> <em>n\.<\/em>/],
            differs:
                "Foundry sets the headword as an inline heading so it appears in the journal's contents.",
        },
        web: {
            sees: [/<span id="harbour" class="dictionary-entry">harbour<\/span> <em>n\.<\/em>/],
        },
        preview: {
            sees: [/hl-preview-label">harbour<\/span>[\s\S]*?\{#harbour \.dictionary-entry\}/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: {
            sees: [/<h6 id="harbour" class="dictionary-entry"[^>]*>harbour<\/h6> <em>n\.<\/em>/],
        },
        book: {
            sees: [
                /#book-span\(classes: \("dictionary-entry",\)\)\[harbour\] <lore-corpus--harbour> #emph\[n\.\]/,
            ],
        },
    },

    "verse-plain": {
        summary:
            "Verse keeps its lines and stanzas and indents a line by two spaces per level; its form is recorded.",
        probe: "```verse {form=ballad lang=en}",
        foundry: {
            sees: [
                /<div class="verse" lang="en" data-form="ballad">/,
                /<span class="verse-line">The lantern burns beside the gate,<\/span><br>\s*<span class="verse-line i1">The harbor sleeps below\.<\/span>/,
            ],
        },
        web: {
            sees: [
                /<div class="verse" lang="en" data-form="ballad">/,
                /<span class="verse-line">The lantern burns beside the gate,<\/span><br>\s*<span class="verse-line i1">The harbor sleeps below\.<\/span>/,
            ],
        },
        preview: {
            sees: [
                /<div class="verse" data-form="ballad" lang="en">/,
                /<span class="verse-line">The lantern burns beside the gate,<\/span><br>\s*<span class="verse-line i1">The harbor sleeps below\.<\/span>/,
            ],
            absent: [/verse-line i0/],
        },
        indexed: {
            sees: [
                /<div class="verse" lang="en" data-form="ballad">/,
                /<span class="verse-line">The lantern burns beside the gate,<\/span><br>\s*<span class="verse-line i1">The harbor sleeps below\.<\/span>/,
            ],
        },
        book: {
            sees: [
                /The lantern burns beside the gate, \\\n#h\(1\.25em\)The harbor sleeps below\./,
                /The keeper guards the road till dawn, \\\n#h\(1\.25em\)And keeps a light aglow\./,
            ],
        },
    },

    "verse-scanned": {
        summary: "A verse that names its metre carries it, and readers see only the verse.",
        probe: "```verse {scan=trimeter lang=tar}",
        foundry: {
            sees: [
                /<div class="verse" lang="art-x-tar" data-scan="trimeter">\s*<p><span class="verse-line">Taruna velomi sarandi<\/span><\/p>/,
            ],
        },
        web: {
            sees: [
                /<div class="verse" lang="art-x-tar" data-scan="trimeter">\s*<p><span class="verse-line">Taruna velomi sarandi<\/span><\/p>/,
            ],
        },
        preview: {
            sees: [
                /<div class="verse" data-scan="trimeter" lang="tar">\s*<p><span class="verse-line">Taruna velomi sarandi<\/span><\/p>/,
            ],
        },
        indexed: {
            sees: [
                /<div class="verse" lang="art-x-tar" data-scan="trimeter">\s*<p><span class="verse-line">Taruna velomi sarandi<\/span><\/p>/,
            ],
        },
        book: {
            sees: [/#block\(width: 100%\)\[Taruna velomi sarandi\]/],
            differs: "The book sets the verse's line and records nothing of its metre.",
        },
    },

    "verse-columns": {
        summary:
            "A verse in columns sets each line beside its translation, numbered every numstep lines.",
        probe: "numstep=2 lang=vyl col1=",
        foundry: {
            sees: [
                /<div class="verse verse-columns verse-numbered" lang="art-x-vyl" data-numstep="2"/,
                /<span class="verse-number">2<\/span>/,
                /<span class="verse-part"><span lang="en">the hallowed boundary I sing<\/span><\/span><span class="verse-part verse-secondary"><span lang="art-x-vyl">thirun sorima<\/span>/,
            ],
        },
        web: {
            sees: [
                /<div class="verse verse-columns verse-numbered" lang="art-x-vyl" data-numstep="2"/,
                /<span class="verse-number">2<\/span>/,
                /<span class="verse-part"><span lang="en">the hallowed boundary I sing<\/span><\/span><span class="verse-part verse-secondary"><span lang="art-x-vyl">thirun sorima<\/span>/,
            ],
        },
        preview: {
            sees: [
                /<div class="verse verse-columns verse-numbered" data-numstep="2" lang="vyl"/,
                /<span class="verse-number">2<\/span>/,
                /<span class="verse-part"><span class="hl-preview-span">[\s\S]*?the hallowed boundary I sing[\s\S]*?\{lang=en\}/,
            ],
            differs:
                "The buffer-only preview sets the columns in their grid with their numbers, but shows each entry's span as source: it has no script notes to map the code points from.",
            bufferOnly: true,
        },
        indexed: {
            sees: [
                /<div class="verse verse-columns verse-numbered" lang="art-x-vyl" data-numstep="2"/,
                /<span class="verse-number">2<\/span>/,
                /<span class="verse-part"><span lang="en">the hallowed boundary I sing<\/span><\/span><span class="verse-part verse-secondary"><span lang="art-x-vyl">thirun sorima<\/span>/,
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} \u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/span>/u,
            ],
        },
        book: {
            sees: [
                /#grid\(columns: \(2\.5em, 1fr, 1fr\)/,
                /#text\(fill: luma\(45%\)\)\[2\]/,
                /\[#book-span\(classes: \(\), lang: "en"\)\[the hallowed boundary I sing\]\], \[#text\(fill: luma\(45%\)\)\[#box\[thirun sorima\]\]\]/,
            ],
        },
    },

    "figure-code": figure(
        "code",
        ":@ A listing of the code. {#fig-code}",
        "Code 1: A listing of the code.",
    ),
    "figure-example": figure(
        "example",
        ":@ A worked example. {#fig-example type=example}",
        "Example 1: A worked example.",
    ),
    "figure-table": figure(
        "table",
        ":@ Regional trade routes {#trade .border}",
        "Table 1: Regional trade routes",
    ),
    "figure-figure": {
        summary: "A captioned picture is a numbered figure.",
        probe: ":@ The harbor pennant. {#fig-pennant}",
        foundry: {
            sees: [
                /<!-- page "Figure 1" type=image ownership=inherit src=modules\/parity\/images\/pennant\.png caption="The harbor pennant\." -->/,
            ],
            differs:
                "Foundry gives a captioned picture a journal page of its own, titled with its number.",
        },
        web: {
            sees: [
                /<div id="fig-pennant" class="content-figure content-figure-figure">\s*<figure class="note-image">\s*<img src="https:\/\/cdn\.example\.org\/parity\/images\/pennant\.png" alt="A small pennant"[^>]*>\s*<\/figure>\s*<p class="content-figure-label">Figure 1: The harbor pennant\.<\/p>/,
            ],
        },
        preview: {
            sees: [
                /<div id="fig-pennant" class="content-figure content-figure-figure">\s*<figure class="note-image">\s*<img src="images\/pennant\.png" alt="A small pennant">\s*<\/figure>\s*<p class="content-figure-label">Figure 1: The harbor pennant\.<\/p>\s*<\/div>/,
            ],
        },
        indexed: {
            sees: [
                /<div id="fig-pennant" class="content-figure content-figure-figure">\s*<figure class="note-image">\s*<img src="https:\/\/cdn\.example\.org\/parity\/images\/pennant\.png" alt="A small pennant"[^>]*>\s*<\/figure>\s*<p class="content-figure-label">Figure 1: The harbor pennant\.<\/p>\s*<\/div>/,
            ],
        },
        book: {
            sees: [
                /#book-image\("parity-parity\/assets\/images\/pennant\.png", requested: auto, caption: \[Figure 1: The harbor pennant\.\]\) <lore-corpus--fig-pennant>/,
            ],
        },
    },
    "figure-map": {
        summary: "A captioned picture whose asset is a map is a numbered map.",
        probe: ":@ The coast. {#fig-coast}",
        foundry: {
            sees: [
                /<!-- page "Map 1" type=image ownership=inherit src=modules\/parity\/images\/coast\.png caption="The coast\." -->/,
            ],
        },
        web: {
            sees: [
                /<div id="fig-coast" class="content-figure content-figure-map">\s*<figure class="note-image note-image-role-map">[\s\S]*?<p class="content-figure-label">Map 1: The coast\.<\/p>/,
            ],
        },
        preview: {
            sees: [
                /<div id="fig-coast" class="content-figure content-figure-figure">[\s\S]*?image-coast[\s\S]*?<p class="content-figure-label">Figure 2: The coast\.<\/p>\s*<\/div>/,
            ],
            differs:
                "The buffer-only preview has no asset index, so it cannot tell that the picture is a map: the item is a numbered Figure, and the embed shows as source rather than as the picture.",
            bufferOnly: true,
        },
        indexed: {
            sees: [
                /<div id="fig-coast" class="content-figure content-figure-map">\s*<figure class="note-image note-image-role-map">\s*<img src="https:\/\/cdn\.example\.org\/parity\/images\/coast\.png" alt="The coast"[^>]*>\s*<\/figure>\s*<p class="content-figure-label">Map 1: The coast\.<\/p>\s*<\/div>/,
            ],
        },
        book: {
            sees: [
                /#book-image\("parity-parity\/assets\/images\/maps\/coast\.png", requested: [^,]+, caption: \[Map 1: The coast\.\]\) <lore-corpus--fig-coast>/,
            ],
        },
    },
    "figure-poem": figure(
        "poem",
        ":@ A song sung by the harbor watch. {#fig-song}",
        "Poem 1: A song sung by the harbor watch.",
    ),
    "figure-prose": figure(
        "prose",
        ":@ A caption on a quoted passage. {#fig-prose type=prose}",
        "Prose 1: A caption on a quoted passage.",
    ),

    "table-aligned": {
        summary: "A table's column alignment is honoured.",
        probe: "| :---- | :--: | ---: |",
        foundry: {
            sees: [
                /<th style="text-align:left">Route<\/th>\s*<th style="text-align:center">Days<\/th>\s*<th style="text-align:right">Toll<\/th>/,
                /<td style="text-align:right">30<\/td>/,
            ],
        },
        web: {
            sees: [
                /<th style="text-align:left">Route<\/th>\s*<th style="text-align:center">Days<\/th>\s*<th style="text-align:right">Toll<\/th>/,
                /<td style="text-align:right">30<\/td>/,
            ],
        },
        preview: {
            sees: [
                /<th class="hl-preview-align-left">Route<\/th>\s*<th class="hl-preview-align-center">Days<\/th>\s*<th class="hl-preview-align-right">Toll<\/th>/,
                /<td class="hl-preview-align-right">30<\/td>/,
            ],
        },
        book: {
            sees: [
                /align: \(left, center, right\),\s*table\.header\(\[Route\], \[Days\], \[Toll\]\),\s*\[North\], \[4\], \[12\],\s*\[South\], \[9\], \[30\]/,
            ],
        },
    },

    footnote: {
        summary:
            "A footnote reference is numbered and its definition, with every paragraph, is kept.",
        probe: "[^toll]: The toll is collected",
        foundry: {
            sees: [
                /The road is passable in summer\.<sup class="footnote-ref"><a href="#fn-\w+-1" id="fnref-\w+-1">\[1\]<\/a><\/sup>/,
                /<section class="footnotes"><h2>Footnotes<\/h2>/,
                /Spring flooding closes it for several weeks\./,
                /<p>A second paragraph belongs to the same footnote\./,
            ],
        },
        web: {
            sees: [
                /The road is passable in summer\.<sup class="footnote-ref"><a href="#fn1" id="fnref1">\[1\]<\/a><\/sup>/,
                /<section class="footnotes"><h2>Footnotes<\/h2>/,
                /Spring flooding closes it for several weeks\./,
                /<p>A second paragraph belongs to the same footnote\./,
            ],
        },
        preview: {
            sees: [
                /The road is passable in summer\.<sup class="footnote-ref"><a href="#fn1" id="fnref1">\[1\]<\/a><\/sup>/,
                /<section class="footnotes"><h2>Footnotes<\/h2>/,
                /Spring flooding closes it for several weeks\./,
                /<p>A second paragraph belongs to the same footnote\./,
            ],
        },
        book: {
            sees: [
                /The road is passable in summer\.#footnote\[Spring flooding closes it for several weeks\.\]/,
                /#footnote\[The toll is collected at the eastern gate\.\n\nA second paragraph belongs to the same footnote\.\]/,
            ],
            differs: "The book sets a footnote at the foot of the page that holds its reference.",
        },
    },

    "footnote-inline": {
        summary: "A footnote written in the sentence is numbered and listed like any other.",
        probe: "^[The inline note is written in the sentence.]",
        foundry: {
            sees: [
                /A ford crosses upstream\.<sup class="footnote-ref"><a href="#fn-\w+-3" id="fnref-\w+-3">\[3\]<\/a><\/sup>/,
                /<p>The inline note is written in the sentence\./,
            ],
        },
        web: {
            sees: [
                /A ford crosses upstream\.<sup class="footnote-ref"><a href="#fn3" id="fnref3">\[3\]<\/a><\/sup>/,
                /<p>The inline note is written in the sentence\./,
            ],
        },
        preview: {
            sees: [
                /A ford crosses upstream\.<sup class="footnote-ref"><a href="#fn3" id="fnref3">\[3\]<\/a><\/sup>/,
                /<p>The inline note is written in the sentence\./,
            ],
        },
        book: {
            sees: [
                /A ford crosses upstream\.#footnote\[The inline note is written in the sentence\.\]/,
            ],
        },
    },

    "wikilink-resolved": {
        summary: "A link to a note in the package is a link to that note.",
        probe: "[[place-harbor|the harbor]]",
        foundry: { sees: [new RegExp(`${UUID}\\{the harbor\\}`)] },
        web: { sees: [/<a href="\/parity\/place-harbor\/">the harbor<\/a>/] },
        preview: {
            sees: [
                /hl-preview-address">place-harbor<\/span>[\s\S]*?hl-preview-label">the harbor<\/span>/,
            ],
            differs:
                "The buffer-only preview has no index, so it shows the link's source: its address and its label.",
            bufferOnly: true,
        },
        indexed: { sees: [/<a href="\/parity\/place-harbor\/">the harbor<\/a>/] },
        book: { sees: [/#link\(<place-harbor>\)\[the harbor\]#book-ix\("place-harbor"\)/] },
    },

    "wikilink-concealed": {
        summary: "A link to a GM-only note conceals the whole reference.",
        probe: "[[lore-vault|the vault]]",
        foundry: {
            sees: [
                new RegExp(
                    String.raw`<span class="secret" data-inline-spoiler="" tabindex="0"[^>]*>${UUID}\{the vault\}</span>`,
                ),
            ],
        },
        web: {
            sees: [
                /<span class="inline-secret-content" hidden>the vault<\/span>/,
                /data-inline-secret data-pagefind-ignore>/,
            ],
        },
        preview: {
            sees: [
                /the concealed one is <span class="hl-preview-bracket">\[\[<\/span><span class="hl-preview-address">lore-vault<\/span>[\s\S]*?hl-preview-label">the vault<\/span>/,
            ],
            differs:
                "The buffer-only preview shows the source of a link to a GM-only note without concealing it: it cannot know the note is GM-only.",
            bufferOnly: true,
        },
        indexed: {
            sees: [
                /the concealed one is <span class="secret" data-inline-spoiler="" tabindex="0"[^>]*>the vault<\/span>\./,
            ],
            absent: [/lore-vault/],
        },
        book: {
            sees: [/the concealed one is #box\[the vault\]\./],
            absent: [/#link\(<lore-vault>\)/],
            differs:
                "The book prints the label of a link to a GM-only note plainly, with no link and no concealment.",
        },
    },

    "wikilink-unresolved": {
        summary: "A link to a note no package publishes is an error at the link.",
        probe: "[[place-nowhere|a lost place]]",
        probeIn: "lost",
        foundry: {
            sees: [
                /lore-lost\.md:9:13: error: journal failed to compile: address \[\[place-nowhere\]\] resolves to no note/,
            ],
            absent: [/<!-- page/],
            of: "lost",
            differs:
                "Foundry refuses the whole note: it compiles no journal and reports the link as an error.",
        },
        web: {
            sees: [
                /<span class="sohl-unresolved-link" title="Unresolved link: place-nowhere">a lost place<\/span>/,
            ],
            of: "lost",
            differs:
                "The site keeps the note and marks the link as unresolved in the sentence; the build reports it as an error.",
        },
        preview: {
            sees: [
                /hl-preview-address">place-nowhere<\/span>[\s\S]*?hl-preview-label">a lost place<\/span>/,
            ],
            of: "lost",
            differs:
                "The buffer-only preview has no index, so it cannot tell an unresolved link from a resolved one.",
            bufferOnly: true,
        },
        indexed: {
            sees: [
                /<span class="sohl-unresolved-link" title="Unresolved link: place-nowhere">a lost place<\/span>/,
            ],
            of: "lost",
        },
        book: {
            sees: [
                /The link to a lost place \(unresolved link\) names a note/,
                /lore-lost\.md:9:13: error: address \[\[place-nowhere\]\] resolves to no note/,
            ],
            of: "lost",
            differs:
                "The book keeps the note and prints the label followed by (unresolved link); the build reports it as an error.",
        },
    },

    "expression-sql": {
        summary: "An inline sql expression is replaced by the query's one value.",
        probe: `{{words (sql "SELECT COUNT(1) FROM notes WHERE type = 'place'")}}`,
        foundry: { sees: [/The count of places is one, the digits/] },
        web: { sees: [/The count of places is one, the digits/] },
        preview: {
            sees: [/The count of places is <span class="hl-preview-dependent">\{\{words \(sql/],
            differs:
                "A query needs the content index; the preview shows the expression's source in a dependent colour.",
        },
        book: { sees: [/The count of places is one, the digits/] },
    },
    "expression-words": {
        summary: "words spells a number in words.",
        probe: `{{words (sql`,
        foundry: { sees: [/places is one,/] },
        web: { sees: [/places is one,/] },
        preview: {
            sees: [/places is <span class="hl-preview-dependent">\{\{words/],
            differs:
                "The words helper wraps a query, which a preview cannot run, so it shows the expression's source.",
        },
        book: { sees: [/places is one,/] },
    },
    "expression-digits": {
        summary: "digits writes a number in digits.",
        probe: `{{digits (sql`,
        foundry: { sees: [/the digits are 1,/] },
        web: { sees: [/the digits are 1,/] },
        preview: {
            sees: [/the digits are <span class="hl-preview-dependent">\{\{digits/],
            differs:
                "The digits helper wraps a query, which a preview cannot run, so it shows the expression's source.",
        },
        book: { sees: [/the digits are 1,/] },
    },
    "expression-ref": {
        summary: "ref names a captioned item by its label, as a link.",
        probe: '{{ref "#trade"}}, and the syntax',
        foundry: { sees: [new RegExp(`the table is ${UUID}\\{Table 1\\}`)] },
        web: { sees: [/the table is <a href="#trade">Table 1<\/a>/] },
        preview: { sees: [/the table is <a href="#trade">Table 1<\/a>/] },
        book: { sees: [/the table is #link\(<lore-corpus--trade>\)\[Table 1\]/] },
    },
    "expression-ref-map": {
        summary: "ref names a captioned map by the map's own label, as a link.",
        probe: 'The map is {{ref "#fig-coast"}}.',
        foundry: { sees: [new RegExp(`The map is ${UUID}\\{Map 1\\}\\.`)] },
        web: { sees: [/The map is <a href="#fig-coast">Map 1<\/a>\./] },
        preview: {
            sees: [/The map is <a href="#fig-coast">Figure 2<\/a>\./],
            differs:
                "The buffer-only preview has no asset index, so it cannot tell that the picture is a map and numbers it a Figure.",
            bufferOnly: true,
        },
        indexed: { sees: [/The map is <a href="#fig-coast">Map 1<\/a>\./] },
        book: { sees: [/The map is #link\(<lore-corpus--fig-coast>\)\[Map 1\]\./] },
    },
    "expression-escaped": {
        summary: "A backslash before an expression shows its syntax literally.",
        probe: '\\{{ref "#trade"}}',
        foundry: { sees: [/shown literally as \{\{ref &quot;#trade&quot;\}\}/] },
        web: {
            sees: [/shown literally as \{\{ref \u201c#trade\u201d\}\}/],
            differs: "The site sets straight quotes as typographic ones, as a printed page does.",
        },
        preview: { sees: [/shown literally as \{\{ref &quot;#trade&quot;\}\}/] },
        book: { sees: [/shown literally as \{\{ref \\"\\#trade\\"\}\}/] },
    },
    "expression-dateformat": {
        summary: "dateformat prints a date.",
        probe: "{{dateformat 720}}",
        foundry: { sees: [/The date reads 720\./] },
        web: { sees: [/The date reads 720\./] },
        preview: {
            sees: [
                /The date reads <span class="hl-preview-dependent">\{\{dateformat 720\}\}<\/span>/,
            ],
            differs:
                "A date needs the package's calendars; the buffer-only preview shows the expression's source.",
            bufferOnly: true,
        },
        indexed: { sees: [/The date reads 720\./] },
        book: { sees: [/The date reads 720\./] },
    },
    "expression-eq": boolean("eq"),
    "expression-gt": boolean("gt"),
    "expression-gte": boolean("gte"),
    "expression-lt": boolean("lt"),
    "expression-lte": boolean("lte"),
    "expression-not": boolean("not"),
    "expression-and": boolean("and"),
    "expression-or": boolean("or"),

    "sql-table": {
        summary: "A sql fence is replaced by the table its query returns.",
        probe: "SELECT shortcode FROM notes WHERE type = 'place' ORDER BY shortcode",
        foundry: { sees: [/<th>shortcode<\/th>[\s\S]*?<td>harbor<\/td>/] },
        web: { sees: [/<th>shortcode<\/th>[\s\S]*?<td>harbor<\/td>/] },
        preview: {
            sees: [/<pre class="hl-preview-fence"><code>```sql\nSELECT shortcode FROM notes/],
            absent: [/<td>harbor<\/td>/],
            differs: "A preview cannot run a query, so it shows the fence's source.",
        },
        book: { sees: [/table\.header\(\[shortcode\]\),\s*\[harbor\],/] },
    },

    "run-lang": {
        summary: "Text in an invented language is tagged with that language.",
        probe: "[Daimela, helthos.]{lang=vyl}",
        foundry: { sees: [/<span lang="art-x-vyl">Daimela, helthos\.<\/span>/] },
        web: { sees: [/<span lang="art-x-vyl">Daimela, helthos\.<\/span>/] },
        preview: {
            sees: [/hl-preview-label">Daimela, helthos\.<\/span>[\s\S]*?\{lang=vyl\}/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        book: {
            sees: [/greeting is #box\[Daimela, helthos\.\] and/],
            differs:
                "The book leaves an invented language's tag out: it sets the text plainly, in the book's own language.",
        },
    },
    "run-lang-real": {
        summary: "Text in a real language keeps its emphasis and carries the language's tag.",
        probe: "[ad _astra_]{lang=la}",
        foundry: { sees: [/<span lang="la">ad <em>astra<\/em><\/span>/] },
        web: { sees: [/<span lang="la">ad <em>astra<\/em><\/span>/] },
        preview: {
            sees: [/hl-preview-label">ad _astra_<\/span>[\s\S]*?\{lang=la\}/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        book: { sees: [/#book-span\(classes: \(\), lang: "la"\)\[ad #emph\[astra\]\]/] },
    },
    "run-map": {
        summary: "Text with a map is rewritten into the face's code points and set in the face.",
        probe: "[thirun sorima]{lang=vyl font=semaron-kuriale map=vyl-semaron}",
        foundry: {
            sees: [
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} \u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/span>/u,
            ],
            absent: [/lintel is cut with <span[^>]*>thirun/],
        },
        web: {
            sees: [
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} \u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/span>/u,
            ],
            absent: [/lintel is cut with <span[^>]*>thirun/],
        },
        preview: {
            sees: [
                /hl-preview-label">thirun sorima<\/span>[\s\S]*?\{lang=vyl font=semaron-kuriale map=vyl-semaron\}/,
            ],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        book: {
            sees: [
                /#book-span\(classes: \("script", "hl-semaron-kuriale"\)\)\[\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} \u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}\]/u,
            ],
            absent: [/lintel is cut with #book-span[^\n]*thirun/],
        },
    },
    "run-emphasis-script": {
        summary:
            "Emphasis in a run set in a script's face follows the script's convention: rubric red for *…*, an overline for **…** here.",
        probe: "[thirun _sorima_]{lang=vyl font=semaron-kuriale map=vyl-semaron}",
        foundry: {
            sees: [
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} <em class="emph-rubric">\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/em><\/span> in red/u,
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} <strong class="emph-overline">\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/strong><\/span> under a line/u,
            ],
        },
        web: {
            sees: [
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} <em class="emph-rubric">\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/em><\/span> in red/u,
                /<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true">\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} <strong class="emph-overline">\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}<\/strong><\/span> under a line/u,
            ],
        },
        preview: {
            sees: [
                /hl-preview-label">thirun _sorima_<\/span>[\s\S]*?\{lang=vyl font=semaron-kuriale map=vyl-semaron\}/,
                /hl-preview-label">thirun \*\*sorima\*\*<\/span>[\s\S]*?\{lang=vyl font=semaron-kuriale map=vyl-semaron\}/,
            ],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        book: {
            sees: [
                /#book-span\(classes: \("script", "hl-semaron-kuriale"\)\)\[\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} #text\(fill: book-rubric\)\[\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}\]\] in red/u,
                /#book-span\(classes: \("script", "hl-semaron-kuriale"\)\)\[\u{F0250}\u{F0237}\u{F023F}\u{F0242}\u{F023C} #overline\[\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}\]\] under a line/u,
            ],
            absent: [/#emph\[\u{F0240}/u, /#strong\[\u{F0240}/u],
        },
    },
    "run-emphasis-words": {
        summary:
            "Emphasis in a language that marks emphasis with a word is an error at the emphasis.",
        probe: "[thirun _sorima_]{lang=tar font=semaron-kuriale map=vyl-semaron}",
        probeIn: "worded",
        foundry: {
            sees: [
                /lore-worded\.md:9:27: error: `tar` marks emphasis with a word, not a mark; write the word/,
            ],
            absent: [/<!-- page/],
            of: "worded",
            differs:
                "Foundry refuses the whole note: it compiles no journal and reports the emphasis as an error.",
        },
        web: {
            sees: [
                /The vow is cut as <span lang="tar" font="semaron-kuriale" map="vyl-semaron">thirun <em>sorima<\/em><\/span> on the lintel\./,
            ],
            of: "worded",
            differs:
                "The site keeps the note and leaves the run as written: roman letters, plain emphasis, and its keys as attributes of the span.",
        },
        preview: {
            sees: [
                /hl-preview-label">thirun _sorima_<\/span>[\s\S]*?\{lang=tar font=semaron-kuriale map=vyl-semaron\}/,
            ],
            of: "worded",
            differs:
                "The buffer-only preview has no index, so it cannot know the language's convention, and shows the source.",
            bufferOnly: true,
        },
        indexed: {
            sees: [
                /The vow is cut as <span lang="tar" font="semaron-kuriale" map="vyl-semaron">thirun <em>sorima<\/em><\/span> on the lintel\./,
            ],
            of: "worded",
        },
        book: {
            sees: [
                /The vow is cut as #book-span\(classes: \(\), lang: "tar"\)\[thirun #emph\[sorima\]\] on the lintel\./,
                /lore-worded\.md:9:27: error: `tar` marks emphasis with a word, not a mark; write the word/,
            ],
            of: "worded",
            differs:
                "The book keeps the note and sets the run as written, in roman letters with plain emphasis; the build reports it as an error.",
        },
    },
    "run-font-mono": generic("mono", "lantern()", "[lantern()]{font=mono}"),
    "run-font-serif": generic("serif", "Harbor Ledger", "[Harbor Ledger]{font=serif}"),
    "run-font-sans": generic("sans", "Plain Label", "[Plain Label]{font=sans}"),
    "run-block": {
        summary: "A div marked with a font and a map sets its paragraphs in the face.",
        probe: "::: {lang=vyl font=semaron-kuriale map=vyl-semaron}",
        foundry: {
            sees: [
                /<div class="script script-block hl-semaron-kuriale" lang="art-x-vyl">\s*<p>\u{F0250}\u{F0237}/u,
            ],
        },
        web: {
            sees: [
                /<div class="script script-block hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true">\s*<p>\u{F0250}\u{F0237}/u,
            ],
        },
        preview: {
            sees: [
                /<div class="" lang="vyl" font="semaron-kuriale" map="vyl-semaron">\s*<p>thirun sorima\.<\/p>\s*<p>mamu anthrasos\.<\/p>/,
            ],
            differs:
                "The buffer-only preview has no script notes: it sets the div's roman text unmapped and in no face.",
            bufferOnly: true,
        },
        book: {
            sees: [
                /#block\(width: 100%\)\[#book-script-text\(classes: \("script", "script-block", "hl-semaron-kuriale"\)\)\[\u{F0250}\u{F0237}/u,
            ],
        },
    },
    "run-verse": {
        summary: "A verse fence marked with a font and a map sets its lines in the face.",
        probe: "```verse {form=epic lang=vyl font=semaron-kuriale map=vyl-semaron}",
        foundry: {
            sees: [
                /<div class="verse script hl-semaron-kuriale" lang="art-x-vyl" data-form="epic">\s*<p><span class="verse-line">\u{F0250}\u{F0237}/u,
            ],
        },
        web: {
            sees: [
                /<div class="verse script hl-semaron-kuriale" lang="art-x-vyl" data-form="epic" data-pagefind-ignore="true">\s*<p><span class="verse-line">\u{F0250}\u{F0237}/u,
            ],
        },
        preview: {
            sees: [
                /<div class="verse" data-form="epic" lang="vyl" data-font="semaron-kuriale" data-map="vyl-semaron">\s*<p><span class="verse-line">thirun sorima<\/span><br>\s*<span class="verse-line i1">mamu anthrasos\.<\/span>/,
            ],
            differs:
                "The buffer-only preview has no script notes: it sets the verse's roman text unmapped and in no face.",
            bufferOnly: true,
        },
        book: {
            sees: [
                /#book-script-text\(classes: \("script", "hl-semaron-kuriale"\)\)\[\u{F0250}\u{F0237}[\s\S]*? \\\n#h\(1\.25em\)/u,
            ],
        },
    },

    icon: {
        summary: "An icon token draws the registry's glyph.",
        probe: ":icon star:{size=lg}",
        foundry: {
            sees: [
                /A star <i class="fa-solid fa-star fa-lg" role="img" aria-label="star"><\/i> marks the entry\./,
            ],
        },
        web: {
            sees: [
                /A star <i class="fa-solid fa-star fa-lg" role="img" aria-label="star"><\/i> marks the entry\./,
            ],
        },
        preview: {
            sees: [/A star :icon star:\{size=lg\} marks the entry\./],
            differs: "The buffer-only preview has no icon registry: the token stays literal.",
            bufferOnly: true,
        },
        book: {
            sees: [/A star :icon star: marks the entry\./],
            differs:
                "The book draws an icon from a configured icon font; with none it prints the token's name and drops its attributes.",
        },
    },

    "image-directive": {
        summary: "A picture's size and float directive is honoured.",
        probe: "{size=small float=top-right}",
        foundry: {
            sees: [
                /<figure class="note-image note-image-size-small note-image-float-top-right">\s*<img src="modules\/parity\/images\/pennant\.png" alt="A floated pennant"/,
            ],
        },
        web: {
            sees: [
                /<figure class="note-image note-image-size-small note-image-float-top-right">\s*<img src="https:\/\/cdn\.example\.org\/parity\/images\/pennant\.png" alt="A floated pennant"/,
            ],
        },
        preview: {
            sees: [
                /<figure class="note-image note-image-size-small note-image-float-top-right">\s*<img src="images\/pennant\.png" alt="A floated pennant">/,
            ],
            absent: [/\{size=small/],
        },
        indexed: {
            sees: [
                /<figure class="note-image note-image-size-small note-image-float-top-right">\s*<img src="https:\/\/cdn\.example\.org\/parity\/images\/pennant\.png" alt="A floated pennant"/,
            ],
        },
        book: {
            sees: [
                /#place\(top \+ right, float: true, scope: "column", clearance: 0\.7em\)\[\s*#book-image\("parity-parity\/assets\/images\/pennant\.png", requested: 1\.6cm, caption: none\)/,
            ],
        },
    },

    "glyph-inline": {
        summary:
            "A glyph span draws a sign as a picture in the line of text, its label as alt text.",
        probe: "[Ra]{.glyph slug=ra size=inline}",
        foundry: {
            sees: [
                /<span class="glyph glyph-inline"><img src="modules\/parity\/icons\/ra\.svg" alt="Ra" loading="lazy"/,
            ],
        },
        web: {
            sees: [
                /<span class="glyph glyph-inline"><img src="https:\/\/cdn\.example\.org\/parity\/icons\/ra\.svg" alt="Ra" loading="lazy" \/><\/span>/,
            ],
        },
        preview: {
            sees: [
                /hl-preview-label">Ra<\/span><span class="hl-preview-bracket">\]<\/span><span class="hl-preview-attribute">\{\.glyph slug=ra size=inline\}/,
            ],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: {
            sees: [
                /<span class="glyph glyph-inline"><img src="https:\/\/cdn\.example\.org\/parity\/icons\/ra\.svg" alt="Ra" loading="lazy" \/><\/span>/,
            ],
        },
        book: {
            sees: [
                /#box\(baseline: 25%, image\("parity-parity\/assets\/icons\/ra\.svg", height: 1\.8em\)\)/,
            ],
        },
    },

    "glyph-tablet": {
        summary: "A glyph with frame=tablet sits in a stone tablet.",
        probe: "[the sun god]{.glyph slug=ra frame=tablet}",
        foundry: { sees: [/<span class="glyph glyph-tablet"><img [^>]*alt="the sun god"/] },
        web: { sees: [/<span class="glyph glyph-tablet"><img [^>]*alt="the sun god"/] },
        preview: {
            sees: [/\{\.glyph slug=ra frame=tablet\}/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: { sees: [/<span class="glyph glyph-tablet"><img [^>]*alt="the sun god"/] },
        book: {
            sees: [
                /#box\(fill: rgb\("#ece1c8"\)[^\n]*image\("parity-parity\/assets\/icons\/ra\.svg"/,
            ],
            differs:
                "The book fills a box behind the sign; the web and Foundry draw the stone frame in CSS.",
        },
    },

    "glyph-block": {
        summary: "A glyph with size=block stands on a line of its own.",
        probe: "[the sun]{.glyph slug=ra size=block}",
        foundry: { sees: [/<span class="glyph glyph-block"><img [^>]*alt="the sun"/] },
        web: { sees: [/<span class="glyph glyph-block"><img [^>]*alt="the sun"/] },
        preview: {
            sees: [/\{\.glyph slug=ra size=block\}/],
            differs: SOURCE_ONLY,
            bufferOnly: true,
        },
        indexed: { sees: [/<span class="glyph glyph-block"><img [^>]*alt="the sun"/] },
        book: {
            sees: [
                /#align\(center, image\("parity-parity\/assets\/icons\/ra\.svg", height: 1\.8em\)\)/,
            ],
        },
    },

    "cartouche-span": {
        summary:
            "A cartouche span in the middle of a sentence draws a centred figure with its caption.",
        probe: '[Ta Kheperu]{.cartouche slug=takheperu caption="The Land of Kheper"}',
        foundry: {
            sees: [
                /middle of a sentence, <figure class="cartouche"><img src="modules\/parity\/images\/takheperu\.svg" alt="Ta Kheperu" loading="lazy"[^>]*\/><figcaption>The Land of Kheper<\/figcaption><\/figure>/,
            ],
            absent: [/\{\.cartouche/],
        },
        web: {
            sees: [
                /middle of a sentence, <figure class="cartouche"><img src="https:\/\/cdn\.example\.org\/parity\/images\/takheperu\.svg" alt="Ta Kheperu" loading="lazy" \/><figcaption>The Land of Kheper<\/figcaption><\/figure>/,
            ],
            absent: [/\{\.cartouche/],
        },
        preview: {
            sees: [
                /middle of a sentence, <figure class="cartouche"><img src="images\/cartouches\/takheperu\.svg" alt="Ta Kheperu" loading="lazy" \/><figcaption>The Land of Kheper<\/figcaption>/,
            ],
            absent: [/\{\.cartouche/],
        },
        indexed: {
            sees: [
                /<figure class="cartouche"><img src="https:\/\/cdn\.example\.org\/parity\/images\/takheperu\.svg" alt="Ta Kheperu"/,
            ],
        },
        book: {
            sees: [
                /#align\(center, block\(breakable: false\)\[#image\("parity-parity\/assets\/images\/cartouches\/takheperu\.svg", height: 10em\) \\ #text\(.*?\)\[The Land of Kheper\]\]\)/,
            ],
            differs:
                "The book sets the cartouche as a figure between the lines of its sentence; print cannot hold it inside a line.",
        },
    },

    "cartouche-leading": {
        summary:
            "A paragraph that opens with a cartouche is still Markdown: its emphasis and link are read.",
        probe: "[Ta Kheperu]{.cartouche slug=takheperu} opens this paragraph",
        foundry: {
            sees: [
                /<p><figure class="cartouche"><img [^>]*\/><\/figure> opens this paragraph, which goes on with <em>stress<\/em> and a link to /,
            ],
            absent: [/_stress_/],
        },
        web: {
            sees: [
                /<p><figure class="cartouche"><img [^>]*\/><\/figure> opens this paragraph, which goes on with <em>stress<\/em> and a link to /,
            ],
            absent: [/_stress_/],
        },
        preview: {
            sees: [
                /<p><figure class="cartouche"><img [^>]*\/><\/figure> opens this paragraph, which goes on with <em>stress<\/em> and a link to /,
            ],
            absent: [/_stress_/],
        },
        book: {
            sees: [/opens this paragraph, which goes on with #emph\[stress\] and a link to /],
            differs: "The book sets the cartouche as a figure between the lines of its paragraph.",
        },
    },

    "cartouche-floated": {
        summary: "A cartouche with align and height floats to a side at that height.",
        probe: "[Ta Kheperu]{.cartouche slug=takheperu align=right height=6rem}",
        foundry: {
            sees: [
                /<figure class="cartouche cartouche-right"><img [^>]*style="height: 6rem; width: auto; max-width: none;"/,
            ],
        },
        web: {
            sees: [
                /<figure class="cartouche cartouche-right"><img [^>]*style="height: 6rem; width: auto; max-width: none;"/,
            ],
        },
        preview: {
            sees: [
                /<figure class="cartouche cartouche-right"><img [^>]*style="height: 6rem; width: auto; max-width: none;"/,
            ],
        },
        book: {
            sees: [
                /#align\(right, block\(breakable: false\)\[#image\("parity-parity\/assets\/images\/cartouches\/takheperu\.svg", height: 6em\)\]\)/,
            ],
            differs:
                "The book sets the cartouche at the right of its own line; print cannot wrap text around it.",
        },
    },

    "cartouche-left": {
        summary: "A cartouche with align=left floats to the left.",
        probe: "[Ta Kheperu]{.cartouche slug=takheperu align=left}",
        foundry: { sees: [/<figure class="cartouche cartouche-left"><img /] },
        web: { sees: [/<figure class="cartouche cartouche-left"><img /] },
        preview: { sees: [/<figure class="cartouche cartouche-left"><img /] },
        book: {
            sees: [
                /#align\(left, block\(breakable: false\)\[#image\("parity-parity\/assets\/images\/cartouches\/takheperu\.svg", height: 7em\)\]\)/,
            ],
            differs:
                "The book sets the cartouche at the left of its own line; print cannot wrap text around it.",
        },
    },

    "cartouche-block-form": {
        summary: "A cartouche written as a block fence is an error and draws no cartouche.",
        probe: ':::cartouche {slug="takheperu"}',
        probeIn: "fenced",
        foundry: {
            sees: [/lore-fenced\.md:\d+:1: error: there is no cartouche block/],
            absent: [/<figure class="cartouche/],
            of: "fenced",
            differs: "Foundry refuses the whole note and reports the fence as an error.",
        },
        web: {
            sees: [/cartouche/],
            absent: [/<figure class="cartouche/],
            of: "fenced",
            differs:
                "The site keeps the note and shows the fence as text; the build reports it as an error.",
        },
        preview: {
            sees: [/cartouche/],
            absent: [/<figure class="cartouche/],
            of: "fenced",
        },
        book: {
            sees: [/cartouche/],
            absent: [/<figure class="cartouche/, /takheperu\.svg/],
            of: "fenced",
        },
    },

    "raw-html": {
        summary: "Raw HTML in a note is passed through where a surface can draw it.",
        probe: '<abbr title="abbreviation">abbr</abbr>',
        foundry: {
            sees: [
                /<abbr title="abbreviation">abbr<\/abbr> tag inline\./,
                /<div class="raw-block">A raw block of markup\.<\/div>/,
            ],
        },
        web: {
            sees: [
                /<abbr title="abbreviation">abbr<\/abbr> tag inline\./,
                /<div class="raw-block">A raw block of markup\.<\/div>/,
            ],
        },
        preview: {
            sees: [
                /&lt;abbr title=&quot;abbreviation&quot;&gt;abbr&lt;\/abbr&gt; tag inline\./,
                /&lt;div class=&quot;raw-block&quot;&gt;A raw block of markup\.&lt;\/div&gt;/,
            ],
            absent: [/<abbr/, /<div class="raw-block"/],
            differs: "The preview parses with HTML off, so a tag reads as text.",
        },
        book: {
            sees: [
                /\\<abbr title=\\"abbreviation\\"\\>abbr\\<\/abbr\\> tag inline\./,
                /\\<div class=\\"raw-block\\"\\>A raw block of markup\.\\<\/div\\>/,
            ],
            differs:
                "The book has no route from HTML to Typst: the tag prints as text, and the build warns.",
        },
    },
};

/**
 * Marked text and icons read the package's configuration, not the content
 * index, so the preview given an index sets them as Foundry does.
 */
for (const id of [
    "run-lang",
    "run-lang-real",
    "run-map",
    "run-emphasis-script",
    "run-block",
    "run-verse",
    "icon",
]) {
    const { sees, absent } = CONSTRUCTS[id].foundry;
    CONSTRUCTS[id].indexed = { sees, ...(absent ? { absent } : {}) };
}

/** A captioned item of one figure kind. */
function figure(kind: string, probe: string, label: string): Construct {
    const labelPattern = new RegExp(label.replace(/[.()]/g, "\\$&"));
    const id = /\{#([\w-]+)/.exec(probe)![1];
    // The label sits in its own figure's wrapper: no other figure opens between.
    const ownWrapper = new RegExp(
        String.raw`<div id="${id}" class="content-figure content-figure-${kind}[^"]*">(?:(?!<div id=")[\s\S])*?<p class="content-figure-label">${label.replace(/[.()]/g, "\\$&")}</p>\s*</div>`,
    );
    const html = () => [
        new RegExp(String.raw`class="content-figure content-figure-${kind}[^"]*"`),
        new RegExp(
            String.raw`<p class="content-figure-label">${label.replace(/[.()]/g, "\\$&")}</p>`,
        ),
    ];
    const typst = new RegExp(
        String.raw`#text\(size: 7\.6pt, style: "italic"\)\[${label.replace(/[.()]/g, "\\$&")}\]`,
    );
    return {
        summary: `A captioned ${kind} is numbered with its own counter.`,
        probe,
        foundry: {
            sees: [new RegExp(String.raw`<!-- page "${label.split(":")[0]}" type=text`), ...html()],
            differs:
                "Foundry gives a captioned item a journal page of its own, titled with its number.",
        },
        web: { sees: html() },
        preview: { sees: [labelPattern, ownWrapper] },
        book: { sees: [typst] },
    };
}
