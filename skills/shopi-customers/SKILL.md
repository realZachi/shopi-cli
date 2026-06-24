---
name: shopi-customers
description: >-
  Customer, segment, and B2B operations with the shopi CLI (`shopi`) over the
  Shopify Admin GraphQL API. Use whenever the user wants to find customers by
  email/tag/state/country, look up top spenders or high-order customers,
  create/update/delete a customer, add or remove customer tags, edit a
  customer's addresses, set email or SMS marketing consent, work with customer
  segments (list/create/update/delete and read members), or manage B2B companies,
  company contacts, and company locations — even when they don't say "shopi" or
  "GraphQL". Complements the hub skill `shopi-cli-usage` (global flags,
  discovery, output, GIDs, write safety) and defers to `shopi-bulk-operations`
  for large customer exports.
---

# shopi: customers, segments, and B2B

This skill covers the customer domain through `shopi read`, `shopi write`, and
`shopi gql`. It assumes the **`shopi-cli-usage`** hub skill for everything global
— discovery (`ops`/`schema`), output formats, GIDs, pagination,
`--dry-run`/`--confirm` write safety, and auth. Load that first; this skill only
adds the customer-specific fields, mutations, and gotchas.

> **The store's schema is the source of truth.** Admin API shapes drift between
> versions. The names below were verified against API version **2026-04**, but
> always confirm the exact args for *your* version before a write:
>
> ```sh
> shopi ops show customerUpdate --kind mutation --json --pretty
> shopi schema show CustomerInput --json --pretty
> ```

