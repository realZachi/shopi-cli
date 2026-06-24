# Commands

## Global flags

```text
--profile <name>       Config profile to use
--local                Use ./.shopi/config.json
--api-version <ver>    Shopify Admin API version
--output <format>      json, table, or markdown
--json                 Shortcut for --output json
--table                Shortcut for --output table
--markdown             Shortcut for --output markdown
--pretty               Pretty-print JSON
--api-debug            Print HTTP request diagnostics to stderr
```

## auth

Preferred environment auth for Dev Dashboard apps:

```sh
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SHOPIFY_CLIENT_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
shopi auth status --validate
```

```sh
shopi auth login --shop <shop> --token <token> [--profile default] [--local] [--validate]
shopi auth status [--validate]
shopi auth profiles
shopi auth doctor
shopi auth logout [--profile default]
```

## gql

Runs an exact Admin GraphQL document.

```sh
shopi gql --query '{ shop { name } }'
shopi gql --file examples/shop-info.graphql
shopi gql --file query.graphql --variables @variables.json
shopi gql --file query.graphql --variables '{"first": 10}' --full
shopi gql --file mutation.graphql --variables @variables.json --confirm
```

## read

Builds a query from any live QueryRoot field.

```sh
shopi read <field> [--arg name=value] [--args '{"name":"value"}'] [--select '<selection>']
```

Examples:

```sh
shopi read products --first 10
shopi read orders --first 25 --query 'financial_status:paid'
shopi read product --id gid://shopify/Product/123
shopi read products --first 5 --dry-run --json --pretty
```

## write

Builds a mutation from any live MutationRoot field. Execution requires
`--confirm`.

```sh
shopi write <mutation> --input @input.json --select '<selection>' --confirm
shopi write <mutation> --arg name=value --confirm
shopi write <mutation> --dry-run --json --pretty
```

## ops

Discovers QueryRoot and MutationRoot fields from the live schema.

```sh
shopi ops list
shopi ops list --kind query --filter product
shopi ops list --kind mutation --filter metafield
shopi ops show productCreate --kind mutation --json --pretty
```

## schema

```sh
shopi schema pull
shopi schema path
shopi schema show Product --json --pretty
```

The schema is cached under `$XDG_CACHE_HOME/shopi` or `~/.cache/shopi`.

## docs

```sh
shopi docs show auth
shopi docs show commands
shopi docs show use-cases
```
