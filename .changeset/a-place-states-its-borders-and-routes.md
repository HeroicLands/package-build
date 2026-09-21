---
"@heroiclands/package-build": patch
---

A `place` note may state what it is next to and what it is reachable from, as `data.borders` (`{ to, bearing }`) and `data.routes` (`{ to, bearing, mode, days, terrain?, leagues? }`), with bearings from the eight compass points, modes `land | boat | ship`, days from the marker scale `1 2 3 5 10 20 30 45 60 90 180 360` and terrains from a closed registry. `content-build lint` checks that every `to` is a place, that every value is from its set, and that the other note states the pair back — a missing reciprocal is a warning naming both notes, a contradictory one an error. The content index carries both lists, so a dependency's places take part.
