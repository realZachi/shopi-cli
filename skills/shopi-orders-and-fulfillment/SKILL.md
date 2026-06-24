---
name: shopi-orders-and-fulfillment
description: >-
  Order and fulfillment operations with the shopi CLI (`shopi`) over the Shopify
  Admin GraphQL API. Use whenever the user wants to list paid orders, find
  unfulfilled orders, look up or update an order, fulfill an order or add
  tracking, hold/release/move a fulfillment order, cancel, close, capture, or
  mark an order as paid, tag orders, create or complete a draft order, or process
  a return or refund — even when they don't say "shopi" or "GraphQL". Triggers on
  "list paid orders", "unfulfilled orders", "fulfill an order", "add tracking",
  "cancel/refund an order", "create a draft order", "process a return". Complements
  the hub skill `shopi-cli-usage` (global flags, discovery, output, write safety)
  and defers to `shopi-bulk-operations` for large order exports.
---

# shopi: orders and fulfillment

This skill covers the order, fulfillment, draft-order, return, and refund domain
through `shopi read`, `shopi write`, and `shopi gql`. It assumes the
**`shopi-cli-usage`** hub skill for everything global — discovery (`ops`/`schema`),
output formats, GIDs, pagination, `--dry-run`/`--confirm` write safety, and auth.
Load that first; this skill only adds the order-specific fields, mutations, and
gotchas.

> **The store's schema is the source of truth.** Admin API shapes drift between
> versions. The field/mutation/input/enum names below were verified against API
> version **2026-04**, but always confirm the exact args for *your* version with
> discovery before a write:
>
> ```sh
> shopi ops show fulfillmentCreate --kind mutation --json --pretty
> shopi schema show FulfillmentInput --json --pretty
> ```

Order data needs the right scopes: `read_orders` / `write_orders`, plus
`read_all_orders` to see orders older than 60 days, and the
`*_merchant_managed_fulfillment_orders` (and friends) scopes for fulfillment
orders. Scope gaps come back as GraphQL/HTTP errors, not silent no-ops.

## Cheat sheet

| Goal | shopi field / mutation |
| --- | --- |
| List/search orders | `shopi read orders` (Relay connection, `query:` search) |
| One order | `shopi read order --id gid://shopify/Order/…` |
| Update an order (note/tags via input) | `shopi write orderUpdate` |
| Close / reopen an order | `shopi write orderClose` / `orderOpen` |
| Cancel an order | `shopi write orderCancel` (multi-arg) |
| Mark as paid / capture payment | `shopi write orderMarkAsPaid` / `orderCapture` |
| Add / remove tags | `shopi write tagsAdd` / `tagsRemove` |
| List/search draft orders | `shopi read draftOrders` / `shopi read draftOrder` |
| Create / update a draft order | `shopi write draftOrderCreate` / `draftOrderUpdate` |
| Complete / delete a draft order | `shopi write draftOrderComplete` / `draftOrderDelete` |
| Read fulfillment orders | `shopi read order --select 'fulfillmentOrders {…}'` or `shopi read fulfillmentOrders` |
| Create a fulfillment (+ tracking) | `shopi write fulfillmentCreate` |
| Update tracking | `shopi write fulfillmentTrackingInfoUpdate` |
| Hold / release / move / cancel a fulfillment order | `shopi write fulfillmentOrderHold` / `fulfillmentOrderReleaseHold` / `fulfillmentOrderMove` / `fulfillmentOrderCancel` |
| Cancel a fulfillment | `shopi write fulfillmentCancel` |
| Create a return (merchant) / request (customer) | `shopi write returnCreate` / `returnRequest` |
| Approve / decline a return request | `shopi write returnApproveRequest` / `returnDeclineRequest` |
| Refund | `shopi write refundCreate` |

A longer filter/field/input reference lives in
[`references/order-filters-and-fields.md`](references/order-filters-and-fields.md).

> **`fulfillmentCreate`, not `fulfillmentCreateV2`.** In 2026-04 the V2 names were
> retired — the live mutations are `fulfillmentCreate` and
> `fulfillmentTrackingInfoUpdate`. If a tool insists on a `…V2` name, it is stale;
> confirm with `shopi ops list --kind mutation --filter fulfillment`.

