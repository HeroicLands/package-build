---
shortcode: referencesettlementnames
type: doc
name: { full: "Settlement name candidates" }
texinfo:
  parent: homepage-root
  after: [referencesettlementurban]
---

<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Settlement name candidates

`proposeSettlementName` builds one candidate for an explicit on-demand operation. It consumes an indexed culture with a resolved `lang`, an indexed language note with the matching configured `languageCode`, a stable settlement identity and seed, exclusions, and validation callbacks. It neither discovers settlements nor writes names into notes. Ordinary indexing, lint and builds do not call it.

The supported composition is one plain place-compatible opening or either element followed by one plain place-compatible closing or either element. A single indexed `data.naming.draws` entry for `kind: place` must permit place elements. An element whose `kind` is absent applies to every kind; elements limited to given names or bynames cannot supply this pool. A link element is not an opening or closing. The helper uses the declared base `form` and does not select variants, joining forms, clipping, a linker, a founder, a deity, or held-from sources. An element carrying a joining form is outside this plain subset. A language declaring held-from operations needs a supported source-specific composition before this helper can use it. Missing or unsupported declarations produce a `missing` result, not an invented recipe.

The caller supplies `exclusions` as all existing names and aliases and names already selected by the current operation. Exclusions use the shared `normalizeName` comparison: Unicode NFC, straight apostrophes, normalized whitespace and case folding. The candidate itself is composed in NFC without changing case or removing pronunciation marks. Each check receives that candidate and a context containing the selected culture, language, identity and lexical components. Component senses describe the declared words; they do not establish a settlement's geography, holder or history.

## Validation boundary

The caller supplies five synchronous callbacks in `validators`: `spelling`, `language`, `earthWords`, `earthNames`, and `indexedNames`. Each receives `(candidate, context)` and returns `{available: true, valid: true}` for acceptance or `{available: true, valid: false}` for rejection. It returns `{available: false}` when the required checker or its data is unavailable. The callback may include additional evidence in its result. Throws, promises, thenables, and ambiguous results produce `validation-error`; absent callbacks or unavailable data produce `missing`. Every callback must report available and valid before a candidate is accepted.

The caller connects actual checks and preloaded data for the selected language. `spelling` covers the governing pronunciation and spelling guide; `language` covers the selected language's declared inventory, applicable shape and edge constraints, and flavor; `earthWords` covers the applicable model-language whole-word and English-word collisions; `earthNames` covers proper-name collisions; `indexedNames` covers indexed names, aliases and registers. None of those resources is bundled or validated by this helper. A callback must report unavailable when its required data or coverage is unavailable; it must not interpret the absence of a list as a successful check. The supplied exclusions are an additional explicit guard, not a substitute for the indexed-name checker.

## Selection and results

The seed and stable identity determine a reproducible ordering of the finite opening and closing pools. `maxCandidates` is a required positive integer limiting examined pairs, including excluded and rejected pairs. A `budget` result means more pairs remain; `exhausted` means every pair was considered without acceptance. Neither produces a replacement name. An accepted result contains the candidate, culture and language Addresses, declared component forms and senses, and all callback outcomes. It does not prove the suitability of those meanings for a particular place.

An `authored` value must bind an existing captured name to the same stable identity with `{identity, name}`. It returns the exact authored text as `authored`, with no claim that a newly generated candidate passed validation. The caller obtains this binding from the captured content session. Without that explicit binding the helper does not infer an existing identity from a name.

## API contract

Call `proposeSettlementName` with one object:

