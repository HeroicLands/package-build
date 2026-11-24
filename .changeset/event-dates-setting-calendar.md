---
"@heroiclands/package-build": patch
---

**Content and notes**

- A calendar can set an optional `formats.display` to choose how its dates print, such as `D MMMM Y GGG` over a numeric `std`, so a date reads `29 Brazemandi 709 AF` and not `04/29/709 AF`.
- The format applies to the infobox, `dateformat` with no format named, event views, event references and the index's resolved dates. A calendar with a numeric `std` keeps printing numbers until it sets `display`.
- A calendar with no `display` prints as before. A day in no calendar prints as `day 120 of 709`.
- A `display` format that uses a token needing Calendaria runtime data is reported at `data.formats.display`.
