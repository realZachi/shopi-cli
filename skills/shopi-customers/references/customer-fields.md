# Customer field / filter / mutation reference

Verified against Shopify Admin API **2026-04**. Names drift between versions —
confirm with `shopi ops show <name>` and `shopi schema show <Type>` for your
target version. This is a quick lookup, not a replacement for discovery.

## Query (read) fields

| Field | Args (highlights) | Notes |
| --- | --- | --- |
| `customers` | `first`/`after`/`last`/`before`, `query`, `sortKey`, `reverse` | Relay connection. |
| `customer` | `id` (GID) | Single customer. |
| `segments` | `first`/`after`, `query`, `sortKey`, `reverse` | Relay connection of saved segments. |
| `segment` | `id` (GID) | Single segment; has `query` (segment query language string). |
| `customerSegmentMembers` | `segmentId` (GID, required), `first`/`after`, `query` | Members of a segment. Exposes top-level `totalCount` and `edges { node }` (use `edges`, not `nodes`). Max page size 1000. |
| `companies` | `first`/`after`, `query`, `sortKey` | Relay connection (B2B). Needs `read_companies`. |
| `company` | `id` (GID) | Single company; `contacts(first:)`, `locations(first:)` connections. |
| `companyContacts` | `first`/`after`, `query` | Connection of company contacts. |
| `companyLocations` | `first`/`after`, `query` | Connection of company locations. |

## Useful `Customer` selections (2026-04)

| Field | Notes |
| --- | --- |
| `id` | GID — required for every mutation. |
| `displayName`, `firstName`, `lastName` | Names. |
| `numberOfOrders` | Lifetime order count. |
| `amountSpent { amount currencyCode }` | Lifetime spend (MoneyV2). |
| `defaultEmailAddress { emailAddress marketingState marketingOptInLevel marketingUpdatedAt sourceLocation { id } }` | **Modern** email + consent. Replaces deprecated `email` / `emailMarketingConsent`. |
| `defaultPhoneNumber { phoneNumber marketingState marketingOptInLevel marketingUpdatedAt }` | **Modern** phone + SMS consent. Replaces deprecated `smsMarketingConsent`. |
| `defaultAddress { id address1 city provinceCode countryCodeV2 zip }` | Single primary address (still fine). |
| `addressesV2(first:) { nodes { … } }` | **Modern** paginated addresses. Replaces deprecated `addresses`. |
| `tags`, `note`, `state`, `verifiedEmail`, `createdAt`, `updatedAt` | Profile metadata. `state`: `DISABLED`/`INVITED`/`ENABLED`/`DECLINED`. |

> Deprecated in 2026-04 (avoid): `Customer.email`, `Customer.emailMarketingConsent`,
> `Customer.smsMarketingConsent`, `Customer.addresses`.

## Customer search-query (`query:`) terms

```text
email:jane@example.com               email match
phone:+15145551234                   phone match
tag:vip        tag_not:churned       tag membership
state:enabled                        disabled | invited | enabled | declined
country:'United States'              quote multi-word values
orders_count:>5                      numeric comparators > >= < <=
total_spent:>500
last_order_date:>2026-01-01          date comparators
customer_date:>2026-01-01            account-created date
first_name:Jane   last_name:Doe
accepts_marketing:true               (legacy boolean; prefer consent fields on read)
```

`CustomerSortKeys` enum: `CREATED_AT`, `ID`, `LOCATION`, `NAME`, `RELEVANCE`,
`UPDATED_AT`. (No `TOTAL_SPENT` — rank top spenders client-side or via a segment.)

## Mutations

| Mutation | Arg shape | Returns |
| --- | --- | --- |
| `customerCreate` | `input: CustomerInput` (`--input`) | `customer`, `userErrors` |
| `customerUpdate` | `input: CustomerInput` with `id` (`--input`) | `customer`, `userErrors` |
| `customerDelete` | `input: CustomerDeleteInput` with `id` (`--input`) | `deletedCustomerId`, `userErrors` |
| `tagsAdd` / `tagsRemove` | `id` + `tags: [String!]` (`--arg`) | `node`, `userErrors` |
| `customerAddressCreate` | `customerId` + `address: MailingAddressInput` | `address`, `userErrors` |
| `customerAddressUpdate` | `customerId` + `addressId` + `address` | `address`, `userErrors` |
| `customerAddressDelete` | `customerId` + `addressId` | `deletedAddressId`, `userErrors` |
| `customerEmailMarketingConsentUpdate` | `input: CustomerEmailMarketingConsentUpdateInput` (`customerId` + `emailMarketingConsent`) | `customer`, `userErrors` |
| `customerSmsMarketingConsentUpdate` | `input: CustomerSmsMarketingConsentUpdateInput` (`customerId` + `smsMarketingConsent`) | `customer`, `userErrors` |
| `customerRequestDataErasure` | `customerId` (`--arg`) | `customerId`, `userErrors` (needs `write_customer_data_erasure`) |
| `customerCancelDataErasure` | `customerId` (`--arg`) | `customerId`, `userErrors` |
| `segmentCreate` | `name` + `query` (`--arg`) | `segment`, `userErrors` |
| `segmentUpdate` | `id` + `name`/`query` (`--arg`) | `segment`, `userErrors` |
| `segmentDelete` | `id` (`--arg`) | `deletedSegmentId`, `userErrors` |
| `companyCreate` | `input: CompanyCreateInput` (`--input`; `{ company: { … } }`) | `company`, `userErrors` |
| `companyContactCreate` | `companyId` + `input: CompanyContactInput` (`email`/`firstName`/`lastName` — creates the associated customer) | `companyContact`, `userErrors` |
| `companyLocationCreate` | `companyId` + `input: CompanyLocationInput` | `companyLocation`, `userErrors` |

Marketing-consent enums (confirm with `shopi schema show`):
- `marketingState` (email): e.g. `SUBSCRIBED`, `NOT_SUBSCRIBED`, `UNSUBSCRIBED`,
  `PENDING`, `REDACTED`, `INVALID`.
- `marketingOptInLevel`: `SINGLE_OPT_IN`, `CONFIRMED_OPT_IN`, `UNKNOWN`.
- SMS `marketingState` is similar but SMS-specific — discover before relying on it.

## Segment query language (high level)

The `Segment.query` string uses Shopify's **segment query language** (a ShopifyQL
dialect) — distinct from the `customers` `query:` search syntax. Examples:

```text
customer_tags CONTAINS 'vip'
number_of_orders > 5
amount_spent >= 500
last_order_date > -30d
products_purchased(product_id: 1234567890)
customer_tags CONTAINS 'vip' AND number_of_orders >= 3
```

Operators include `AND`, `OR`, comparison (`> >= < <= = !=`), `CONTAINS`,
`BETWEEN`, and relative dates (`-30d`). The available filter names and functions
are large and version-specific — do not memorize. Discover and read live docs:

- Build/iterate a query in the admin Segments editor, then read it back with
  `shopi read segment --id <gid> --select 'id name query'`.
- Confirm the create contract: `shopi ops show segmentCreate --kind mutation`.
- Live reference: shopify.dev → "Customer segments" / segment query language.

## Scopes (typical)

- Read: `read_customers`. Companies also need `read_companies`.
- Write: `write_customers`. Companies also need `write_companies`.
- Erasure: `write_customer_data_erasure` (and `read_customer_data_erasure`).

`shopi` cannot exceed the app's granted scopes; scope gaps surface as
GraphQL/HTTP errors. See **`shopi-auth-and-profiles`** for scope setup.
