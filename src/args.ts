import type { FlagValue, ParsedArgs } from "./types";

const shortAliases: Record<string, string> = {
  a: "arg",
  f: "file",
  h: "help",
  o: "output",
  p: "profile",
  q: "query",
  v: "verbose",
  y: "confirm"
};

const booleanFlags = new Set([
  "api-debug",
  "confirm",
  "dry-run",
  "full",
  "help",
  "json",
  "local",
  "markdown",
  "no-cache",
  "pretty",
  "refresh",
  "table",
  "validate",
  "verbose",
  "version"
]);

const repeatableFlags = new Set(["arg", "header", "scope"]);

export function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const equalsIndex = withoutPrefix.indexOf("=");
      const rawKey =
        equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;
      const key = normalizeFlagName(rawKey);

      if (key.startsWith("no-")) {
        setFlag(flags, key.slice(3), false);
        continue;
      }

      if (equalsIndex >= 0) {
        setFlag(flags, key, withoutPrefix.slice(equalsIndex + 1));
        continue;
      }

      if (booleanFlags.has(key)) {
        setFlag(flags, key, true);
        continue;
      }

      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        setFlag(flags, key, true);
        continue;
      }

      setFlag(flags, key, next);
      index += 1;
      continue;
    }

    if (token.startsWith("-") && token !== "-") {
      const compact = token.slice(1);
      if (compact.length > 1 && !compact.includes("=")) {
        for (const letter of compact) {
          setFlag(flags, shortAliases[letter] ?? letter, true);
        }
        continue;
      }

      const [rawKey, inlineValue] = compact.split("=", 2);
      const key = shortAliases[rawKey ?? ""] ?? rawKey;
      if (!key) {
        continue;
      }

      if (inlineValue !== undefined) {
        setFlag(flags, key, inlineValue);
        continue;
      }

      if (booleanFlags.has(key)) {
        setFlag(flags, key, true);
        continue;
      }

      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        setFlag(flags, key, true);
        continue;
      }

      setFlag(flags, key, next);
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}

export function getFlag(
  flags: Record<string, FlagValue>,
  key: string
): string | undefined {
  const value = flags[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return undefined;
}

export function getBooleanFlag(
  flags: Record<string, FlagValue>,
  key: string
): boolean {
  return flags[key] === true;
}

export function getRepeatedFlag(
  flags: Record<string, FlagValue>,
  key: string
): string[] {
  const value = flags[key];
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

export function normalizeFlagName(value: string): string {
  return value.trim().replace(/_/g, "-");
}

function setFlag(
  flags: Record<string, FlagValue>,
  key: string,
  value: string | boolean
): void {
  const normalizedKey = normalizeFlagName(key);
  const existing = flags[normalizedKey];
  if (repeatableFlags.has(normalizedKey)) {
    if (Array.isArray(existing)) {
      existing.push(String(value));
    } else if (typeof existing === "string") {
      flags[normalizedKey] = [existing, String(value)];
    } else {
      flags[normalizedKey] = [String(value)];
    }
    return;
  }

  flags[normalizedKey] = value;
}
