import { ShopiError } from "./errors";

export interface ClientCredentialsToken {
  accessToken: string;
  scope?: string;
  expiresIn?: number;
}

function normalizeShop(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^admin\.shopify\.com\/store\//, "");
  value = value.replace(/\/.*$/, "");
  if (!value) {
    throw new ShopiError("Shop is required.");
  }
  if (!value.includes(".")) {
    value = `${value}.myshopify.com`;
  }
  if (!/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(value)) {
    throw new ShopiError(`Invalid Shopify shop domain: ${input}`);
  }
  return value;
}

export interface ClientCredentialsOptions {
  shop: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export async function requestClientCredentialsToken(
  options: ClientCredentialsOptions
): Promise<ClientCredentialsToken> {
  const shop = normalizeShop(options.shop);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: options.clientId.trim(),
    client_secret: options.clientSecret.trim()
  });
  const response = await (options.fetchImpl ?? fetch)(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "shopi-cli/0.1.0"
      },
      body
    }
  );
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new ShopiError(
      `Could not obtain Shopify access token: ${response.status} ${response.statusText}`,
      response.status >= 500 ? 2 : 1,
      redactTokenPayload(payload, text)
    );
  }

  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new ShopiError(
      "Shopify token endpoint did not return an access_token.",
      1,
      redactTokenPayload(payload, text)
    );
  }

  const result: ClientCredentialsToken = {
    accessToken: payload.access_token
  };
  if (typeof payload.scope === "string") {
    result.scope = payload.scope;
  }
  if (typeof payload.expires_in === "number") {
    result.expiresIn = payload.expires_in;
  }
  return result;
}

function redactTokenPayload(
  payload: Record<string, unknown>,
  fallback: string
): Record<string, unknown> | string {
  if (!Object.keys(payload).length) {
    return fallback;
  }
  const copy = { ...payload };
  if (typeof copy.access_token === "string") {
    copy.access_token = "[redacted]";
  }
  if (typeof copy.refresh_token === "string") {
    copy.refresh_token = "[redacted]";
  }
  return copy;
}
