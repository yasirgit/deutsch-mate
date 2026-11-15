# `@deutsch-mate/content-schemas`

Strict Zod authoring schemas for versioned curriculum content (DM-029).

Covers CEFR descriptors, objectives, modules, units, lessons, activities,
answer keys, rubrics, assets, and rich-text ASTs. Runtime validation rejects
unknown fields, HTML blobs, executable answer expressions, speaking/assessment
constructs, and CEFR C1/C2.

## Ownership

- `dm.tier: shared`, `clientSafe: false` — authoring/tooling and server-side
  import pipelines only (not shipped to web/mobile bundles).

## Commands

```sh
pnpm content:schema                                    # export JSON Schema + validate examples
pnpm test --filter @deutsch-mate/content-schemas       # unit tests
```

## Related paths

| Path                        | Role                                   |
| --------------------------- | -------------------------------------- |
| `packages/content-schemas/` | Zod schemas + deterministic validators |
| `content/schema/`           | Exported JSON Schema + authoring notes |
| `content/examples/`         | Canonical authoring examples           |

Import/DB loading is DM-030 and is intentionally out of scope here.
