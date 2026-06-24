---
name: shopi-discounts-and-pricing
description: >-
  Discount and pricing operations with the shopi CLI (`shopi`) over the Shopify
  Admin GraphQL API. Use whenever the user wants to create a discount code,
  percentage off or amount off, buy one get one (BXGY), a free shipping discount,
  an automatic discount, bulk-generate redeem codes, read or list existing
  discounts and their usage, activate/deactivate/delete a discount, or set up a
  B2B price list or market pricing — even when they don't say "shopi" or
  "GraphQL". Triggers on "create a discount code", "percentage off", "buy one get
  one", "free shipping discount", "automatic discount", "deactivate a discount",
  "bulk discount codes", "B2B price list", "market pricing". Complements the hub
  skill `shopi-cli-usage` (global flags, discovery, output, write safety); the
  CLI itself is fully specified there.
---

# shopi: discounts and pricing

This skill covers the modern **discount** and **pricing** domain through
`shopi read`, `shopi write`, and `shopi gql`. It assumes the
**`shopi-cli-usage`** hub skill for everything global — discovery
(`ops`/`schema`), output formats, GIDs, pagination, `--dry-run`/`--confirm`
write safety, and auth. Load that first; this skill only adds the
discount/pricing fields, mutations, and gotchas.

> **The store's schema is the source of truth.** Admin API shapes drift between
> versions. The field/mutation/input/enum names below were verified against API
> version **2026-04**, but always confirm exact args for *your* version with
> discovery before a write:
>
> ```sh
> shopi ops show discountCodeBasicCreate --kind mutation --json --pretty
> shopi schema show DiscountCodeBasicInput --json --pretty
> ```

Discounts need `read_discounts` / `write_discounts`. Price lists are products
data (`read_products` / `write_products`); markets need `read_markets` /
`write_markets`. **B2B price lists and most market features require Shopify Plus**
(B2B / multiple markets are edition-gated) — expect scope or feature errors on
non-Plus stores, returned as GraphQL/HTTP errors, not silent no-ops.

## The modern discount model

A discount lives inside a **node** wrapper, and the concrete discount is reached
through a union/interface:

- **`DiscountCodeNode`** — a code discount (customer types a code at checkout).
  Its `codeDiscount` field is the union **`DiscountCode`** =
  `DiscountCodeBasic | DiscountCodeBxgy | DiscountCodeFreeShipping |
  DiscountCodeApp`.
- **`DiscountAutomaticNode`** — an automatic discount (applied with no code).
  Its `automaticDiscount` field is the union **`DiscountAutomatic`** =
  `DiscountAutomaticBasic | DiscountAutomaticBxgy |
  DiscountAutomaticFreeShipping | DiscountAutomaticApp`.
- **`DiscountNode`** — the unified wrapper. Its `discount` field is the
  interface/union **`Discount`** covering *all* of the above. This is the one to
  prefer.

So you always select `__typename` and use inline fragments
(`... on DiscountCodeBasic { … }`) to read the concrete type.

> **Use `discountNodes`, not `codeDiscountNodes`/`automaticDiscountNodes`.** In
> 2026-04 the two split list queries are **deprecated** in favor of the unified
> **`discountNodes`** (and **`discountNode`** by id). The per-type
> `codeDiscountNode` / `automaticDiscountNode` (single, by id) and
> `codeDiscountNodeByCode(code:)` still exist. Confirm with
> `shopi ops list --kind query --filter discount`.

## Cheat sheet