> **Customer data is PII.** Names, emails, phone numbers, and addresses are
> personal data. Redact them in anything you share or log, prefer aggregate
> reads, and never paste raw customer rows into a shared channel. Erasure is a
> governed process — see [Privacy and erasure](#privacy-and-erasure), not a
> casual `customerDelete`.

## Cheat sheet

| Goal | shopi field / mutation |
| --- | --- |
| List/search customers | `shopi read customers` (Relay connection, `query:` search) |
| One customer | `shopi read customer --id gid://shopify/Customer/…` |
| Create a customer | `shopi write customerCreate` |
| Update a customer | `shopi write customerUpdate` |
| Delete a customer | `shopi write customerDelete` (see privacy note) |
| Add/remove tags | `shopi write tagsAdd` / `shopi write tagsRemove` |
| Add an address | `shopi write customerAddressCreate` |
| Update/delete an address | `shopi write customerAddressUpdate` / `customerAddressDelete` |
| Set email marketing consent | `shopi write customerEmailMarketingConsentUpdate` |
| Set SMS marketing consent | `shopi write customerSmsMarketingConsentUpdate` |
| List/search segments | `shopi read segments` / `shopi read segment` |
| Create/update/delete a segment | `shopi write segmentCreate` / `segmentUpdate` / `segmentDelete` |
| Read segment members | `shopi read customerSegmentMembers` |
| List/search companies (B2B) | `shopi read companies` / `shopi read company` |
| Create company / contact / location | `shopi write companyCreate` / `companyContactCreate` / `companyLocationCreate` |
| Request GDPR-style erasure | `shopi write customerRequestDataErasure` (`customerCancelDataErasure` to cancel) |

A longer field/filter/segment-language reference lives in
[`references/customer-fields.md`](references/customer-fields.md).

## Reading customers

`customers` is a Relay connection: page with `first`/`after` and read
`pageInfo { hasNextPage endCursor }`. `shopi` auto-generates a connection-aware
selection, but pass an explicit `--select` for anything you parse.

> **2026-04 deprecations to know.** On `Customer`, `email`,
> `emailMarketingConsent`, `smsMarketingConsent`, and `addresses` are
> **deprecated**. Prefer `defaultEmailAddress { emailAddress marketingState
> marketingOptInLevel }`, `defaultPhoneNumber { phoneNumber marketingState }`,
> and `addressesV2(first:) { nodes { … } }` for paginated addresses
> (`defaultAddress` is still fine for the single primary address). Verify with
> `shopi schema show Customer --json --pretty`.

```sh
# Find a customer by email (modern fields)
shopi read customers --first 10 --query "email:jane@example.com" \
  --select 'nodes { id displayName numberOfOrders
                    amountSpent { amount currencyCode }
                    defaultEmailAddress { emailAddress marketingState }
                    defaultAddress { city countryCodeV2 } tags state }
            pageInfo { hasNextPage endCursor }' \
  --json --pretty

# One customer by GID
shopi read customer --id gid://shopify/Customer/1234567890 \
  --select 'id displayName numberOfOrders note verifiedEmail createdAt
            defaultEmailAddress { emailAddress marketingState marketingOptInLevel }
            defaultPhoneNumber { phoneNumber marketingState }
            addressesV2(first: 10) { nodes { id address1 city provinceCode countryCodeV2 } }' \
  --json --pretty
```

### Search syntax (`query:` argument)

Combine terms (implicit AND). Common customer filters:

```text
email:jane@example.com        email match
tag:vip        tag_not:churned tag membership
state:enabled                 account state: disabled | invited | enabled | declined
country:'United States'       quote multi-word values
orders_count:>5               numeric comparators > >= < <=
total_spent:>500
last_order_date:>2026-01-01   date comparators
customer_date:>2026-01-01     created date
```

Sorting uses the **`CustomerSortKeys`** enum (`CREATED_AT`, `ID`, `LOCATION`,
`NAME`, `RELEVANCE`, `UPDATED_AT`) — there is **no** `TOTAL_SPENT` key. For "top
spenders", filter on `total_spent:>…` / `orders_count:>…` and rank client-side,
or use a segment (below):

```sh
# High-order US customers; rank by amountSpent in your own tooling
shopi read customers --first 50 \
  --query "orders_count:>5 country:'United States'" --sortKey NAME \
  --select 'nodes { id displayName numberOfOrders amountSpent { amount currencyCode } }' \
  --json --pretty
```

## Writing customers

`customerCreate` and `customerUpdate` both take a single `input` arg
(`CustomerInput`), so use `--input @file.json`. **Always select and check
`userErrors { field message }`** — a 200 with non-empty `userErrors` means
nothing changed.

```sh
# Create — input arg is named `input`, so --input works
echo '{"firstName":"Jane","lastName":"Doe","email":"jane@example.com","tags":["newsletter"]}' > cust.json
shopi write customerCreate --input @cust.json \
  --select 'customer { id displayName defaultEmailAddress { emailAddress } }
            userErrors { field message }' \
  --dry-run --json --pretty   # add --confirm to apply

# Update — include the GID in the input
echo '{"id":"gid://shopify/Customer/1234567890","note":"VIP since 2026"}' > upd.json
shopi write customerUpdate --input @upd.json \
  --select 'customer { id note } userErrors { field message }' \
  --confirm --json --pretty
```

### Tags

`tagsAdd` / `tagsRemove` are generic taggable mutations (they also tag products,
orders, etc.). Multi-arg: `id` (the customer GID) + `tags` (a list).

```sh
shopi write tagsAdd \
  --arg id=gid://shopify/Customer/1234567890 \
  --arg tags='["vip","wholesale"]' \
  --select 'node { id } userErrors { field message }' \
  --confirm --json
# tagsRemove takes the same args.
```

### Addresses

Address mutations are multi-arg and act on a customer. `customerAddressCreate`
takes `customerId` + `address`; update/delete take `customerId` + `addressId`
(plus `address` for update). They return `address` / `deletedAddressId`.

```sh
echo '{"address1":"1 Main St","city":"Ottawa","provinceCode":"ON","countryCode":"CA","zip":"K1A0B1"}' > addr.json
shopi write customerAddressCreate \
  --arg customerId=gid://shopify/Customer/1234567890 \
  --arg address=@addr.json \
  --select 'address { id city } userErrors { field message }' \
  --confirm --json

shopi write customerAddressDelete \
  --arg customerId=gid://shopify/Customer/1234567890 \
  --arg addressId=gid://shopify/MailingAddress/9876 \
  --select 'deletedAddressId userErrors { field message }' \
  --dry-run --json   # add --confirm to apply
```

### Marketing consent has its own mutations (compliance)

You **cannot** flip marketing consent through `customerUpdate`. Email and SMS
consent each have a dedicated mutation —
`customerEmailMarketingConsentUpdate` and `customerSmsMarketingConsentUpdate` —
because consent is a regulated record (opt-in level, state, timestamp, source)
that needs a clear audit trail, not an incidental profile edit.

```sh
echo '{"customerId":"gid://shopify/Customer/1234567890",
       "emailMarketingConsent":{"marketingState":"SUBSCRIBED","marketingOptInLevel":"SINGLE_OPT_IN"}}' > consent.json
shopi write customerEmailMarketingConsentUpdate --input @consent.json \
  --select 'customer { id defaultEmailAddress { marketingState marketingOptInLevel } }
            userErrors { field message }' \
  --dry-run --json --pretty   # add --confirm to apply
```

`customerSmsMarketingConsentUpdate` is the same shape with an
`smsMarketingConsent` object. Confirm the enum values (`marketingState`,
`marketingOptInLevel`) with discovery — see the reference file.

## Customer segments

Segments are saved customer filters written in Shopify's **segment query
language** (a ShopifyQL dialect, distinct from the `query:` search syntax used by
`customers`). The `Segment.query` field stores that string.

```sh
# List segments
shopi read segments --first 20 \
  --select 'nodes { id name query creationDate lastEditDate }
            pageInfo { hasNextPage endCursor }' --json --pretty

# Create a segment (multi-arg: name + query)
shopi write segmentCreate \
  --arg name="VIP buyers" \
  --arg query="number_of_orders > 5 AND customer_tags CONTAINS 'vip'" \
  --select 'segment { id name query } userErrors { field message }' \
  --dry-run --json --pretty   # add --confirm to apply
```

`segmentUpdate` takes `id` (+ `name`/`query`); `segmentDelete` takes `id` and
returns `deletedSegmentId`. Read who is in a segment with
`customerSegmentMembers` — note it exposes a top-level `totalCount` and
`edges { node { … } }` (not `nodes`):

```sh
shopi read customerSegmentMembers \
  --arg segmentId=gid://shopify/Segment/123 --first 50 \
  --select 'totalCount
            edges { node { id displayName numberOfOrders
                           defaultEmailAddress { emailAddress } } }
            pageInfo { hasNextPage endCursor }' \
  --json --pretty
```

The full segment query language (fields, operators like `CONTAINS` / `AND` /
`BETWEEN`, functions) is large and version-specific — point to the live docs and
discover field names rather than memorizing. See the reference file for a starter
set, and confirm with `shopi ops show segmentCreate --kind mutation`.

## B2B: companies, contacts, locations

B2B is a large surface; this is the discovery-anchored headline. Companies group
B2B buyers; a **company contact** links a `Customer` to a company; a **company
location** holds buying terms / addresses.

```sh
shopi read companies --first 20 --query "name:Acme" \
  --select 'nodes { id name externalId
                    contactsCount { count } locationsCount { count } }
            pageInfo { hasNextPage endCursor }' --json --pretty

shopi read company --id gid://shopify/Company/123 \
  --select 'id name
            contacts(first: 10) { nodes { id customer { id displayName } } }
            locations(first: 10) { nodes { id name } }' --json --pretty
```

Headline create mutations (all return `userErrors`):

```sh
# Company: single `input` arg (CompanyCreateInput → { company { name … } })
echo '{"company":{"name":"Acme Corp","externalId":"ACME-1"}}' > company.json
shopi write companyCreate --input @company.json \
  --select 'company { id name } userErrors { field message }' \
  --dry-run --json --pretty

# Company contact: multi-arg companyId + input. The input CREATES the associated
# customer (email/firstName/lastName) — it does not take a customerId.
shopi write companyContactCreate \
  --arg companyId=gid://shopify/Company/123 \
  --arg input='{"email":"avery@acme.com","firstName":"Avery","lastName":"Brown"}' \
  --select 'companyContact { id customer { id email } } userErrors { field message code }' \
  --dry-run --json --pretty

# Company location: multi-arg companyId + input
shopi write companyLocationCreate \
  --arg companyId=gid://shopify/Company/123 \
  --arg input='{"name":"HQ"}' \
  --select 'companyLocation { id name } userErrors { field message code }' \
  --dry-run --json --pretty
```

To assign an existing customer as a contact, or to manage roles, catalogs, and
payment terms, discover the related mutations
(`shopi ops list --kind mutation --filter company`) rather than guessing — the
B2B input shapes are deep and change between versions.

## Privacy and erasure

- **Redact PII** in shared output. Prefer counts and aggregates; when you must
  show rows, mask emails/phones.
- **`customerDelete` is not GDPR erasure.** For a data-subject request, the
  compliant path is `customerRequestDataErasure(customerId:)` (cancel with
  `customerCancelDataErasure`), which requires the `write_customer_data_erasure`
  scope. At the app level, customer redaction/erasure is governed by Shopify's
  mandatory **`customers/redact`** and **`customers/data_request`** compliance
  webhooks — not an ad-hoc delete. Treat erasure as a governed workflow.

```sh
shopi write customerRequestDataErasure \
  --arg customerId=gid://shopify/Customer/1234567890 \
  --select 'customerId userErrors { field message code }' \
  --dry-run --json   # add --confirm to apply
```

## Scale: large customer exports

For tens of thousands of customers (full exports, segment dumps, consent audits),
do **not** deep-paginate `customers` — use the Bulk Operations API
(`bulkOperationRunQuery`) and download the JSONL. See **`shopi-bulk-operations`**.

## Verify with discovery

Before any write, anchor on the live schema rather than this page:

```sh
shopi ops list --kind mutation --filter customer     # discover customer mutations
shopi ops list --kind mutation --filter segment
shopi ops show customerEmailMarketingConsentUpdate --kind mutation --json --pretty
shopi schema show CustomerInput --json --pretty
shopi schema show CustomerEmailMarketingConsentInput --json --pretty
shopi schema show CustomerSortKeys --json --pretty    # confirm enum values
```

Then preview with `--dry-run`, run with `--confirm`, select and check
`userErrors`, and re-read the resource (`shopi read customer --id <gid>`) to
confirm the change landed.
