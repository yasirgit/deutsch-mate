# Content authoring schemas

JSON Schema exports generated from `@deutsch-mate/content-schemas` (Zod 4.4.3).

Regenerate and validate examples:

```sh
pnpm content:schema
```

## Authoring format

Documents are JSON files with:

| Field | Meaning |
| ----- | ------- |
| `schemaVersion` | Always `1` for this format |
| `kind` | `cefr_descriptor` \| `objective` \| `module` \| `unit` |
| stable `*Key` | Survives revisions (`moduleKey`, `unitKey`, …) |
| `version` | Positive integer; immutable once released |

Rich text is a closed AST (`type: "doc"`), never HTML. Answer keys use only
declarative `answerSpec` kinds (`exact`, `case_folded`, `normalized`, `set`,
`ordered`, `matching`, `weighted_alternatives`, `cloze`). Executable
expressions and speaking/assessment activity types are rejected.

CEFR levels are A1–B2 only. Skills: reading, listening, writing, vocabulary,
grammar. Access tiers: `free` | `premium`. Listening requires
`transcriptPolicy`.

See `content/examples/` for canonical documents covering every MVP activity
type. Release inventory validation, manifests, and draft DB import live in
`@deutsch-mate/content-pipeline` (`pnpm content:validate`, `content:manifest`,
`content:test-import`). Smoke fixture: `content/fixtures/import-smoke/`.