| Goal | shopi field / mutation |
| --- | --- |
| List all discounts (unified) | `shopi read discountNodes` (Relay connection) |
| One discount by id | `shopi read discountNode --id gid://shopify/DiscountNode/…` |
| One code discount by id | `shopi read codeDiscountNode --id gid://shopify/DiscountCodeNode/…` |
| Look up a code by string | `shopi read codeDiscountNodeByCode --code SUMMER20` |
| Amount/percentage off code | `shopi write discountCodeBasicCreate` |
| Buy X get Y code | `shopi write discountCodeBxgyCreate` |
| Free shipping code | `shopi write discountCodeFreeShippingCreate` |
| Amount/percentage off automatic | `shopi write discountAutomaticBasicCreate` |
| Buy X get Y automatic | `shopi write discountAutomaticBxgyCreate` |
| Free shipping automatic | `shopi write discountAutomaticFreeShippingCreate` |
| Update a code discount | `shopi write discountCodeBasicUpdate` (and `…BxgyUpdate`, `…FreeShippingUpdate`) |
| Update an automatic discount | `shopi write discountAutomaticBasicUpdate` (and Bxgy/FreeShipping variants) |
| Activate / deactivate a code | `shopi write discountCodeActivate` / `discountCodeDeactivate` |
| Activate / deactivate automatic | `shopi write discountAutomaticActivate` / `discountAutomaticDeactivate` |
| Delete a code / automatic | `shopi write discountCodeDelete` / `discountAutomaticDelete` |
| Bulk-add redeem codes (async) | `shopi write discountRedeemCodeBulkAdd` |
| B2B / market price list | `shopi read priceLists` / `shopi read priceList` |
| Create / update a price list | `shopi write priceListCreate` / `priceListUpdate` |
| Set fixed prices on a list | `shopi write priceListFixedPricesAdd` (and `…Update`) |
| List markets | `shopi read markets` / `shopi read market` |

A fuller input-shape reference (input objects, `customerGets`/`customerBuys`,
`combinesWith`, value types, price-list inputs) lives in
[`references/discount-and-pricing-inputs.md`](references/discount-and-pricing-inputs.md).

## Reading discounts

`discountNodes` is a Relay connection — page with `first`/`after` and read
`pageInfo { hasNextPage endCursor }`. Because the discount is a union, select
`__typename` and inline-fragment each concrete type:

```sh
shopi read discountNodes --first 25 \
  --select 'nodes { id
              discount {
                __typename
                ... on DiscountCodeBasic { title status startsAt endsAt
                                           asyncUsageCount usageLimit
                                           codes(first: 5) { nodes { code } } }
                ... on DiscountAutomaticBasic { title status startsAt endsAt } } }
            pageInfo { hasNextPage endCursor }' \
  --json --pretty
```

Key read fields: `status` (`ACTIVE` / `EXPIRED` / `SCHEDULED`),
`asyncUsageCount` (times used so far), `usageLimit`, and `codes { nodes { code } }`
for a code discount's redeem codes. Look up a single shared code by its string:

```sh
shopi read codeDiscountNodeByCode --code SUMMER20 \
  --select 'id codeDiscount { __typename
              ... on DiscountCodeBasic { title status asyncUsageCount } }' \
  --json --pretty
```

## Writing: GIDs, dry-run, typed userErrors

Discount mutations return a **typed `DiscountUserErrors`** (fields
`field message code`) — *not* the generic `userErrors`. **Always select and check
it**: a 200 with non-empty errors means nothing changed. Preview with
`--dry-run`, then re-run with `--confirm`. Use GIDs everywhere
(`gid://shopify/DiscountNode/…`, `gid://shopify/DiscountCodeNode/…`,
`gid://shopify/DiscountAutomaticNode/…`).

Argument shapes (confirm with `shopi ops show <mutation> --kind mutation`):

- **Create mutations take one named input arg** (not `input`), so `--input @file`
  still targets it: `discountCodeBasicCreate(basicCodeDiscount:)`,
  `discountCodeBxgyCreate(bxgyCodeDiscount:)`,
  `discountCodeFreeShippingCreate(freeShippingCodeDiscount:)`,
  `discountAutomaticBasicCreate(automaticBasicDiscount:)`,
  `discountAutomaticBxgyCreate(automaticBxgyDiscount:)`,
  `discountAutomaticFreeShippingCreate(freeShippingAutomaticDiscount:)`.
- **Update mutations are multi-arg** (`id` + the same input) → one `--arg` each.
- **Activate/deactivate/delete take a single `id`** → `--arg id=…`.
  Their create/update payload return is the matching `*DiscountNode`; delete
  returns `deletedCodeDiscountId` / `deletedAutomaticDiscountId`.