| Field           | Required            | Meaning                                                                                                                                                     |
| --------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `culture`       | Yes, for generation | Indexed record with `package`, `shortcode`, `type: lore`, `subType: culture`, and resolved nonempty `lang`.                                                 |
| `language`      | Yes, for generation | Indexed record with `package`, `shortcode`, `type: skill`, `subType: language`, matching nonempty `languageCode`, `data.elements`, and `data.naming.draws`. |
| `identity`      | Yes                 | Nonempty stable settlement identity.                                                                                                                        |
| `seed`          | Yes, for generation | Nonempty string selecting the deterministic order.                                                                                                          |
| `exclusions`    | Yes, for generation | Array of nonempty existing, alias, and already selected name strings; an empty array is explicit.                                                           |
| `validators`    | Yes, for generation | Object with all five named synchronous callbacks described above.                                                                                           |
| `maxCandidates` | Yes, for generation | Positive safe integer limiting examined declaration pairs.                                                                                                  |
| `authored`      | No                  | Object `{identity, name}` from a captured authored fact; its identity must equal the selected identity and its name must be nonempty.                       |

A valid `authored` binding returns before generation fields or callbacks are required. Its text is returned exactly. An invalid or mismatched binding produces `missing`; it is not replaced by a generated candidate.

Each callback receives the NFC `candidate` string and this context object:

| Context field                       | Meaning                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `identity`, `seed`                  | The supplied stable identity and selection seed.                                       |
| `cultureAddress`, `languageAddress` | Fully qualified note Addresses derived from each record's package, type and shortcode. |
| `culture`, `language`               | The indexed records supplied by the caller.                                            |
| `elements`                          | Two component provenance objects, in opening then closing order.                       |

Each component has `index` (zero-based index into `language.data.elements`), `form` (the declared base form), `kind` (`place` or null when unrestricted), `position` (`opening`, `closing`, or `either`), and `sense` (the declared lexical meaning). The two elements are not a claim about a settlement's physical setting.

The callback result is a synchronous object with an own enumerable boolean `available` property. When `available` is true it also has an own enumerable boolean `valid` property. An unavailable result produces `missing`; an available but invalid result rejects that pair. Availability and validity come from one shallow snapshot; additional enumerable own properties are retained as evidence in an accepted candidate's `checks`. A callback exception, exception while inspecting its result, promise, thenable, or malformed result produces `validation-error`. A rejected pair stops at its first rejecting check. The next pair has its own component context, even when it forms the same visible label.

The result has one of these status shapes:

| Status             | Other fields                                                                              | Meaning                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `authored`         | `identity`, `name`                                                                        | The supplied matching authored binding.                                                                      |
| `accepted`         | `identity`, `name`, `cultureAddress`, `languageAddress`, `elements`, `checks`, `examined` | One candidate accepted by every required callback. `checks` maps each callback name to its captured outcome. |
| `missing`          | `field`, `message`; `examined` when a callback reports unavailable                        | A required declaration, input, callback, or checker resource is unavailable.                                 |
| `validation-error` | `field`, `message`; `examined` when failure occurs during a callback                      | A callback or its returned value cannot be used. Callback-object inspection can fail before enumeration.     |
| `budget`           | `identity`, `examined`, `totalPairs`                                                      | The budget is spent while declaration pairs remain.                                                          |
| `exhausted`        | `identity`, `examined`, `totalPairs`                                                      | Every pair was examined without an accepted candidate.                                                       |

`totalPairs` is the product of the eligible opening and closing declaration counts, and must be a safe integer. `examined` counts visited pairs, including those skipped by exclusions or rejected by a callback. When the budget equals the number of pairs and none passes, the outcome is `exhausted`.

## Command resources

The settlement command compares its captured note data with the supplied published
content index using the production index serializer. Canonical and nested Address
fields have the same published encoding on both sides. A stale name, subtype,
relationship or other compared note value refuses naming before the check factory
runs. Supply the index emitted by the normal content-index build, not an ad hoc
JSON dump of in-memory records.

Resource-loader problems appear in the JSON `missing` list and as located standard
error diagnostics. Captured temporary paths are mapped to their original input
paths. See [work budgets](settlement-placement.md#work-budgets) for the finite
capture, validation and candidate limits.
