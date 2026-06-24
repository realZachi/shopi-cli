# shopi

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white)](https://bun.sh)

**A JSON-first command-line interface for the Shopify Admin GraphQL API** — for
store owners, operators, developers, AI agents, and CI jobs.

`shopi` is intentionally a thin layer over Shopify Admin GraphQL. It does not
hide the API behind hand-written wrappers. Instead it reads the *live* schema of
your store and lets you call **any** query or mutation Shopify exposes:

```sh
shopi read products --first 10 --select 'nodes { id title status }'
shopi write productCreate --input @product.json --confirm
shopi gql --query '{ shop { name plan { publicDisplayName } } }'
```

> This project is open source under the MIT license. It is **not** affiliated
> with, endorsed by, or sponsored by Shopify Inc. "Shopify" is a trademark of
> Shopify Inc.

---

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started) ← install + connect in 3 steps
- [Choose your scopes](#choose-your-scopes)
- [First commands](#first-commands)
- [Common workflows](#common-workflows)
- [Output formats](#output-formats)
- [Troubleshooting](#troubleshooting)
- [Command reference](#command-reference)
- [Development](#development)
- [License](#license)

---

## What it does

- Runs **exact** Admin GraphQL documents, with variables from files, flags, or stdin.
- Builds read commands from any `QueryRoot` field (`products`, `orders`, `shop`, …).
- Builds write commands from any `MutationRoot` field (`productCreate`, `metafieldsSet`, …).
- Discovers and inspects every live query/mutation through schema introspection.
- Picks sensible output automatically: **tables** in a terminal, **JSON** in pipes and CI.
- Guards every write behind an explicit `--confirm` flag.

`shopi` can never bypass Shopify access scopes. Each operation only works if your
app was installed with the matching `read_*` / `write_*` scope.

---

## Getting started

### 1. Install

`shopi` runs on [Bun](https://bun.sh) (≥ 1.1).

```sh
bun add -g shopi-cli

shopi version   # → shopi-cli 0.1.0
```

### 2. Create a Shopify app

`shopi` connects with a **Client ID** and **Client secret** from a Dev Dashboard
app that is installed on your store.

1. Open **<https://admin.shopify.com/settings/apps/development>** in your store
   admin and click through to the **Dev Dashboard**.
2. **Create an app** and give it a name (only you see it).
3. Add the **Admin API access scopes** your work needs — e.g. `read_products`,
   `write_products`, `read_orders`. See [Choose your scopes](#choose-your-scopes).
4. **Install the app on your store** and copy the **Client ID** and
   **Client secret** from the app's **Settings**.

> Keep the Client secret like a password — never commit it.

### 3. Connect `shopi`

Create a `.env` file in your working directory with your shop and credentials
(`shopi` reads `.env` automatically; you can also `export` the variables
instead):

```sh
SHOPIFY_SHOP=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
```

That's it — you're connected. `shopi` exchanges your credentials for a
short-lived Admin API token on every run (refreshed automatically), so nothing
sensitive is written to disk. Verify it:

```sh
shopi auth status --validate
```

A successful run prints your shop name, plan, and granted scopes. There's a
ready-made [`.env.example`](.env.example) to copy from.

**Prefer a saved login over a `.env` file?** Store the same credentials in a
named profile with `shopi auth login`:

```sh
shopi auth login \
  --shop your-store.myshopify.com \
  --client-id your-client-id \
  --client-secret your-client-secret \
  --profile production \
  --validate
```

`shopi` still refreshes the token automatically on every run. (If you already
have an Admin API access token, pass `--token shpat_…` instead of
`--client-id`/`--client-secret`.)

Profiles are written to `~/.config/shopi/config.json` (`0600` permissions — it
holds your credentials, so don't commit it). Select one later with
`--profile production`, or scope it to a single repo with `--local`
(`./.shopi/config.json`).

---

## Choose your scopes

Grant the **narrowest** set of scopes that covers your workflow. A read scope can
only run reads; mutations need the matching `write_*` scope. Typical starting
points:

```text
read_products,write_products,read_orders,read_customers,read_inventory,write_inventory
```

<details>
<summary>Broad "manage most of the shop" scope string used against the test store</summary>

```text
read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_customers,write_customers,read_price_rules,write_price_rules,read_discounts,write_discounts,write_draft_orders,read_draft_orders,read_files,write_files,read_fulfillments,write_fulfillments,write_inventory,read_inventory,read_legal_policies,read_locales,write_locales,write_locations,read_locations,write_marketing_events,read_marketing_events,read_markets,write_markets,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_pages,write_order_edits,read_order_edits,read_orders,write_orders,read_products,write_products,read_reports,read_returns,write_returns,read_shipping,write_shipping,read_content,write_content,read_themes,write_themes,read_third_party_fulfillment_orders,write_third_party_fulfillment_orders,read_translations,write_translations
```

</details>

Some scopes require app review, a specific app type, or Shopify Plus. Only add
scopes your app is eligible for — Shopify rejects the rest. After changing
scopes, reinstall/update the app on the store.

---

## First commands

```sh
shopi version
shopi auth status --validate                 # confirm the connection
shopi gql --query '{ shop { name myshopifyDomain } }'
shopi schema pull                            # cache the live Admin schema
shopi ops list --kind query --filter product # discover available operations
shopi ops show productCreate --kind mutation --json --pretty
```

Built-in help is always the source of truth:

```sh
shopi --help
shopi help read
shopi help write
```

---

## Common workflows

### Read from any `QueryRoot` field

`shopi read` loads the live schema, validates the field and its arguments, then
builds the query for you.

```sh
shopi read products --first 10 --select 'nodes { id title handle status }'
shopi read orders   --first 25 --query 'financial_status:paid' --output json
shopi read product  --id gid://shopify/Product/1234567890 --json --pretty
```

Preview the generated GraphQL **without** calling Shopify:

```sh
shopi read products --first 5 --dry-run --json --pretty
```

### Write to any `MutationRoot` field

`shopi write` targets `MutationRoot`. It refuses to run unless you pass
`--confirm`.

```sh
shopi write productCreate \
  --input @examples/product-create.json \
  --select 'product { id title handle } userErrors { field message }' \
  --confirm --json --pretty
```

For mutations with multiple arguments, pass them explicitly:

```sh
shopi write metafieldsSet \
  --arg metafields=@examples/metafields-set.json \
  --select 'metafields { id key namespace value } userErrors { field message }' \
  --confirm
```

**Safety pattern:** dry-run first, then confirm the exact same command.

```sh
shopi write productCreate --input @product.json --dry-run --json --pretty
shopi write productCreate --input @product.json --confirm --json --pretty
```

### Run exact GraphQL

```sh
shopi gql --file examples/shop-info.graphql --json --pretty
shopi gql --file examples/products-list.graphql --variables '{"first": 10}'
shopi gql --file mutation.graphql --variables @variables.json --confirm
```

`--full` includes GraphQL `extensions` (such as query-cost data). Without it,
`shopi` prints only `data`.

### Discover the schema

```sh
shopi ops list --kind mutation --filter metafield   # find operations
shopi ops show orders --kind query --json --pretty  # inspect args & return type
shopi schema show Product --json --pretty           # inspect a type
shopi schema path                                   # where the cache lives
```

The schema is cached under `$XDG_CACHE_HOME/shopi` (or `~/.cache/shopi`). Add
`--refresh` to any read/write/ops command to re-pull it.

---

## Output formats

Interactive terminals default to `table`; pipes and CI default to `json`.
Override explicitly:

```sh
shopi read products --first 10 --output json --pretty
shopi read products --first 10 --output markdown
shopi read products --first 10 --table
```

---

## Troubleshooting

**`shop_not_permitted` / "Client credentials cannot be performed on this shop".**
The app and the store are not in the **same** Dev Dashboard organization. Open
the Dev Dashboard, confirm the store appears under **Stores** in the *same* org
as the app, and that `SHOPIFY_SHOP` matches its `*.myshopify.com` domain exactly.
A store created from the Shopify admin (rather than the Dev Dashboard) is usually
the cause — recreate the dev store from the Dev Dashboard's **Stores** page.

**`401 Unauthorized` / "Invalid API key or access token".** Re-check your
`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` and that the app is installed on the
store. `shopi auth doctor --api-debug` prints HTTP status/timing to stderr (never
the token).

**A write is refused.** Mutations require `--confirm`. Run with `--dry-run` first
to preview the generated GraphQL, then re-run with `--confirm`.

**`Access denied` for a field.** Your app is missing the required scope. Add the
matching `read_*` / `write_*` scope in the Dev Dashboard, **reinstall/update** the
app on the store, then try again.

**See more detail.** `SHOPI_DEBUG=1 shopi …` prints extra error detail;
`--api-debug` prints request diagnostics.

---

## Command reference

Repo documentation:

- [Authentication](docs/AUTHENTICATION.md)
- [Commands](docs/COMMANDS.md)
- [Use cases](docs/USE_CASES.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

You can also read these from the CLI itself:

```sh
shopi docs show auth
shopi docs show commands
shopi docs show use-cases
```

---

## Development

```sh
bun install
bun run check     # typecheck + tests
bun run build     # bundle to dist/shopi
```

The CLI has **no runtime dependencies**. Development uses Bun, TypeScript, and
`bun test`.

---

## License

MIT — see [LICENSE](LICENSE).
