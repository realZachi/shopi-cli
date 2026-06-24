---
name: shopi-products-and-collections
description: >-
  Catalog operations with the shopi CLI (`shopi`) over the Shopify Admin GraphQL
  API: reading and searching products, variants, and collections, and writing
  them. Use whenever the user wants to create a product, update or bulk-update
  variants (price, SKU, inventory policy), change a product's status
  (ACTIVE/DRAFT/ARCHIVED), find products by tag/vendor/type/status, add or
  reorder products in a collection, create or update a collection, attach product
  media, or publish/unpublish a product to a sales channel (Online Store, POS) —
  even when they don't say "shopi" or "GraphQL". Complements the hub skill
  `shopi-cli-usage` (global flags, discovery, output, write safety) and defers to
  `shopi-bulk-operations` for very large catalogs.
---

# shopi: products and collections

This skill covers the product/catalog domain through `shopi read`, `shopi write`,
and `shopi gql`. It assumes the **`shopi-cli-usage`** hub skill for everything
global — discovery (`ops`/`schema`), output formats, GIDs, pagination,
`--dry-run`/`--confirm` write safety, and auth. Load that first; this skill only
adds the catalog-specific fields, mutations, and gotchas.

> **The store's schema is the source of truth.** Admin API shapes drift between
> versions. The field/mutation/input/enum names below were verified against API
> version **2026-04**, but always confirm the exact args for *your* version with
> discovery before a write:
>
> ```sh
> shopi ops show productSet --kind mutation --json --pretty
> shopi schema show ProductSetInput --json --pretty
> ```

## Catalog cheat sheet

| Goal | shopi field / mutation |
| --- | --- |
| List/search products | `shopi read products` (Relay connection, `query:` search) |
| One product | `shopi read product --id gid://shopify/Product/…` |
| List/search variants | `shopi read productVariants` / `shopi read productVariant` |
| Create a product | `shopi write productCreate` |
| Update a product | `shopi write productUpdate` |
| Declarative create-or-update (product + options + variants + media) | `shopi write productSet` |
| Delete a product | `shopi write productDelete` |
| Add variants in bulk | `shopi write productVariantsBulkCreate` |
| Update variants in bulk | `shopi write productVariantsBulkUpdate` |
| Delete variants in bulk | `shopi write productVariantsBulkDelete` |
| Add/update/remove options | `shopi write productOptionsCreate` / `productOptionUpdate` / `productOptionsDelete` |
| Publish to a sales channel | `shopi write publishablePublish` |
| Unpublish from a channel | `shopi write publishableUnpublish` |
| List sales channels | `shopi read publications` |
| List/search collections | `shopi read collections` / `shopi read collection` |
| Create/update a collection | `shopi write collectionCreate` / `collectionUpdate` |
| Add products to a collection | `shopi write collectionAddProductsV2` |
| Reorder products in a collection | `shopi write collectionReorderProducts` |

A longer field/filter/enum reference lives in
[`references/catalog-fields.md`](references/catalog-fields.md).

## Reading products

`products` is a Relay connection: page with `first`/`after` and read
`pageInfo { hasNextPage endCursor }`. `shopi` auto-generates a connection-aware
selection, but pass an explicit `--select` for anything you parse.

```sh
# First page of active products, newest first
shopi read products --first 25 \
  --query 'status:active' \
  --select 'nodes { id title handle status vendor productType tags updatedAt }
            pageInfo { hasNextPage endCursor }' \
  --json --pretty

# Next page: feed back the endCursor
shopi read products --first 25 --query 'status:active' \
  --arg after='eyJsYXN0X2lkIjo…' \
  --select 'nodes { id title } pageInfo { hasNextPage endCursor }' --json
```

### Search syntax (`query:` argument)

Combine terms (implicit AND). Common product filters:

```text
status:active              ProductStatus: active | archived | draft
tag:summer                 has tag "summer"
vendor:Acme                exact vendor
product_type:Shirt         product type
created_at:>2026-01-01     date comparators: > >= < <=
updated_at:<2026-06-01
title:'Blue Tee'           quote multi-word values
gift_card:true             boolean fields
inventory_total:>0
```

The `status:` filter maps to the **`ProductStatus`** enum: `ACTIVE`,
`ARCHIVED`, `DRAFT`. One product:

```sh
shopi read product --id gid://shopify/Product/1234567890 \
  --select 'id title status descriptionHtml
            options { id name optionValues { id name } }
            variants(first: 50) { nodes { id sku price selectedOptions { name value } } }' \
  --json --pretty
```

Variants can also be read directly with their own `query:` (e.g. `sku:`, `product_id:`):

```sh
shopi read productVariants --first 50 --query 'sku:TEE-*' \
  --select 'nodes { id sku price inventoryQuantity product { id title } }' --json
```

## Writing: the two models

Two valid approaches — pick one:

1. **Imperative** — `productCreate` / `productUpdate` for the product, then
   `productVariantsBulkCreate/Update/Delete` and `productOptions*` for variants
   and options. Best for surgical changes (e.g. "bump price on 200 variants").
2. **Declarative** — `productSet` takes a full `ProductSetInput` describing the
   desired product *including* its options, variants, and media, and reconciles
   the store to match. Best for create-or-sync from an external source of truth.
   It can run synchronously or async (`--arg synchronous=true`; otherwise it
   returns a `productSetOperation { id status }` to poll).

Both return `userErrors { field message }` (productSet adds a `code`). **Always
select and check them** — a 200 with non-empty `userErrors` means nothing changed.

### Single-input vs. multi-arg mutations

- Mutations whose only input is one Input-type arg (or an arg literally named
  `input`) take `--input @file.json`: e.g. `productSet(input:)`,
  `productDelete(input:)`, `collectionCreate(input:)`, `collectionUpdate(input:)`.