## Reading orders

`orders` is a Relay connection: page with `first`/`after` and read
`pageInfo { hasNextPage endCursor }`. `shopi` auto-generates a connection-aware
selection, but pass an explicit `--select` for anything you parse downstream.

```sh
# Paid but not-yet-fulfilled orders, newest first
shopi read orders --first 25 \
  --query 'financial_status:paid fulfillment_status:unfulfilled' \
  --arg sortKey=CREATED_AT --arg reverse=true \
  --select 'nodes { id name email createdAt
                    displayFinancialStatus displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } } }
            pageInfo { hasNextPage endCursor }' \
  --json --pretty

# Next page: feed back the endCursor
shopi read orders --first 25 \
  --query 'financial_status:paid fulfillment_status:unfulfilled' \
  --arg after='eyJsYXN0X2lkIjo…' \
  --select 'nodes { id name } pageInfo { hasNextPage endCursor }' --json
```

Money lives in a **`MoneyBag`** — there is no flat `totalPrice` string. Always go
through `totalPriceSet { shopMoney { amount currencyCode } }`. See the reference for
the full filter list (`status:open`, `created_at:>…`, `tag:`, `email:`, etc.) and
more sub-selections.

One order, with line items and fulfillment orders:

```sh
shopi read order --id gid://shopify/Order/1234567890 \
  --select 'id name displayFinancialStatus displayFulfillmentStatus
            customer { id displayName defaultEmailAddress { emailAddress } }
            lineItems(first: 50) { nodes { id title quantity sku
                                           variant { id } } }
            fulfillmentOrders(first: 10) {
              nodes { id status requestStatus supportedActions { action }
                      assignedLocation { name }
                      lineItems(first: 50) { nodes { id remainingQuantity } } } }' \
  --json --pretty
```

`fulfillmentOrders` can also be read at the top level
(`shopi read fulfillmentOrders --first 50 --query 'status:open'`), and one by id
with `shopi read fulfillmentOrder --id gid://shopify/FulfillmentOrder/…`.

## Writing: GIDs, dry-run, userErrors

Every order/fulfillment mutation returns `userErrors { field message }` (returns add
a typed `*UserErrors` with a `code`). **Always select and check them** — a 200 with
non-empty `userErrors` means nothing changed. Preview with `--dry-run`, then re-run
with `--confirm`. Use GIDs (`gid://shopify/Order/…`, `…/FulfillmentOrder/…`,
`…/FulfillmentLineItem/…`) everywhere.

Single-input vs. multi-arg (confirm with `shopi ops show <mutation> --kind mutation`):

- **Single `input:`** → `--input @file.json`: `orderUpdate(input:)`,
  `orderClose(input:)`, `orderOpen(input:)`, `orderMarkAsPaid(input:)`,
  `orderCapture(input:)`, `draftOrderCreate(input:)`, `refundCreate(input:)`.
- **Named input arg** (still one arg, but not named `input`) → `--input @file.json`
  works too: `fulfillmentCreate(fulfillment:)`, `returnCreate(returnInput:)`,
  `returnRequest(input:)`, `returnApproveRequest(input:)`.
- **Multi-arg** → one `--arg` per argument: `orderCancel`, `draftOrderUpdate`,
  `draftOrderComplete`, `fulfillmentTrackingInfoUpdate`, `fulfillmentOrderHold`,
  `fulfillmentOrderReleaseHold`, `fulfillmentOrderMove`, `tagsAdd`, `tagsRemove`.

## End-to-end examples

### 1) Tag a batch of orders (and untag)

`tagsAdd`/`tagsRemove` work on any taggable resource, orders included.

```sh
shopi write tagsAdd \
  --arg id=gid://shopify/Order/1234567890 \
  --arg tags='["priority","needs-review"]' \
  --select 'node { id } userErrors { field message }' \
  --dry-run --json --pretty        # add --confirm to apply
# tagsRemove takes the same args.
```

### 2) Fulfill an order with tracking

