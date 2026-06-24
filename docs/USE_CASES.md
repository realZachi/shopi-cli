# Use cases

## Agent inventory readout

```sh
shopi read products \
  --first 50 \
  --select 'nodes { id title handle status totalInventory updatedAt } pageInfo { hasNextPage endCursor }' \
  --json --pretty
```

## Bulk product search

```sh
shopi read products \
  --first 25 \
  --query 'status:active tag:summer' \
  --select 'nodes { id title handle tags } pageInfo { hasNextPage endCursor }'
```

## Create a product from JSON

```sh
shopi write productCreate \
  --input @examples/product-create.json \
  --select 'product { id title handle status } userErrors { field message }' \
  --confirm \
  --json --pretty
```

## Update metafields

```sh
shopi write metafieldsSet \
  --arg metafields=@examples/metafields-set.json \
  --select 'metafields { id namespace key value } userErrors { field message }' \
  --confirm
```

## Raw GraphQL for precise workflows

```sh
shopi gql --file examples/products-list.graphql --variables '{"first": 10}' --full
shopi gql --file examples/product-create.graphql --variables '{"product":{"title":"Example"}}' --confirm
```

Use raw GraphQL when you need complete control over nested selections,
fragments, aliases, or multiple root fields in one request.

## CI smoke test

```sh
shopi auth status --validate --output json
shopi read shopLocales --output json
shopi ops list --kind mutation --filter product --output json
```

## Safety pattern for writes

```sh
shopi write productCreate --input @product.json --dry-run --json --pretty
shopi write productCreate --input @product.json --confirm --json --pretty
```

Run the dry run first in pull requests or agent plans, then execute the same
command with `--confirm` only after review.
