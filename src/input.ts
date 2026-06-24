import { readFile } from "node:fs/promises";
import { ShopiError } from "./errors";
import type { CommandContext, FlagValue } from "./types";

export async function readTextInput(
  value: string | undefined,
  context: CommandContext
): Promise<string | undefined> {
  if (value === undefined) {
    return undefined;
  }
  if (value === "-") {
    return readStdin(context);
  }
  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    if (!filePath) {
      throw new ShopiError("File reference cannot be empty.");
    }
    return readFile(filePath, "utf8");
  }
  return value;
}

export async function parseJsonInput<T = unknown>(
  value: string | undefined,
  context: CommandContext,
  fallback: T
): Promise<T> {
  const text = await readTextInput(value, context);
  if (text === undefined || text.trim() === "") {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ShopiError(
      `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function parseJsonFile<T = unknown>(
  filePath: string | undefined,
  fallback: T
): Promise<T> {
  if (!filePath) {
    return fallback;
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new ShopiError(
      `Could not read JSON file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function readStdin(context: CommandContext): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of context.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseKeyValueFlags(
  values: string[],
  context: CommandContext
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const item of values) {
    const equalsIndex = item.indexOf("=");
    if (equalsIndex <= 0) {
      throw new ShopiError(`Expected --arg name=value, received ${item}`);
    }
    const key = item.slice(0, equalsIndex);
    const rawValue = item.slice(equalsIndex + 1);
    result[key] = await parsePrimitiveOrJson(rawValue, context);
  }
  return result;
}

export async function parsePrimitiveOrJson(
  value: string,
  context: CommandContext
): Promise<unknown> {
  const text = await readTextInput(value, context);
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  return text;
}

export function ensureString(value: FlagValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return undefined;
}
