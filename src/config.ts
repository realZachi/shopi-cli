import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { requestClientCredentialsToken } from "./auth";
import { ShopiError } from "./errors";
import { DEFAULT_API_VERSION, type ConfigFile, type Profile, type ResolvedProfile } from "./types";

export interface ConfigLocationOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  local?: boolean;
}

export interface ResolveProfileOptions extends ConfigLocationOptions {
  profile?: string;
  apiVersion?: string;
}

export function normalizeShop(input: string): string {
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

export function redactToken(token: string): string {
  if (token.length <= 10) {
    return "********";
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function localConfigPath(cwd: string): string {
  return join(cwd, ".shopi", "config.json");
}

export function globalConfigPath(env: NodeJS.ProcessEnv): string {
  if (env.SHOPI_CONFIG) {
    return env.SHOPI_CONFIG;
  }
  const base =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME
      : join(env.HOME ?? homedir(), ".config");
  return join(base, "shopi", "config.json");
}

export async function resolveConfigPath(
  options: ConfigLocationOptions
): Promise<{ path: string; source: "local" | "global" | "custom" }> {
  if (options.env.SHOPI_CONFIG) {
    return { path: options.env.SHOPI_CONFIG, source: "custom" };
  }
  if (options.local) {
    return { path: localConfigPath(options.cwd), source: "local" };
  }
  const localPath = localConfigPath(options.cwd);
  if (await fileExists(localPath)) {
    return { path: localPath, source: "local" };
  }
  return { path: globalConfigPath(options.env), source: "global" };
}

export async function loadConfig(path: string): Promise<ConfigFile> {
  if (!(await fileExists(path))) {
    return { version: 1, profiles: {} };
  }
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ConfigFile;
    if (parsed.version !== 1 || typeof parsed.profiles !== "object") {
      throw new Error("Unsupported config format.");
    }
    return parsed;
  } catch (error) {
    throw new ShopiError(
      `Could not read config at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function saveConfig(path: string, config: ConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(path, 0o600);
}

export async function upsertProfile(
  options: ConfigLocationOptions & {
    profile: string;
    shop: string;
    token?: string;
    clientId?: string;
    clientSecret?: string;
    apiVersion?: string;
    makeDefault?: boolean;
  }
): Promise<{ configPath: string; profile: Profile; source: "local" | "global" | "custom" }> {
  const hasToken = Boolean(options.token?.trim());
  const hasCredentials = Boolean(options.clientId?.trim() && options.clientSecret?.trim());
  if (!hasToken && !hasCredentials) {
    throw new ShopiError(
      "A profile needs either an access token or a client ID and client secret."
    );
  }
  const resolved = await resolveConfigPath(options);
  const config = await loadConfig(resolved.path);
  const now = new Date().toISOString();
  const existing = config.profiles[options.profile];
  const profile: Profile = {
    name: options.profile,
    shop: normalizeShop(options.shop),
    apiVersion: options.apiVersion ?? existing?.apiVersion ?? DEFAULT_API_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Store exactly one credential kind; never carry a stale token alongside credentials.
    ...(hasCredentials
      ? { clientId: options.clientId!.trim(), clientSecret: options.clientSecret!.trim() }
      : { token: options.token!.trim() })
  };
  config.profiles[options.profile] = profile;
  if (options.makeDefault ?? !config.defaultProfile) {
    config.defaultProfile = options.profile;
  }
  await saveConfig(resolved.path, config);
  return { configPath: resolved.path, profile, source: resolved.source };
}

export async function deleteProfile(
  options: ConfigLocationOptions & { profile: string }
): Promise<{ deleted: boolean; configPath: string }> {
  const resolved = await resolveConfigPath(options);
  const config = await loadConfig(resolved.path);
  const deleted = Boolean(config.profiles[options.profile]);
  delete config.profiles[options.profile];
  if (config.defaultProfile === options.profile) {
    const nextDefault = Object.keys(config.profiles)[0];
    if (nextDefault) {
      config.defaultProfile = nextDefault;
    } else {
      delete config.defaultProfile;
    }
  }
  await saveConfig(resolved.path, config);
  return { deleted, configPath: resolved.path };
}

export async function listProfiles(
  options: ConfigLocationOptions
): Promise<{ configPath: string; source: "local" | "global" | "custom"; config: ConfigFile }> {
  const resolved = await resolveConfigPath(options);
  return {
    configPath: resolved.path,
    source: resolved.source,
    config: await loadConfig(resolved.path)
  };
}

export async function resolveProfile(
  options: ResolveProfileOptions
): Promise<ResolvedProfile> {
  const envShop = options.env.SHOPIFY_SHOP;
  const envToken = options.env.SHOPIFY_ACCESS_TOKEN;
  const envClientId = options.env.SHOPIFY_CLIENT_ID;
  const envClientSecret = options.env.SHOPIFY_CLIENT_SECRET;
  if (!options.profile && envShop && envClientId && envClientSecret) {
    const now = new Date().toISOString();
    const token = await requestClientCredentialsToken({
      shop: envShop,
      clientId: envClientId,
      clientSecret: envClientSecret
    });
    return {
      name: "env",
      shop: normalizeShop(envShop),
      token: token.accessToken,
      apiVersion:
        options.apiVersion ?? options.env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION,
      createdAt: now,
      updatedAt: now,
      source: "env",
      authMethod: "client-credentials",
      ...(token.expiresIn !== undefined ? { tokenExpiresIn: token.expiresIn } : {}),
      ...(token.scope ? { tokenScopes: token.scope } : {})
    };
  }
  if (!options.profile && envShop && envToken) {
    const now = new Date().toISOString();
    return {
      name: "env",
      shop: normalizeShop(envShop),
      token: envToken,
      apiVersion:
        options.apiVersion ?? options.env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION,
      createdAt: now,
      updatedAt: now,
      source: "env",
      authMethod: "access-token"
    };
  }

  const resolved = await resolveConfigPath(options);
  const config = await loadConfig(resolved.path);
  const name = options.profile ?? config.defaultProfile ?? Object.keys(config.profiles)[0];
  if (!name) {
    throw new ShopiError(
      "No Shopify profile configured. Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET, or run `shopi auth login --shop <shop> --token <token>`."
    );
  }
  const profile = config.profiles[name];
  if (!profile) {
    throw new ShopiError(`Profile not found: ${name}`);
  }
  const apiVersion = options.apiVersion ?? profile.apiVersion;

  if (profile.clientId && profile.clientSecret) {
    const token = await requestClientCredentialsToken({
      shop: profile.shop,
      clientId: profile.clientId,
      clientSecret: profile.clientSecret
    });
    return {
      ...profile,
      token: token.accessToken,
      apiVersion,
      source: resolved.source,
      configPath: resolved.path,
      authMethod: "client-credentials",
      ...(token.expiresIn !== undefined ? { tokenExpiresIn: token.expiresIn } : {}),
      ...(token.scope ? { tokenScopes: token.scope } : {})
    };
  }

  if (!profile.token) {
    throw new ShopiError(
      `Profile "${name}" has no credentials. Re-run \`shopi auth login\`.`
    );
  }
  return {
    ...profile,
    token: profile.token,
    apiVersion,
    source: resolved.source,
    configPath: resolved.path,
    authMethod: "access-token"
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
