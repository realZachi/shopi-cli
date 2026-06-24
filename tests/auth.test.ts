import { describe, expect, test } from "bun:test";
import { requestClientCredentialsToken } from "../src/auth";
import { resolveProfile } from "../src/config";

describe("client credentials auth", () => {
  test("exchanges client credentials for an access token", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: String(init?.body)
      });
      return new Response(
        JSON.stringify({
          access_token: "shpat_generated",
          scope: "read_products,write_products",
          expires_in: 86399
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const token = await requestClientCredentialsToken({
      shop: "demo",
      clientId: "client-id",
      clientSecret: "secret",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(token).toEqual({
      accessToken: "shpat_generated",
      scope: "read_products,write_products",
      expiresIn: 86399
    });
    expect(requests[0]?.url).toBe(
      "https://demo.myshopify.com/admin/oauth/access_token"
    );
    expect(requests[0]?.body).toContain("grant_type=client_credentials");
    expect(requests[0]?.body).toContain("client_id=client-id");
  });

  test("resolveProfile prefers env client credentials over access token", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "shpat_from_credentials",
          scope: "read_products",
          expires_in: 86399
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as unknown as typeof fetch;

    try {
      const profile = await resolveProfile({
        cwd: process.cwd(),
        env: {
          SHOPIFY_SHOP: "demo.myshopify.com",
          SHOPIFY_CLIENT_ID: "client-id",
          SHOPIFY_CLIENT_SECRET: "secret",
          SHOPIFY_ACCESS_TOKEN: "shpat_fallback"
        }
      });

      expect(profile.token).toBe("shpat_from_credentials");
      expect(profile.authMethod).toBe("client-credentials");
      expect(profile.tokenExpiresIn).toBe(86399);
      expect(profile.tokenScopes).toBe("read_products");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
