---
"@heroiclands/package-build": patch
---

Every place page that states a border or a route, or is named in one, carries the map from that place: `from-<shortcode>.svg` beside the page and `map:` naming it in the front matter, with every place name on it a link to that place's page. GraphViz draws it; when GraphViz is not installed the site build says so once and writes every page without a map, and `site.maps: false` draws none.