> Codes vs. the discount: a **code discount** can carry one or many **redeem
> codes**. A basic create with a single `code` makes one shared code. To attach
> many unique codes (e.g. one-per-customer), create the discount, then call
> `discountRedeemCodeBulkAdd(discountId:, codes:)` — it runs **asynchronously**
> (max 250 codes/call) and returns a `bulkCreation { id done codesCount }` you
> poll separately. See the reference.

## End-to-end examples

### 1) Create a percentage-off code discount

`basic.json` (a `DiscountCodeBasicInput` — see the reference for the full shape):

```json
{
  "title": "Summer 20% off",
  "code": "SUMMER20",
  "startsAt": "2026-06-01T00:00:00Z",
  "customerSelection": { "all": true },
  "customerGets": {
    "value": { "percentage": 0.2 },
    "items": { "all": true }
  },
  "appliesOncePerCustomer": true,
  "usageLimit": 1000,
  "combinesWith": { "orderDiscounts": false, "productDiscounts": true, "shippingDiscounts": true }
}
```

```sh
shopi write discountCodeBasicCreate --input @basic.json \
  --select 'codeDiscountNode { id
              codeDiscount { ... on DiscountCodeBasic { title status } } }
            userErrors { field message code }' \
  --dry-run --json --pretty        # add --confirm to create
```

For a fixed amount off instead of a percentage, swap the value to
`"value": { "discountAmount": { "amount": "10.00", "appliesOnEachItem": false } }`.
Scope to specific products/collections with
`"items": { "products": { "productsToAdd": ["gid://shopify/Product/…"] } }`.

> **`customerSelection` vs `context`:** in 2026-04 `DiscountCodeBasicInput.context`
> exists and `customerSelection` is marked deprecated (still works). Check what
> *your* version wants: `shopi schema show DiscountCodeBasicInput --json --pretty`.

### 2) Create an automatic amount-off discount

Automatic discounts have **no code** and no customer-selection — they apply to
everyone whose cart matches. `auto.json` (a `DiscountAutomaticBasicInput`):

```json
{
  "title": "Spend more, save $15",
  "startsAt": "2026-06-01T00:00:00Z",
  "minimumRequirement": { "subtotal": { "greaterThanOrEqualToSubtotal": "100.00" } },
  "customerGets": {
    "value": { "discountAmount": { "amount": "15.00", "appliesOnEachItem": false } },
    "items": { "all": true }
  }
}
```

```sh
shopi write discountAutomaticBasicCreate --input @auto.json \
  --select 'automaticDiscountNode { id
              automaticDiscount { ... on DiscountAutomaticBasic { title status } } }
            userErrors { field message code }' \
  --dry-run --json --pretty        # add --confirm
```

### 3) Buy X get Y (BXGY)

`customerBuys` defines the trigger, `customerGets` the reward. Use
`discountCodeBxgyCreate` (code) or `discountAutomaticBxgyCreate` (automatic).

`bxgy.json` outline — `customerBuys.value` is `{ "quantity": "2" }`,
`customerGets.value` is `{ "discountOnQuantity": { "quantity": "1", "effect":
{ "percentage": 1.0 } } }`, each with an `items` block (see the reference for the
full `DiscountCodeBxgyInput`):

```sh
shopi write discountCodeBxgyCreate --input @bxgy.json \
  --select 'codeDiscountNode { id } userErrors { field message code }' \
  --dry-run --json --pretty        # discountAutomaticBxgyCreate for automatic
```

### 4) Free shipping discount

```sh
shopi write discountCodeFreeShippingCreate --input @ship.json \
  --select 'codeDiscountNode { id } userErrors { field message code }' \
  --dry-run --json --pretty        # discountAutomaticFreeShippingCreate for automatic
```

`ship.json` (`DiscountCodeFreeShippingInput`): `title`, `code`, `startsAt`,
`customerSelection`, and a `destination` (e.g. `{ "all": true }`); optionally a
`minimumRequirement`. Inspect with `shopi schema show DiscountCodeFreeShippingInput`.

### 5) Activate, deactivate, delete

