# Script-font fixture

The binaries are test files, not production fonts. `fonts/fonts.json` retains
its existing code points and files. Glyph codes for matching code points are
snapshotted from the font producer's `tools/codes/*.json` tables at the
fonts-only redesign. The 44 older Qalezu numeral points that exist only in
this fixture use explicit `TEST_U…` codes; these are fixture identifiers,
not names proposed for the published font.

The installed-font fixture contains glyph data only. Executable encodings live
in content-note fixtures; internal legacy row vectors remain separately under
`tests/fixtures/encodings/`.