Fulfillment is keyed on the **fulfillment order**, not the order. Read the open
fulfillment order ids first, then create the fulfillment.

```sh
shopi read order --id gid://shopify/Order/1234567890 \
  --select 'fulfillmentOrders(first: 5) { nodes { id status supportedActions { action } } }' \
  --json --pretty
```

`fulfill.json` (a `FulfillmentInput`):

```json
{
  "lineItemsByFulfillmentOrder": [
    { "fulfillmentOrderId": "gid://shopify/FulfillmentOrder/111" }
  ],
  "trackingInfo": { "number": "1Z999AA10123456784", "company": "UPS" },
  "notifyCustomer": true
}
```

```sh
shopi write fulfillmentCreate --input @fulfill.json \
  --select 'fulfillment { id status trackingInfo { number company url } }
            userErrors { field message }' \
  --dry-run --json --pretty        # add --confirm to fulfill
```

Omit `fulfillmentOrderLineItems` to fulfill the whole fulfillment order, or list
`{ id, quantity }` per line for a partial fulfillment.

### 3) Add or correct tracking after the fact

```sh
shopi write fulfillmentTrackingInfoUpdate \
  --arg fulfillmentId=gid://shopify/Fulfillment/9001 \
  --arg trackingInfoInput='{"number":"1Z999AA10123456784","company":"UPS"}' \
  --arg notifyCustomer=true \
  --select 'fulfillment { id trackingInfo { number url company } }
            userErrors { field message }' \
  --confirm --json --pretty
```

### 4) Hold and release a fulfillment order

```sh
shopi write fulfillmentOrderHold \
  --arg id=gid://shopify/FulfillmentOrder/111 \
  --arg fulfillmentHold='{"reason":"INCORRECT_ADDRESS","reasonNotes":"Confirm ZIP with customer"}' \
  --select 'fulfillmentOrder { id status } userErrors { field message }' \
  --confirm --json --pretty

shopi write fulfillmentOrderReleaseHold \
  --arg id=gid://shopify/FulfillmentOrder/111 \
  --select 'fulfillmentOrder { id status } userErrors { field message }' \
  --confirm --json
```

`reason` is the `FulfillmentHoldReason` enum (`AWAITING_PAYMENT`,
`HIGH_RISK_OF_FRAUD`, `INCORRECT_ADDRESS`, `INVENTORY_OUT_OF_STOCK`, …). Move with
`fulfillmentOrderMove(id, newLocationId, …)`; cancel with `fulfillmentOrderCancel(id)`.

### 5) Cancel an order (multi-arg — `reason` + `restock` required)

```sh
shopi write orderCancel \
  --arg orderId=gid://shopify/Order/1234567890 \
  --arg reason=CUSTOMER \
  --arg restock=true \
  --arg notifyCustomer=true \
  --select 'job { id done } orderCancelUserErrors { field message code }' \
  --dry-run --json --pretty        # review, then --confirm
```

`reason` is `OrderCancelReason` (`CUSTOMER`, `DECLINED`, `FRAUD`, `INVENTORY`,
`STAFF`, `OTHER`); `reason` and `restock` are **required**. To return the money,
pass `--arg refundMethod='{…OrderCancelRefundMethodInput…}'` (the old boolean
`refund` arg is **deprecated** in 2026-04) — confirm its shape with
`shopi schema show OrderCancelRefundMethodInput`. `orderCancel` runs asynchronously
and returns a `job` — re-read the order to confirm `cancelledAt`. The payload uses
`orderCancelUserErrors`, not the generic `userErrors`.

### 6) Mark as paid, then close

```sh
echo '{"id":"gid://shopify/Order/1234567890"}' > order-id.json

shopi write orderMarkAsPaid --input @order-id.json \
  --select 'order { id displayFinancialStatus } userErrors { field message }' \
  --confirm --json

shopi write orderClose --input @order-id.json \
  --select 'order { id closedAt } userErrors { field message }' \
  --confirm --json
```

To capture an authorized payment instead, use `orderCapture` with an
`OrderCaptureInput` (`id`, `parentTransactionId`, `amount`, `currency`). Read the
authorization first via `order.transactions { id kind status }`. Reopen a closed
order with `orderOpen`.

