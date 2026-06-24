# Order / fulfillment: filters, fields, and input shapes

A longer reference for the `shopi-orders-and-fulfillment` skill. Everything here was
checked against Shopify Admin GraphQL **2026-04**, but the live store schema is the
final word — confirm with `shopi ops show <field> --kind <kind>` and
`shopi schema show <Type>` before a write.

## `orders` search syntax (`query:` argument)

Terms combine with implicit AND. Common ones:

```text
financial_status:paid          paid | pending | refunded | partially_refunded |
                               partially_paid | authorized | voided | unpaid
fulfillment_status:unfulfilled unfulfilled | fulfilled | partial | restocked |
                               unshipped | shipped
status:open                    open | closed | cancelled   (order status)
created_at:>2026-01-01         date comparators: > >= < <= ; also updated_at, processed_at
updated_at:<2026-06-01
processed_at:>=2026-05-01
tag:vip                        has tag "vip"  (tag_not:vip to exclude)
name:#1001                     order name
email:jane@example.com
customer_id:1234567890         numeric id (not a GID) in search syntax
sales_channel:'Online Store'
risk_level:high                high | medium | low
test:false                     exclude test orders
chargeback_status:needs_response
return_status:in_progress      return-bearing orders
```

Combine freely: `financial_status:paid fulfillment_status:unfulfilled created_at:>2026-06-01`.
Quote multi-word values: `tag:'wholesale customer'`.

`sortKey` for `orders` is the **`OrderSortKeys`** enum (e.g. `CREATED_AT`,
`UPDATED_AT`, `PROCESSED_AT`, `TOTAL_PRICE`, `ORDER_NUMBER`, `RELEVANCE`); pair with
`--arg reverse=true` for descending. Confirm values with
`shopi schema show OrderSortKeys`.

`draftOrders` accepts a similar `query:` (e.g. `status:open`, `status:completed`,
`tag:`, `customer_id:`) and `sortKey` is `DraftOrderSortKeys`.

## Useful `Order` sub-selections (all verified fields)

```graphql
id name email phone note tags
displayFinancialStatus            # OrderDisplayFinancialStatus enum (PAID, PENDING, …)
displayFulfillmentStatus          # OrderDisplayFulfillmentStatus enum (FULFILLED, UNFULFILLED, …)
createdAt processedAt updatedAt closedAt cancelledAt cancelReason
fullyPaid unpaid confirmed test
totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
subtotalPriceSet { shopMoney { amount currencyCode } }
currentTotalPriceSet { shopMoney { amount currencyCode } }
totalRefundedSet { shopMoney { amount currencyCode } }
customer { id displayName defaultEmailAddress { emailAddress } numberOfOrders }
                                  # Order.email still works; Customer.email is deprecated
shippingAddress { name address1 city provinceCode countryCodeV2 zip }
lineItems(first: 50) {
  nodes { id title quantity sku
          variant { id title }
          originalUnitPriceSet { shopMoney { amount currencyCode } } }
}
fulfillmentOrders(first: 10) { nodes { id status requestStatus } }
fulfillments(first: 10) { id status trackingInfo { number company url } }  # a LIST, no nodes
transactions(first: 10) { id kind status gateway amountSet { shopMoney { amount } } }
returns(first: 10) { nodes { id status } }
refunds { id note totalRefundedSet { shopMoney { amount } } }
```

Money is exposed as **`MoneyBag`** (`shopMoney` / `presentmentMoney`), each a
`MoneyV2` (`amount` + `currencyCode`). There is no flat `totalPrice` string field —
always go through `*Set { shopMoney { amount currencyCode } }`.

> Default access window: only the last 60 days of orders are readable unless the app
> holds `read_all_orders` (in addition to `read_orders`). Old orders silently drop
> out otherwise.

## `FulfillmentOrder` sub-selections

```graphql
id status                          # FulfillmentOrderStatus: OPEN, IN_PROGRESS, ON_HOLD, SCHEDULED, …
requestStatus                      # FulfillmentOrderRequestStatus
supportedActions { action }        # which actions are currently allowed
assignedLocation { name location { id } }
destination { firstName lastName city countryCode }
fulfillmentHolds { id reason reasonNotes }
lineItems(first: 50) {
  nodes { id remainingQuantity totalQuantity
          lineItem { id title sku } }
}
fulfillments(first: 10) { nodes { id status } }
```

`supportedActions[].action` is the safest signal for what you can do *right now*
(e.g. `CREATE_FULFILLMENT`, `HOLD`, `RELEASE_HOLD`, `MOVE`, `CANCEL_FULFILLMENT_ORDER`,
`REQUEST_FULFILLMENT`). Check it before a hold/move/cancel.

## Mutation input shapes (verified, abbreviated)

### `fulfillmentCreate(fulfillment: FulfillmentInput!, message: String)`

```jsonc
{
  "lineItemsByFulfillmentOrder": [
    {
      "fulfillmentOrderId": "gid://shopify/FulfillmentOrder/1",
      // optional; omit to fulfill the whole fulfillment order
      "fulfillmentOrderLineItems": [
        { "id": "gid://shopify/FulfillmentOrderLineItem/9", "quantity": 1 }
      ]
    }
  ],
  "trackingInfo": { "number": "1Z…", "company": "UPS", "url": "https://…" },
  "notifyCustomer": true
}
```

