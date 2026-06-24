---
name: shopi-cli-usage
description: >-
  Core guidance for using the shopi CLI (`shopi`), a JSON-first, schema-driven
  command line over the Shopify Admin GraphQL API. Covers discovery (ops/schema),
  reading (`shopi read`), writing (`shopi write`), exact GraphQL (`shopi gql`),
  flags, output formats, GIDs, pagination, and write safety. Use this skill
  whenever the user wants to run, design, script, or debug `shopi` commands, or
  to inspect or change a Shopify store from the command line via the Admin API —
  including products, orders, customers, inventory, metafields, discounts, and
  any other Admin resource — even when they don't say "shopi" or "GraphQL"
  explicitly. This is the hub skill; for a specific domain, also load the
  matching shopi-* skill (auth, products, orders, customers, inventory,
  metafields, discounts, bulk-operations).
---

# shopi CLI usage

`shopi` is an intentionally THIN, JSON-first CLI over the **Shopify Admin GraphQL
API**. It does not ship a fixed set of resource commands. Instead it is
schema-driven: it reads the live Admin schema and lets you address every
QueryRoot and MutationRoot field. That design has one big implication for how to
use it well:

> **Discover, then act.** The right field, argument, and input shape come from
> the live schema (`shopi ops show`, `shopi schema show`), not from memory. When
> unsure, discover first — the schema is the source of truth for the store's API
> version.

`shopi` cannot exceed the app's granted Shopify access scopes. A read scope can
only read; writes need matching write scopes. Scope problems surface as GraphQL
or HTTP errors, not as silent no-ops.

## The five things shopi does

| Verb | Purpose |
| --- | --- |
| `shopi gql` | Run an exact GraphQL document you wrote (full control). |
| `shopi read <field>` | Build + run a query from any QueryRoot field. |
| `shopi write <field>` | Build + run a mutation from any MutationRoot field (needs `--confirm`). |
| `shopi ops` | Discover QueryRoot/MutationRoot fields and their arguments. |
| `shopi schema` | Pull/cache the schema and inspect any type. |

Plus `shopi auth` (credentials/profiles), `shopi docs` (bundled guides), `shopi
init` (local workspace), `shopi version`, and `shopi help [auth|gql|read|write]`.

`--help` and `shopi help <topic>` are always a safe, offline source of truth for
the CLI surface. Use them to confirm flags before constructing a command.

## Discovery workflow (do this when you don't know the field)

```sh
shopi ops list --kind query  --filter product      # find QueryRoot fields
shopi ops list --kind mutation --filter inventory   # find MutationRoot fields
shopi ops show productSet --kind mutation --json --pretty   # exact args + types
shopi schema show ProductSetInput --json --pretty          # inspect an input type
```

`ops show` tells you each argument's name, GraphQL type, whether it is required
(`Type!`), its default, and description. `schema show <Type>` expands input
objects, enums, and object fields. Together they remove all guesswork before you
build a `read`/`write`.

`--filter` is a case-insensitive substring match on the field name. Omit
`--kind` to search both query and mutation roots.

## Reading data — `shopi read`

`shopi read <field>` validates the field and its arguments against the live
schema, then builds and runs a query.

```sh
shopi read products --first 10 --select 'nodes { id title handle status }'
shopi read orders --first 25 --query 'financial_status:paid' --json
shopi read product --id gid://shopify/Product/1234567890 --json --pretty
```

Passing arguments (sources merge; later sources win):

- Per-argument flags: `--first 10`, `--id gid://...`, `--query '...'` (any schema
  arg works, in camelCase or kebab-case).
- `--arg name=value` (repeatable, type-coerced — see Input rules below).
- `--args '<json>'` (alias `--variables`) for a whole argument object.

`--select '<selection>'` is the GraphQL selection set. **If you omit it, shopi
auto-generates a reasonable selection** (depth ≤ 3; prefers id/title/handle/
status/etc.; connection-aware; includes `userErrors`). Auto-selection is great
for exploration but you should pass an explicit `--select` for anything you parse
downstream, so the shape is stable.

Preview the generated query without calling Shopify:

```sh
shopi read products --first 5 --dry-run --json --pretty
```

## Writing data — `shopi write` (guarded)

`shopi write <field>` builds a mutation the same way, but **refuses to execute
without `--confirm`**. This is the core safety rail.

```sh
# 1) Preview the exact generated mutation + variables. No --confirm needed.
shopi write productCreate --arg product=@product.json \
  --select 'product { id title handle } userErrors { field message }' \
  --dry-run --json --pretty

# 2) Run it for real only after reviewing the dry run.
shopi write productCreate --arg product=@product.json \
  --select 'product { id title handle } userErrors { field message }' \
  --confirm --json --pretty
```

- `--input @file.json` is a shortcut that only works when the mutation has
  exactly **one** Input-typed argument, or an argument literally named `input`
  (e.g. `productSet(input: …)`). Many mutations take several arguments — e.g.
  `productCreate(product:, media:)` — so pass each explicitly with `--arg
  name=value` / `--arg name=@file.json`. When unsure, `shopi ops show <mutation>
  --kind mutation` lists the exact argument names; if `--input` is rejected, it
  tells you to use `--arg name=@file` instead.
- **Always select and check `userErrors { field message }`.** A `200` response
  with a non-empty `userErrors` means the mutation did NOT apply — shopi will not
  raise an error for userErrors, so you must read them.

