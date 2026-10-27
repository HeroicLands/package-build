# Published encoding fixtures

The JSON definitions and conformance vectors are published encoding files from
[HeroicLands/fonts](https://git.pupluppy.org/HeroicLands/fonts), commit
`90398d78194dd500140a54826c29ae1e440c513a`. Their source-byte hashes are in
`SOURCE-SHA256SUMS`; fixture layout follows the package formatter. The files
carry the accompanying SIL Open Font License in [LICENSE](LICENSE).

The conformance test copies each definition alone to an empty directory. Its
compiler receives only the parsed file, and cannot read a standard, codage,
character-name table or other external resource.
