# Content language server

`heroiclands-content-language-server` provides editor navigation for Markdown notes in a HeroicLands content project. It is a stdio Language Server Protocol process; an editor starts it from the project root. The command uses the same `package-build.config.yaml` and Address rules as `content-build`.

Build the content index in the project before starting navigation:

```sh
npx content-build content-index
```

The generated JSONL file under the configured `paths.contentIndex` is the source for note names, aliases, tags, shortcodes, Addresses, and destinations. Search covers the current project. Search and destinations reflect the saved index, so run the index command after changing note metadata. The language server reads a completed replacement index on its next request. An editor's unsaved buffer text is used to identify the Address at the cursor, but it does not add search results.

| LSP request               | Behavior                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `textDocument/definition` | Follows an Address or wikilink to the indexed note. An anchor lands on its indexed line.                                     |
| `workspace/symbol`        | Finds notes by name, alias, ASCII name, shortcode, or Address. `tag:myth` searches tags. One result appears per source note. |
| `textDocument/references` | Finds authored wikilinks, embeds, and declared frontmatter Address values or keys. Ordinary prose is excluded.               |

The server reports a missing index with the `content-build content-index` command. Reference search requires `rg` on `PATH`. The server writes only LSP messages to stdout, and it uses UTF-16 positions as required by the default LSP position encoding.

## Editor integration

The [HeroicLands Emacs package](https://github.com/HeroicLands/heroiclands-emacs) connects this command through Eglot in content Markdown buffers. Eglot maps `M-.` to definition, `C-M-.` to workspace search, `M-?` to references, and `M-,` to the Xref location stack.

An editor other than Emacs starts the executable from the package root and associates it with Markdown notes under the configured content directory. The process handles `initialize`, `shutdown`, `exit`, full and incremental document synchronization, definition, references, and workspace symbols. It does not advertise completion, diagnostics, rename, or document symbols.