`trackingInfo` may use singular (`number`, `url`) or plural (`numbers`, `urls`) forms.
Use a Shopify-known `company` to get clickable tracking links automatically.

### `fulfillmentTrackingInfoUpdate(fulfillmentId: ID!, trackingInfoInput: FulfillmentTrackingInput!, notifyCustomer: Boolean)`

`trackingInfoInput` is the same `FulfillmentTrackingInput` shape as above
(`number`/`numbers`, `url`/`urls`, `company`).

### `fulfillmentOrderHold(id: ID!, fulfillmentHold: FulfillmentOrderHoldInput!)`

`FulfillmentOrderHoldInput`: `reason` (**`FulfillmentHoldReason`** enum:
`AWAITING_PAYMENT`, `HIGH_RISK_OF_FRAUD`, `INCORRECT_ADDRESS`,
`INVENTORY_OUT_OF_STOCK`, `UNKNOWN_DELIVERY_DATE`, `AWAITING_RETURN_ITEMS`, `OTHER`,
…), `reasonNotes`, `notifyMerchant`, `externalId`, `handle`,
`fulfillmentOrderLineItems`.

### `fulfillmentOrderReleaseHold(id: ID!, holdIds: [ID!], externalId: String)`

Release a hold by `id` (the fulfillment order) and optionally specific `holdIds`.

### `fulfillmentOrderMove(id: ID!, newLocationId: ID!, fulfillmentOrderLineItems: [FulfillmentOrderLineItemInput!])`

Move an open fulfillment order to another location.
`fulfillmentOrderCancel(id: ID!)` cancels it.

### `orderCancel(orderId: ID!, reason: OrderCancelReason!, restock: Boolean!, refundMethod, notifyCustomer, staffNote)`

`reason` is **`OrderCancelReason`**: `CUSTOMER`, `DECLINED`, `FRAUD`, `INVENTORY`,
`STAFF`, `OTHER`. `restock` and `reason` are **required**. The old boolean `refund`
arg is **deprecated** in 2026-04 — use `refundMethod` (an
`OrderCancelRefundMethodInput`) to issue money back; check its shape with
`shopi schema show OrderCancelRefundMethodInput`. This is a multi-arg mutation —
pass each with `--arg`, not `--input`. The payload uses `orderCancelUserErrors`.

### `refundCreate(input: RefundInput!)`

```jsonc
{
  "orderId": "gid://shopify/Order/1",
  "note": "Damaged on arrival",
  "notify": true,
  "refundLineItems": [
    { "lineItemId": "gid://shopify/LineItem/2", "quantity": 1,
      "restockType": "RETURN",            // RETURN | CANCEL | NO_RESTOCK
      "locationId": "gid://shopify/Location/3" }
  ],
  "shipping": { "fullRefund": true },     // or { "amount": "5.00" }
  // transactions are optional; omit to let Shopify suggest, or compute from
  // order.suggestedRefund (a separate field) for an exact gateway refund.
  "transactions": [
    { "orderId": "gid://shopify/Order/1", "gateway": "shopify_payments",
      "kind": "REFUND", "amount": "24.99",
      "parentId": "gid://shopify/OrderTransaction/5" }
  ]
}
```

`restockType` is **`RefundLineItemRestockType`** (`RETURN` for fulfilled items,
`CANCEL` for unfulfilled, `NO_RESTOCK`). To compute exact amounts first, read
`order.suggestedRefund(...)` (see `shopi schema show Order`).

### `returnCreate(returnInput: ReturnInput!)` — merchant-initiated return

```jsonc
{
  "orderId": "gid://shopify/Order/1",
  "returnLineItems": [
    { "fulfillmentLineItemId": "gid://shopify/FulfillmentLineItem/7",
      "quantity": 1,
      "returnReasonNote": "Too small",
      "returnReasonDefinitionId": "gid://shopify/ReturnReasonDefinition/…" }
  ],
  "exchangeLineItems": []   // optional exchange items
}
```

Note the line-item id is a **`FulfillmentLineItem.id`**, not a plain `LineItem.id`.
Reason ids come from the `returnReasonDefinitions` query.

### `returnRequest(input: ReturnRequestInput!)` — customer-requested return

`ReturnRequestInput`: `orderId`, `returnLineItems[]` (`fulfillmentLineItemId`,
`quantity`, optional `returnReasonDefinitionId`, `customerNote`). Approve with
`returnApproveRequest(input: { id, notifyCustomer })` or `returnDeclineRequest`.

### Draft orders

- `draftOrderCreate(input: DraftOrderInput!)`
- `draftOrderUpdate(id: ID!, input: DraftOrderInput!)` — multi-arg, use `--arg`.
- `draftOrderComplete(id: ID!, paymentPending: Boolean, …)` — turns a draft into an
  order. Confirm the exact optional args with
  `shopi ops show draftOrderComplete --kind mutation`.
- `draftOrderDelete(input: DraftOrderDeleteInput!)` — input is `{ id }`.
- `draftOrderCalculate(input: DraftOrderInput!)` previews totals without saving.

`DraftOrderInput` highlights (confirm with `shopi schema show DraftOrderInput`):
`lineItems` (each `variantId`+`quantity`, or a custom item with `title`+`originalUnitPriceWithCurrency`/`priceOverride`),
`customerId` or `email`, `shippingAddress`, `billingAddress`, `appliedDiscount`,
`shippingLine`, `note`, `tags`, `useCustomerDefaultAddress`.
