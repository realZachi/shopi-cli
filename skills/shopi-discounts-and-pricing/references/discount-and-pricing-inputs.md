# Discount & pricing input reference

Companion to `shopi-discounts-and-pricing`. Verified against Shopify Admin API
**2026-04**. Shapes drift between versions — always confirm with
`shopi schema show <InputType> --json --pretty` before a write. This file is a
map, not a substitute for discovery.

## Queries (read)

| Query | Args | Returns | Notes |
| --- | --- | --- | --- |
| `discountNodes` | `first/after/last/before`, `query`, `sortKey`, `reverse` | `DiscountNodeConnection` | **Preferred** unified list (code + automatic). |
| `discountNode` | `id: ID!` | `DiscountNode` | `discount` is the `Discount` union/interface. |
| `codeDiscountNode` | `id: ID!` | `DiscountCodeNode` | `codeDiscount` is the `DiscountCode` union. |
| `codeDiscountNodeByCode` | `code: String!` | `DiscountCodeNode` | Look up by the code string. |
| `automaticDiscountNode` | `id: ID!` | `DiscountAutomaticNode` | `automaticDiscount` is the `DiscountAutomatic` union. |
| `codeDiscountNodes` | connection args | deprecated | Use `discountNodes`. |
| `automaticDiscountNodes` | connection args | deprecated | Use `discountNodes`. |

`query:` search supports fields like `status:active`, `times_used:>0`,
`starts_at:>2026-01-01`, `discount_type:`. Confirm with `shopi schema show`.

### The discount unions

```graphql
union DiscountCode = DiscountCodeBasic | DiscountCodeBxgy
                   | DiscountCodeFreeShipping | DiscountCodeApp
union DiscountAutomatic = DiscountAutomaticBasic | DiscountAutomaticBxgy
                        | DiscountAutomaticFreeShipping | DiscountAutomaticApp
```

`DiscountNode.discount` is the `Discount` type covering all eight. Always select
`__typename` and inline-fragment the concrete types you care about.

Common read fields on a concrete discount: `title`, `status`
(`ACTIVE`/`EXPIRED`/`SCHEDULED`), `startsAt`, `endsAt`, `summary`,
`asyncUsageCount`, `usageLimit`, `appliesOncePerCustomer`,
`combinesWith { orderDiscounts productDiscounts shippingDiscounts }`. Code
discounts also expose `codes(first:) { nodes { id code asyncUsageCount } }`.

## Mutations (write)

| Mutation | Input arg(s) | Payload node | Payload errors |
| --- | --- | --- | --- |
| `discountCodeBasicCreate` | `basicCodeDiscount: DiscountCodeBasicInput!` | `codeDiscountNode` | `userErrors: [DiscountUserError!]!` |
| `discountCodeBxgyCreate` | `bxgyCodeDiscount: DiscountCodeBxgyInput!` | `codeDiscountNode` | `[DiscountUserError!]!` |
| `discountCodeFreeShippingCreate` | `freeShippingCodeDiscount: DiscountCodeFreeShippingInput!` | `codeDiscountNode` | `[DiscountUserError!]!` |
| `discountAutomaticBasicCreate` | `automaticBasicDiscount: DiscountAutomaticBasicInput!` | `automaticDiscountNode` | `[DiscountUserError!]!` |
| `discountAutomaticBxgyCreate` | `automaticBxgyDiscount: DiscountAutomaticBxgyInput!` | `automaticDiscountNode` | `[DiscountUserError!]!` |
| `discountAutomaticFreeShippingCreate` | `freeShippingAutomaticDiscount: DiscountAutomaticFreeShippingInput!` | `automaticDiscountNode` | `[DiscountUserError!]!` |
| `discountCodeBasicUpdate` | `id: ID!`, `basicCodeDiscount: DiscountCodeBasicInput!` | `codeDiscountNode` | `[DiscountUserError!]!` |
| `discountAutomaticBasicUpdate` | `id: ID!`, `automaticBasicDiscount: DiscountAutomaticBasicInput!` | `automaticDiscountNode` | `[DiscountUserError!]!` |
| `discountCodeActivate` / `discountCodeDeactivate` | `id: ID!` | `codeDiscountNode` | `[DiscountUserError!]!` |
| `discountAutomaticActivate` / `discountAutomaticDeactivate` | `id: ID!` | `automaticDiscountNode` | `[DiscountUserError!]!` |
| `discountCodeDelete` | `id: ID!` | `deletedCodeDiscountId` | `[DiscountUserError!]!` |
| `discountAutomaticDelete` | `id: ID!` | `deletedAutomaticDiscountId` | `[DiscountUserError!]!` |
| `discountRedeemCodeBulkAdd` | `discountId: ID!`, `codes: [DiscountRedeemCodeInput!]!` | `bulkCreation` | `[DiscountUserError!]!` |

There are also `…BxgyUpdate` and `…FreeShippingUpdate` variants for both code and
automatic discounts. **The errors field is the typed `DiscountUserError`** (with
`code field message`), not the generic `userErrors` — select and check it.

## `DiscountCodeBasicInput` (create/update an amount/percentage off code)

