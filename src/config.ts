import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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
    token: string;
    apiVersion?: string;
    makeDefault?: boolean;
  }
): Promise<{ configPath: string; profile: Profile; source: "local" | "global" | "custom" }> {
  const resolved = await resolveConfigPath(options);
  const config = await loadConfig(resolved.path);
  const now = new Date().toISOString();
  const existing = config.profiles[options.profile];
  const profile: Profile = {
    name: options.profile,
    shop: normalizeShop(options.shop),
    token: options.token.trim(),
    apiVersion: options.apiVersion ?? existing?.apiVersion ?? DEFAULT_API_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
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
      source: "env"
    };
  }

  const resolved = await resolveConfigPath(options);
  const config = await loadConfig(resolved.path);
  const name = options.profile ?? config.defaultProfile ?? Object.keys(config.profiles)[0];
  if (!name) {
    throw new ShopiError(
      "No Shopify profile configured. Run `shopi auth login --shop <shop> --token <token>` or set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN."
    );
  }
  const profile = config.profiles[name];
  if (!profile) {
    throw new ShopiError(`Profile not found: ${name}`);
  }
  return {
    ...profile,
    apiVersion: options.apiVersion ?? profile.apiVersion,
    source: resolved.source,
    configPath: resolved.path
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
