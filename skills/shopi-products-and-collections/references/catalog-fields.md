# Catalog field / filter / mutation reference

Verified against Shopify Admin API **2026-04**. Names drift between versions —
confirm with `shopi ops show <name>` and `shopi schema show <Type>` for your
target version. This is a quick lookup, not a replacement for discovery.

## Query (read) fields

| Field | Args (highlights) | Notes |
| --- | --- | --- |
| `products` | `first`/`after`/`last`/`before`, `query`, `sortKey`, `reverse` | Relay connection. `sortKey` e.g. `TITLE`, `UPDATED_AT`, `CREATED_AT`, `INVENTORY_TOTAL`, `PRICE`, `VENDOR`, `PRODUCT_TYPE`. |
| `product` | `id` (GID) or `handle` | Single product. |
| `productVariants` | `first`/`after`, `query`, `sortKey` | Connection of variants across products. |
| `productVariant` | `id` (GID) | Single variant. |
| `collections` | `first`/`after`, `query`, `sortKey` | Relay connection. |
| `collection` | `id` (GID) or `handle` | Single collection; has `products(first:)` connection. |
| `publications` | `first`/`after` | Sales channels / catalogs the app can publish to. |

## Product search-query (`query:`) terms

```text
status:active | archived | draft     product status
title:'Blue Tee'                     title (quote multi-word)
handle:blue-tee                      URL handle
vendor:Acme                          vendor
product_type:Shirt                   product type
tag:summer        tag_not:clearance  tag membership
created_at:>2026-01-01               date comparators > >= < <=
updated_at:<2026-06-01
published_status:published|unpublished
gift_card:true                       booleans
inventory_total:>0                   numeric comparators
sku:TEE-*                            wildcard (variant SKU)
collection_id:555                    membership by collection
```

Variant `query:` terms include `sku:`, `product_id:`, `inventory_quantity:`,
`barcode:`, `taxable:`. Collection `query:` terms include `title:`,
`collection_type:custom|smart`, `published_status:`, `updated_at:`.

## ProductStatus enum

`ACTIVE` — visible/buyable (subject to publishing). `DRAFT` — hidden, work in
progress. `ARCHIVED` — hidden, retained for records. Status is independent of
**publishing** to a sales channel (see `publishablePublish`).

## Mutations

| Mutation | Input arg(s) | shopi pattern |
| --- | --- | --- |
| `productCreate` | `product: ProductCreateInput!`, optional `media: [CreateMediaInput!]` | `--arg product=@p.json` (multi-arg) |
| `productUpdate` | `product: ProductUpdateInput!`, optional `media` | `--arg product=@p.json` |
| `productSet` | `input: ProductSetInput!`, `synchronous: Boolean` | `--input @set.json` (+ `--arg synchronous=true`) |
| `productDelete` | `input: ProductDeleteInput!` | `--input @del.json` |
| `productVariantsBulkCreate` | `productId: ID!`, `variants: [ProductVariantsBulkInput!]!`, `strategy` | `--arg productId=… --arg variants=@v.json` |
| `productVariantsBulkUpdate` | `productId: ID!`, `variants: [ProductVariantsBulkInput!]!` | `--arg productId=… --arg variants=@v.json` |
| `productVariantsBulkDelete` | `productId: ID!`, `variantsIds: [ID!]!` | `--arg productId=… --arg variantsIds=@ids.json` |
| `productOptionsCreate` | `productId: ID!`, `options: [OptionCreateInput!]!` | `--arg productId=… --arg options=@o.json` |
| `productOptionUpdate` | `productId: ID!`, `option: OptionUpdateInput!`, `optionValuesToAdd`, `variantStrategy` | `--arg …` per arg |
| `productOptionsDelete` | `productId: ID!`, `options: [ID!]!`, `strategy` | `--arg …` per arg |
| `publishablePublish` | `id: ID!`, `input: [PublicationInput!]!` | `--arg id=… --arg input=@pubs.json` |
| `publishableUnpublish` | `id: ID!`, `input: [PublicationInput!]!` | `--arg id=… --arg input=@pubs.json` |
| `collectionCreate` | `input: CollectionInput!` | `--input @c.json` |
| `collectionUpdate` | `input: CollectionInput!` | `--input @c.json` |
| `collectionAddProductsV2` | `id: ID!`, `productIds: [ID!]!` | `--arg id=… --arg productIds=@ids.json` (returns `job`) |
| `collectionReorderProducts` | `id: ID!`, `moves: [MoveInput!]!` | `--arg id=… --arg moves=@m.json` (returns `job`) |

### userErrors

All mutations above return `userErrors { field message }`; `productSet` and the
`productOption*` mutations also expose a `code`. The media-specific mutations
(now deprecated) used `mediaUserErrors`. Always select the error field and treat
a non-empty array as a failed write.

## Variants-via-options model

A product's variants are the cross-product of its **options** and their
**option values**. To add a variant you generally ensure the option values exist
(via `productOptionUpdate` `optionValuesToAdd`, or declaratively in
`productSet`), then create the variant referencing those values
(`optionValues: [{ optionName, name }]`). `productVariantsBulkCreate` with a
`strategy` controls how new option values are reconciled. Discover the exact
input with `shopi schema show ProductVariantsBulkInput --json --pretty` and
`shopi schema show OptionUpdateInput --json --pretty`.

## Media

`productCreateMedia` is **deprecated** in 2026-04 (use `productUpdate` /
`productSet`). Two distinct shapes exist — mind the field name, they are not
interchangeable:

- `ProductSetInput.files: [FileSetInput!]` uses **`contentType`**, e.g.
  `{ originalSource, contentType: IMAGE | VIDEO | EXTERNAL_VIDEO | MODEL_3D }`.
- The optional `media: [CreateMediaInput!]` arg on `productCreate`/`productUpdate`
  uses **`mediaContentType`**, e.g.
  `{ originalSource, mediaContentType: IMAGE | VIDEO | EXTERNAL_VIDEO | MODEL_3D }`.

Confirm the exact field name and shape for your version with
`shopi schema show ProductSetInput --json --pretty` and
`shopi schema show CreateMediaInput --json --pretty`.
