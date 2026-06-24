import type { OutputFormat } from "./types";

export interface OutputOptions {
  format?: OutputFormat;
  pretty?: boolean;
  stdout?: NodeJS.WriteStream;
  isTTY?: boolean;
}

export function inferOutputFormat(options: OutputOptions): OutputFormat {
  if (options.format) {
    return options.format;
  }
  return options.isTTY ? "table" : "json";
}

export function writeOutput(value: unknown, options: OutputOptions = {}): void {
  const stdout = options.stdout ?? process.stdout;
  const format = inferOutputFormat({
    ...options,
    isTTY: options.isTTY ?? Boolean(stdout.isTTY)
  });

  if (format === "json") {
    stdout.write(`${JSON.stringify(value, null, options.pretty ? 2 : 0)}\n`);
    return;
  }

  if (format === "markdown") {
    stdout.write(`${formatMarkdown(value)}\n`);
    return;
  }

  stdout.write(`${formatTable(value)}\n`);
}

export function formatMarkdown(value: unknown): string {
  const rows = rowsFromValue(value);
  if (rows.length === 0) {
    return "_No rows_";
  }
  const columns = columnsFromRows(rows);
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    return `| ${columns.map((column) => cell(row[column])).join(" | ")} |`;
  });
  return [header, divider, ...body].join("\n");
}

export function formatTable(value: unknown): string {
  const rows = rowsFromValue(value);
  if (rows.length === 0) {
    return "No rows";
  }
  const columns = columnsFromRows(rows);
  const widths = columns.map((column) => {
    return Math.max(
      column.length,
      ...rows.map((row) => stripAnsi(cell(row[column])).length)
    );
  });

  const renderRow = (row: Record<string, unknown>): string => {
    return columns
      .map((column, index) => cell(row[column]).padEnd(widths[index] ?? 0))
      .join("  ");
  };

  return [
    columns.map((column, index) => column.padEnd(widths[index] ?? 0)).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(renderRow)
  ].join("\n");
}

export function rowsFromValue(value: unknown): Array<Record<string, unknown>> {
  const unwrapped = unwrapGraphQLData(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map((item) =>
      isObject(item) ? flattenForTable(item) : { value: item }
    );
  }
  if (isConnection(unwrapped)) {
    return rowsFromValue(connectionNodes(unwrapped));
  }
  if (isObject(unwrapped)) {
    const keys = Object.keys(unwrapped);
    if (keys.length === 1) {
      const only = unwrapped[keys[0] as keyof typeof unwrapped];
      if (Array.isArray(only) || isConnection(only)) {
        return rowsFromValue(only);
      }
    }
    return [flattenForTable(unwrapped)];
  }
  if (unwrapped === undefined || unwrapped === null) {
    return [];
  }
  return [{ value: unwrapped }];
}

function unwrapGraphQLData(value: unknown): unknown {
  if (isObject(value) && "data" in value && Object.keys(value).length <= 3) {
    return value.data;
  }
  return value;
}

function columnsFromRows(rows: Array<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columns.add(key);
    }
  }
  return [...columns];
}

function flattenForTable(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isScalar(item)) {
      result[key] = item;
    } else if (isObject(item) && "id" in item && typeof item.id === "string") {
      result[key] = item.id;
    } else {
      result[key] = JSON.stringify(item);
    }
  }
  return result;
}

function cell(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.replace(/\r?\n/g, " ");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConnection(value: unknown): value is Record<string, unknown> {
  return isObject(value) && ("nodes" in value || "edges" in value);
}

function connectionNodes(value: Record<string, unknown>): unknown[] {
  if (Array.isArray(value.nodes)) {
    return value.nodes;
  }
  if (Array.isArray(value.edges)) {
    return value.edges
      .map((edge) =>
        isObject(edge) && "node" in edge ? edge.node : edge
      )
      .filter((edge) => edge !== undefined);
  }
  return [];
}