Required on create: `title`, `code`, `startsAt`, `customerGets`, and customer
targeting (`context`, or the deprecated `customerSelection`). On **update**, send
only the fields you want to change.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | `String` | Internal name (not shown to customers). |
| `code` | `String` | The single shared code. Add more via `discountRedeemCodeBulkAdd`. |
| `startsAt` / `endsAt` | `DateTime` | `endsAt` null = no expiry. |
| `customerSelection` | `DiscountCustomerSelectionInput` | Who can use it. **Deprecated in 2026-04 in favor of `context`** — check `shopi schema show DiscountCodeBasicInput`. |
| `context` | `DiscountContextInput` | Newer targeting (markets/customers). Verify shape with `schema show`. |
| `customerGets` | `DiscountCustomerGetsInput` | The reward (value + items). |
| `appliesOncePerCustomer` | `Boolean` | One use per customer. |
| `usageLimit` | `Int` | Total redemptions allowed. |
| `recurringCycleLimit` | `Int` | For subscriptions. |
| `combinesWith` | `DiscountCombinesWithInput` | `{ orderDiscounts, productDiscounts, shippingDiscounts }`. |
| `minimumRequirement` | `DiscountMinimumRequirementInput` | `subtotal` or `quantity` threshold. |

`DiscountAutomaticBasicInput` is the same minus `code`, `customerSelection`,
`appliesOncePerCustomer`, and `usageLimit` (automatic discounts have no code and
apply to all matching carts).

## `DiscountCustomerSelectionInput`

One of:

- `{ "all": true }` — all customers.
- `{ "customers": { "add": ["gid://shopify/Customer/…"], "remove": [...] } }`
- `{ "customerSegments": { "add": ["gid://shopify/Segment/…"] } }`

## `DiscountCustomerGetsInput`

```jsonc
{
  "value": {
    // exactly ONE of:
    "percentage": 0.2,                                  // 20% (0.0–1.0)
    "discountAmount": { "amount": "10.00", "appliesOnEachItem": false },
    "discountOnQuantity": { "quantity": "1", "effect": { "percentage": 1.0 } } // BXGY reward
  },
  "items": {
    // exactly ONE of:
    "all": true,
    "products": { "productsToAdd": ["gid://shopify/Product/…"],
                  "productVariantsToAdd": ["gid://shopify/ProductVariant/…"] },
    "collections": { "add": ["gid://shopify/Collection/…"] }
  }
}
```

(`DiscountCustomerBuysInput` for BXGY mirrors this: a `value`
(`{ "quantity": "2" }` or `{ "amount": "50.00" }`) plus the same `items` shape.)

## `DiscountCodeBxgyInput` / `DiscountAutomaticBxgyInput`

Adds `customerBuys: DiscountCustomerBuysInput` (the trigger) alongside
`customerGets` (the reward, which uses `discountOnQuantity`). Also
`usesPerOrderLimit`. Confirm with `shopi schema show DiscountCodeBxgyInput`.

## `DiscountCodeFreeShippingInput` / automatic variant

`title`, `code` (code variant only), `startsAt`/`endsAt`, customer targeting,
`minimumRequirement`, `maximumShippingPrice`, `appliesOnOneTimePurchase`,
`appliesOnSubscription`, and **`destination`**:

```jsonc
{ "destination": { "all": true } }
// or { "destination": { "countries": { "add": ["US","CA"], "includeRestOfWorld": false } } }
```

## `DiscountRedeemCodeInput`

`{ "code": "VIP-0001" }` — a list of up to **250** per `discountRedeemCodeBulkAdd`
call. The call is asynchronous: the payload `bulkCreation` is a
`DiscountRedeemCodeBulkCreation` with `id`, `done`, `codesCount`, `importedCount`,
`failedCount`. Poll it; codes are not all present immediately.

## Pricing inputs

| Mutation | Input | Notes |
| --- | --- | --- |
| `priceListCreate` | `input: PriceListCreateInput!` | Name, currency, parent (`adjustment`), catalog. |
| `priceListUpdate` | `id: ID!`, `input: PriceListUpdateInput!` | Single `input`. |
| `priceListFixedPricesAdd` | `priceListId: ID!`, `prices: [PriceListPriceInput!]!` | Override variant prices. |
| `priceListFixedPricesUpdate` | (varies) | Update/delete existing fixed prices. |

`PriceListPriceInput`:

```jsonc
{
  "variantId": "gid://shopify/ProductVariant/…",
  "price": { "amount": "79.00", "currencyCode": "USD" },
  "compareAtPrice": { "amount": "99.00", "currencyCode": "USD" }   // optional
}
```

Price lists / markets are **Shopify Plus / B2B / multi-market** features and are
edition-gated. Confirm the exact create/update shapes — and whether your store can
use them at all — with discovery:

```sh
shopi schema show PriceListCreateInput --json --pretty
shopi schema show PriceListPriceInput --json --pretty
shopi ops list --kind query --filter market
shopi ops list --kind mutation --filter priceList
```

## Legacy `priceRule*`

`priceRuleCreate`, `priceRuleUpdate`, `priceRuleDiscountCodeCreate`,
`priceRuleActivate`/`Deactivate`, `priceRuleDelete` still exist but are the legacy
path. Prefer the `discount*` Node API. If maintaining old rules, confirm fields
with `shopi ops show priceRuleCreate --kind mutation --json --pretty`.
