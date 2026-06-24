# shopi-cli

`shopi` is a JSON-first Shopify Admin GraphQL CLI for store owners, operators,
developers, agents, and CI jobs. It is intentionally thin over Shopify Admin
GraphQL: exact GraphQL documents are supported, and every live QueryRoot and
MutationRoot field can be discovered and addressed through schema introspection.

This project is open source under the MIT license and is not affiliated with,
endorsed by, or sponsored by Shopify Inc. Shopify is a trademark of Shopify Inc.

## What it does

- Stores local or global Shopify Admin API profiles.
- Runs exact Admin GraphQL documents with variables from JSON files or stdin.
- Lists and inspects all live Admin GraphQL query and mutation entry points.
- Builds read commands from QueryRoot fields, for example `products` or `orders`.
- Builds write commands from MutationRoot fields, for example `productCreate` or
  `metafieldsSet`.
- Uses TTY-aware output: tables in terminals, JSON in scripts and pipes.
- Supports `json`, `table`, and `markdown` output explicitly.
- Keeps write operations guarded with `--confirm`.

`shopi` cannot bypass Shopify access scopes. Your Admin API access token must
have the read or write scopes required by the operation you run.

## Install

```sh
bun add -g shopi-cli
```

For local development from this repository:

```sh
bun install
bun run shopi --help
```

You can also run the binary directly:

```sh
./src/cli.ts --help
```

## Authentication

Create a custom app in your Shopify admin, enable Admin API scopes, install the
app, and copy the Admin API access token. Then save a profile:

```sh
shopi auth login \
  --shop your-store.myshopify.com \
  --token shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --profile production \
  --validate
```

Use a local repo-scoped profile when you do not want global machine config:

```sh
shopi auth login --local --shop your-store --token shpat_xxx
```

For CI and agents, environment variables work without writing config:

```sh
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHOPIFY_API_VERSION=2026-04
shopi auth status --validate --output json
```

## First commands

```sh
shopi version
shopi auth status --validate
shopi gql --query '{ shop { name myshopifyDomain } }'
shopi schema pull
shopi ops list --kind query --filter product
shopi ops show productCreate --kind mutation --output json --pretty
```

## Read from any QueryRoot field

`shopi read` loads the live Admin schema, validates the root field and
arguments, then builds a GraphQL query.

```sh
shopi read products --first 10 --select 'nodes { id title handle status }'
shopi read orders --first 25 --query 'financial_status:paid' --output json
shopi read product --id gid://shopify/Product/1234567890 --json --pretty
```

Preview the generated operation without calling Shopify:

```sh
shopi read products --first 5 --dry-run --json --pretty
```

## Write to any MutationRoot field

`shopi write` uses the same live schema but targets MutationRoot. It refuses to
execute unless you pass `--confirm`.

```sh
shopi write productCreate \
  --input @examples/product-create.json \
  --select 'product { id title handle } userErrors { field message }' \
  --confirm \
  --json --pretty
```

For mutations with multiple arguments, pass them explicitly:

```sh
shopi write metafieldsSet \
  --arg metafields=@examples/metafields-set.json \
  --select 'metafields { id key namespace value } userErrors { field message }' \
  --confirm
```

## Run exact GraphQL

```sh
shopi gql --file examples/shop-info.graphql --json --pretty
shopi gql --file examples/products-list.graphql --variables '{"first": 10}'
shopi gql --file examples/product-create.graphql --variables '{"product":{"title":"Example"}}' --confirm
shopi gql --file mutation.graphql --variables @variables.json --full
```

`--full` includes GraphQL extensions such as cost data. Without it, `shopi`
prints only `data`.

## Output

Interactive terminals default to `table`. Pipes and CI default to `json`.
Override with:

```sh
shopi read products --first 10 --output json --pretty
shopi read products --first 10 --output markdown
shopi read products --first 10 --table
```

## Command reference

Use built-in help as the source of truth:

```sh
shopi --help
shopi help auth
shopi help gql
shopi help read
shopi help write
```

Repo documentation:

- [Authentication](docs/AUTHENTICATION.md)
- [Commands](docs/COMMANDS.md)
- [Use cases](docs/USE_CASES.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Development

```sh
bun install
bun run check
bun run build
```

The project has no runtime dependencies. Development uses Bun, TypeScript, and
`bun test`.

## License

MIT. See [LICENSE](LICENSE).
