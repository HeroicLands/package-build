---
"@heroiclands/package-build": minor
---

Author encodings as `doc` notes with `data.language`, `font`, `mappings` and executable `rules`; fonts supply glyph codes in `fonts.json`.
Select the note with `enc=`, whose default Address type is `doc`, to infer its language and font; `enc=default` keeps Roman text unchanged.
Replace `map=`, remove `data.map` and `data.writtenIn` declarations, and select encodings directly instead of `.nativefont`.
Engine callers use `compileEncoding(data, {codes, name})`, `encodePieces`, `encodeText`, `decodeText`, `validateSource` and `encodeWithLanguage`, with `encodingsFromRecords` resolving content documents.
Runs and native SQL rows expose `enc`; every authoritative word and name is checked even when unused, and unknown characters, codes or contradictory language/font selections are positioned errors.

`compileMap`, `applyMap`, `mappingFor`, `nativeLookup` and `transliterate` are replaced by these APIs.