```sh
shopi write discountCodeActivate   --arg id=gid://shopify/DiscountCodeNode/123 \
  --select 'codeDiscountNode { id } userErrors { field message code }' --confirm --json
shopi write discountCodeDeactivate --arg id=gid://shopify/DiscountCodeNode/123 \
  --select 'codeDiscountNode { id } userErrors { field message code }' --confirm --json
shopi write discountCodeDelete     --arg id=gid://shopify/DiscountCodeNode/123 \
  --select 'deletedCodeDiscountId userErrors { field message code }' --confirm --json
```

Automatic equivalents: `discountAutomaticActivate` / `discountAutomaticDeactivate`
/ `discountAutomaticDelete` (payload field `deletedAutomaticDiscountId`).

### 6) Bulk-add unique redeem codes (async)

Create the parent code discount first, then attach unique codes to it:

```sh
shopi write discountRedeemCodeBulkAdd \
  --arg discountId=gid://shopify/DiscountCodeNode/123 \
  --arg codes='[{"code":"VIP-0001"},{"code":"VIP-0002"},{"code":"VIP-0003"}]' \
  --select 'bulkCreation { id done codesCount } userErrors { field message code }' \
  --dry-run --json --pretty        # add --confirm
```

It returns a `DiscountRedeemCodeBulkCreation` job (max 250 codes/call); poll its
status separately. Read existing codes with the `codes(first:)` connection on the
code discount (example 1 above).

### 7) Update a discount

`discountCodeBasicUpdate` is multi-arg (`id` + `basicCodeDiscount`), and the input
is a *partial* — send only the fields you want to change:

```sh
shopi write discountCodeBasicUpdate \
  --arg id=gid://shopify/DiscountCodeNode/123 \
  --arg basicCodeDiscount='{"usageLimit":500,"endsAt":"2026-09-01T00:00:00Z"}' \
  --select 'codeDiscountNode { id } userErrors { field message code }' \
  --dry-run --json --pretty        # add --confirm
```

### 8) B2B / market price list (Shopify Plus)

Price lists override variant prices for a market or B2B catalog. Read first, then
set fixed prices (concise here — these inputs are large and edition-gated, so
**anchor on discovery**):

```sh
shopi read priceLists --first 10 --select 'nodes { id name currency }' --json --pretty
shopi read markets    --first 10 --select 'nodes { id name handle enabled }' --json --pretty

# Set fixed prices on a list (PriceListPriceInput[] — see reference / schema show)
shopi write priceListFixedPricesAdd \
  --arg priceListId=gid://shopify/PriceList/1 \
  --arg prices='[{"variantId":"gid://shopify/ProductVariant/999",
                  "price":{"amount":"79.00","currencyCode":"USD"}}]' \
  --select 'prices { price { amount currencyCode } } userErrors { field message code }' \
  --dry-run --json --pretty        # add --confirm
```

Create/update a list with `priceListCreate(input:)` / `priceListUpdate(id, input:)`
(single `input`). Markets are read-mostly here; for market setup confirm the
exact mutations with discovery, as they vary by edition.

## Legacy: `priceRule*`

The older **`priceRule*`** family (`priceRuleCreate`, `priceRuleDiscountCodeCreate`,
…) still exists but is the legacy path. **Prefer the `discount*` Node API above** —
it is the current, fully featured model. Only touch `priceRule*` for maintaining
pre-existing rules, and confirm fields with `shopi ops show priceRuleCreate
--kind mutation` if you must.

## Verify with discovery

Before any write, anchor on the live schema rather than this page:

```sh
shopi ops list --kind query    --filter discount     # discountNodes, codeDiscountNodeByCode, …
shopi ops list --kind mutation --filter discount      # all discount* mutations
shopi ops show discountCodeBasicCreate --kind mutation --json --pretty
shopi schema show DiscountCodeBasicInput --json --pretty
shopi schema show DiscountCustomerGetsInput --json --pretty
shopi schema show DiscountCode --json --pretty         # union members
shopi schema show PriceListPriceInput --json --pretty
```

Then preview with `--dry-run`, run with `--confirm`, and re-read the resource
(`shopi read discountNode --id <gid>`) to confirm the change landed and check
`status` / `asyncUsageCount`.
