import { ShopiError } from "./errors";
import type { GraphQLResponse } from "./types";

export interface ShopifyClientOptions {
  profile: { shop: string; token: string; apiVersion: string };
  debug?: boolean;
  fetchImpl?: typeof fetch;
  stderr?: NodeJS.WriteStream;
}

export class ShopifyAdminClient {
  readonly shop: string;
  readonly apiVersion: string;
  private readonly token: string;
  private readonly debug: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly stderr: NodeJS.WriteStream;

  constructor(options: ShopifyClientOptions) {
    this.shop = options.profile.shop;
    this.token = options.profile.token;
    this.apiVersion = options.profile.apiVersion;
    this.debug = options.debug ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.stderr = options.stderr ?? process.stderr;
  }

  endpoint(): string {
    return `https://${this.shop}/admin/api/${this.apiVersion}/graphql.json`;
  }

  async request<TData = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<TData>> {
    const startedAt = Date.now();
    const response = await this.fetchImpl(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.token,
        "User-Agent": `shopi-cli/0.1.0 (${this.apiVersion})`
      },
      body: JSON.stringify({ query, variables: variables ?? {} })
    });
    const text = await response.text();
    const duration = Date.now() - startedAt;

    if (this.debug) {
      this.stderr.write(
        `[shopi] POST ${this.endpoint()} -> ${response.status} ${response.statusText} (${duration}ms)\n`
      );
    }

    let payload: GraphQLResponse<TData> | undefined;
    try {
      payload = text ? (JSON.parse(text) as GraphQLResponse<TData>) : {};
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      throw new ShopiError(
        `Shopify Admin API request failed: ${response.status} ${response.statusText}`,
        response.status >= 500 ? 2 : 1,
        payload ?? text
      );
    }

    if (!payload) {
      throw new ShopiError("Shopify Admin API returned invalid JSON.", 1, text);
    }

    if (payload.errors && payload.errors.length > 0) {
      throw new ShopiError(
        `GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`,
        1,
        payload
      );
    }

    return payload;
  }
}

export const SHOP_STATUS_QUERY = `query ShopiShopStatus {
  shop {
    name
    myshopifyDomain
    primaryDomain {
      host
    }
    plan {
      publicDisplayName
    }
  }
}`;