- For everything else, pass each arg by name with `--arg name=value` /
  `--arg name=@file.json`. `productCreate(product:)`, the bulk variant mutations
  (`productId:` + `variants:`), and the publish mutations are multi-arg, so use
  `--arg`. Confirm arg names with `shopi ops show <mutation> --kind mutation`.

## End-to-end examples

### 1) Create a product (imperative)

`product-create.json`:

```json
{ "title": "Blue Tee", "descriptionHtml": "<p>Soft cotton.</p>",
  "productType": "Shirt", "vendor": "Acme", "status": "DRAFT",
  "tags": ["summer", "cotton"] }
```

```sh
# Preview, then run. productCreate's input arg is `product` (not `input`).
shopi write productCreate --arg product=@product-create.json \
  --select 'product { id title handle status } userErrors { field message }' \
  --dry-run --json --pretty

shopi write productCreate --arg product=@product-create.json \
  --select 'product { id title handle status } userErrors { field message }' \
  --confirm --json --pretty
```

### 2) Create-or-sync a product with options, variants, and media (productSet)

`product-set.json` (a `ProductSetInput`):

```json
{
  "title": "Blue Tee",
  "status": "ACTIVE",
  "productOptions": [
    { "name": "Size", "values": [{ "name": "S" }, { "name": "M" }, { "name": "L" }] }
  ],
  "variants": [
    { "optionValues": [{ "optionName": "Size", "name": "S" }], "price": "19.99", "sku": "TEE-S" },
    { "optionValues": [{ "optionName": "Size", "name": "M" }], "price": "19.99", "sku": "TEE-M" },
    { "optionValues": [{ "optionName": "Size", "name": "L" }], "price": "21.99", "sku": "TEE-L" }
  ],
  "files": [
    { "originalSource": "https://cdn.example.com/blue-tee.jpg", "contentType": "IMAGE" }
  ]
}
```

```sh
shopi write productSet --input @product-set.json \
  --select 'product { id handle status variants(first: 10) { nodes { id sku price } } }
            userErrors { field message code }' \
  --dry-run --json --pretty   # add --confirm to apply
```

> Media note: the modern path attaches images through the product input
> (`productSet`/`productCreate` `files`/`media`) or `productUpdate`. The old
> `productCreateMedia` mutation is **deprecated** in 2026-04 — prefer the input
> approach. Confirm the exact media field with
> `shopi schema show ProductSetInput --json --pretty`.

### 3) Bulk-update variant prices

`variants.json`:

```json
[ { "id": "gid://shopify/ProductVariant/111", "price": "24.99" },
  { "id": "gid://shopify/ProductVariant/222", "price": "24.99" } ]
```

```sh
shopi write productVariantsBulkUpdate \
  --arg productId=gid://shopify/Product/1234567890 \
  --arg variants=@variants.json \
  --select 'productVariants { id price } userErrors { field message }' \
  --dry-run --json --pretty   # add --confirm to apply
```

`productVariantsBulkCreate` is the same shape with new variants
(`--arg variants=@new.json`, each defining `optionValues`); use
`productVariantsBulkDelete` with `--arg variantsIds=@ids.json`. For thousands of
variants across many products, switch to **`shopi-bulk-operations`**.

### 4) Change a product's status

```sh
echo '{"id":"gid://shopify/Product/1234567890","status":"ACTIVE"}' > status.json
shopi write productUpdate --arg product=@status.json \
  --select 'product { id status } userErrors { field message }' \
  --confirm --json
```

### 5) Publish to the Online Store (sales channel)

Publishing is separate from `status`. First list channels, then publish:

```sh
shopi read publications --first 20 --select 'nodes { id }' --json --pretty
# Publication.name is deprecated in 2026-04; discover the title field with:
#   shopi schema show Publication --json --pretty   (e.g. catalog.title / name)

echo '[{"publicationId":"gid://shopify/Publication/123"}]' > pubs.json
shopi write publishablePublish \
  --arg id=gid://shopify/Product/1234567890 \
  --arg input=@pubs.json \
  --select 'publishable { availablePublicationsCount { count } } userErrors { field message }' \
  --confirm --json
```

`publishableUnpublish` takes the same args to remove a product from a channel.
(These also work for other publishable resources like collections.)

### 6) Create a collection and add products

```sh
echo '{"title":"Summer 2026","descriptionHtml":"<p>Warm-weather picks.</p>"}' > coll.json
shopi write collectionCreate --input @coll.json \
  --select 'collection { id title handle } userErrors { field message }' \
  --confirm --json --pretty

echo '["gid://shopify/Product/111","gid://shopify/Product/222"]' > pids.json
shopi write collectionAddProductsV2 \
  --arg id=gid://shopify/Collection/555 \
  --arg productIds=@pids.json \
  --select 'job { id done } userErrors { field message }' \
  --confirm --json
```

`collectionAddProductsV2` returns a `job` — it runs asynchronously; poll the job
or re-read the collection to confirm. Use `collectionUpdate` (input-type arg) to
edit a collection, and `collectionReorderProducts` (`id` + `moves`) to reorder.

## Verify with discovery

Before any write, anchor on the live schema rather than this page:

```sh
shopi ops list --kind mutation --filter product      # discover catalog mutations
shopi ops show productVariantsBulkUpdate --kind mutation --json --pretty
shopi schema show ProductVariantsBulkInput --json --pretty
shopi schema show ProductStatus --json --pretty       # confirm enum values
```

Then preview with `--dry-run`, run with `--confirm`, and re-read the resource
(`shopi read product --id <gid>`) to confirm the change landed. For large
catalogs prefer **`shopi-bulk-operations`**.