### 7) Create and complete a draft order

`draft.json` (a `DraftOrderInput`):

```json
{
  "email": "jane@example.com",
  "lineItems": [
    { "variantId": "gid://shopify/ProductVariant/4567", "quantity": 2 }
  ],
  "note": "Phone order",
  "tags": ["wholesale"]
}
```

```sh
shopi write draftOrderCreate --input @draft.json \
  --select 'draftOrder { id name totalPriceSet { shopMoney { amount currencyCode } } }
            userErrors { field message }' \
  --confirm --json --pretty

# Turn the draft into a real order (multi-arg).
shopi write draftOrderComplete \
  --arg id=gid://shopify/DraftOrder/777 \
  --select 'draftOrder { id order { id name } } userErrors { field message }' \
  --confirm --json
```

`draftOrderUpdate(id, input)` edits a draft (multi-arg); `draftOrderDelete(input: { id })`
removes one; `draftOrderCalculate(input)` previews totals without saving.

### 8) Process a refund

`refund.json` (a `RefundInput`):

```json
{
  "orderId": "gid://shopify/Order/1234567890",
  "note": "Damaged on arrival",
  "notify": true,
  "refundLineItems": [
    { "lineItemId": "gid://shopify/LineItem/2222", "quantity": 1,
      "restockType": "RETURN", "locationId": "gid://shopify/Location/3" }
  ],
  "shipping": { "fullRefund": true }
}
```

```sh
shopi write refundCreate --input @refund.json \
  --select 'refund { id totalRefundedSet { shopMoney { amount currencyCode } } }
            userErrors { field message }' \
  --dry-run --json --pretty        # add --confirm to refund
```

`restockType` is `RETURN` (fulfilled items), `CANCEL` (unfulfilled), or
`NO_RESTOCK`. For an exact gateway amount, read `order.suggestedRefund(...)` first
and pass `transactions` (see the reference). For full returns, prefer the returns
flow below.

### 9) Create a return (merchant-initiated)

Return line items reference a **`FulfillmentLineItem.id`**, not a plain
`LineItem.id`. Find it under each fulfillment — note `order.fulfillments` is a
plain list (no `nodes`), and each `Fulfillment.fulfillmentLineItems` is a
connection:

```sh
shopi read order --id gid://shopify/Order/1234567890 \
  --select 'fulfillments(first: 10) { id
              fulfillmentLineItems(first: 50) { nodes { id quantity lineItem { id title } } } }' \
  --json --pretty
```

```sh
echo '{"orderId":"gid://shopify/Order/1234567890",
       "returnLineItems":[{"fulfillmentLineItemId":"gid://shopify/FulfillmentLineItem/7",
                           "quantity":1,"returnReasonNote":"Too small"}]}' > return.json

shopi write returnCreate --input @return.json \
  --select 'return { id status } userErrors { field message code }' \
  --dry-run --json --pretty        # add --confirm to create
```

For a customer-requested flow, use `returnRequest(input: ReturnRequestInput!)` then
`returnApproveRequest(input: { id, notifyCustomer })` (or `returnDeclineRequest`).
Reason ids come from `shopi read returnReasonDefinitions`.

## Large order exports

For pulling thousands of orders (reporting, migrations), don't deep-paginate the
`orders` connection — switch to the Bulk Operations API
(`bulkOperationRunQuery`) covered by **`shopi-bulk-operations`**.

## Verify with discovery

Before any write, anchor on the live schema rather than this page:

```sh
shopi ops list --kind mutation --filter order        # discover order mutations
shopi ops list --kind mutation --filter fulfillment   # discover fulfillment mutations
shopi ops show orderCancel --kind mutation --json --pretty
shopi schema show FulfillmentInput --json --pretty
shopi schema show OrderCancelReason --json --pretty    # confirm enum values
```

Then preview with `--dry-run`, run with `--confirm`, and re-read the resource
(`shopi read order --id <gid>`) to confirm the change landed. For large order
exports prefer **`shopi-bulk-operations`**.