Aliases: `shopi mutate` / `shopi mutation` behave identically to `shopi write`.

## Exact GraphQL — `shopi gql`

When you need fragments, aliases, multiple root fields, or precise nested
selections, write the document yourself.

```sh
shopi gql --query '{ shop { name myshopifyDomain } }'
shopi gql --file query.graphql --variables @variables.json --json --pretty
shopi gql --file mutation.graphql --variables '{"id":"gid://shopify/Product/1"}' --confirm
```

Document source resolution: `--file` > `--query` > positional text > stdin.
Variables: `--variables` / `--vars` / `--variables-file` (JSON; `@file` and `-`
for stdin supported). Mutation documents are guarded exactly like `shopi write`:
they need `--confirm`, and `--dry-run` prints `{ query, variables }`.

Add `--full` to include the whole response (`data` + `errors` + `extensions`).
Without it, shopi prints only `data`. `extensions.cost` is where Shopify reports
query cost and throttle status.

## Flags and conventions

```text
--profile <name>   -p   Config profile (skips env-derived auth when set)
--local                 Use ./.shopi/config.json
--api-version <ver>     Admin API version (default 2026-04)
--output <fmt>     -o   json | table | markdown
--json --table --markdown   Shortcuts for --output
--pretty                Pretty-print JSON (JSON output only)
--api-debug             HTTP method/URL/status/timing to stderr (never the token)
--dry-run               Preview the generated operation; do not call Shopify
--confirm          -y   Required to execute any mutation/write
--refresh / --no-cache  Re-fetch the schema before building read/write/ops
--full                  Include the full GraphQL response (data+errors+extensions)
```

Parsing notes that occasionally bite: `--key=value` and `--key value` both work;
`--no-<flag>` sets a boolean false; `--` ends flag parsing; underscores in flag
names normalize to hyphens (`--api_version` == `--api-version`). `--arg`,
`--header`, and `--scope` are repeatable.

## Output: pick the format for the consumer

Output is TTY-aware by default — a **table** in an interactive terminal, **JSON**
when piped or in CI. Be explicit when it matters:

- **Agents and scripts:** always pass `--json` (add `--pretty` only when a human
  will read it). Tables/markdown reshape and flatten data and are lossy.
- `table`/`markdown` auto-unwrap a top-level `data` key and GraphQL connections
  (`nodes`/`edges` become rows), and collapse nested objects to their `id`.

## Shopify Admin API essentials (apply to every command)

These are the Admin-API facts that make or break a command:

- **GIDs, not numbers.** Identifiers are global IDs:
  `gid://shopify/Product/1234567890`, `gid://shopify/Order/123`. Most arguments
  and inputs require the GID form.
- **Connections + pagination.** List fields are Relay connections. Page with
  `first`/`after` (or `last`/`before`) and read `pageInfo { hasNextPage
  endCursor }`; loop until `hasNextPage` is false. Page sizes are capped (often
  250).
- **Search syntax.** Many list fields take a `query:` string in Shopify search
  syntax, e.g. `status:active tag:summer`, `financial_status:paid`,
  `created_at:>2026-01-01 updated_at:<now`.
- **userErrors are not exceptions.** Mutations return `userErrors { field
  message }` (or a typed `*UserErrors`). Always select and inspect them.
- **Cost / throttling.** The API is cost-limited. Use `--full` to read
  `extensions.cost` and tune `first` page sizes; back off when throttled.
- **Scale.** For tens of thousands of records, prefer the Bulk Operations API
  (`bulkOperationRunQuery` / `bulkOperationRunMutation`) over deep pagination —
  see the `shopi-bulk-operations` skill.

## Errors and debugging

- Failures print `shopi: <message>` to stderr. Exit code is `1` for most errors,
  `2` for Shopify HTTP 5xx.
- A `200` with a GraphQL `errors` array is raised with the joined messages.
- Set `SHOPI_DEBUG=1` to print the structured (redacted) error `details`.
- Add `--api-debug` to see the HTTP request line and timing on stderr.
- `shopi auth doctor` runs an end-to-end connectivity + auth check.

## Authentication, in one line

The preferred env flow is `SHOPIFY_SHOP` + `SHOPIFY_CLIENT_ID` +
`SHOPIFY_CLIENT_SECRET` (exchanged for a short-lived token at runtime); explicit
`SHOPIFY_ACCESS_TOKEN` and saved profiles (`shopi auth login`) also work. For
setup, scopes, profiles, and troubleshooting, load the **`shopi-auth-and-profiles`**
skill.

## Designing any operation — the reliable recipe

1. **Find the field.** `shopi ops list --kind <query|mutation> --filter <word>`.
2. **Read its contract.** `shopi ops show <field> --kind <kind> --json --pretty`;
   `shopi schema show <InputType> --json --pretty` for input shapes.
3. **Build a preview.** `shopi read|write <field> … --dry-run --json --pretty`.
4. **Run it.** Add `--json`; for writes add `--confirm`. Select and check
   `userErrors`.
5. **Verify.** Re-read the resource (`shopi read <field> --id <gid>`) to confirm
   the change landed.

When the task is domain-specific (catalog, orders, inventory, custom data,
discounts, bulk jobs), load the matching `shopi-*` skill for the exact Admin
fields, inputs, and gotchas — those skills build on this one.
