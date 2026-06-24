import { ShopiError } from "./errors";
import {
  getRootField,
  getType,
  isLeafKind,
  isNonNull,
  namedTypeName,
  typeRefToString,
  unwrapType,
  type IntrospectionField,
  type IntrospectionSchema,
  type IntrospectionType,
  type OperationKind
} from "./schema";

export interface BuildOperationOptions {
  schema: IntrospectionSchema;
  kind: OperationKind;
  fieldName: string;
  args: Record<string, unknown>;
  selection?: string;
  operationName?: string;
}

export interface BuiltOperation {
  query: string;
  variables: Record<string, unknown>;
  field: IntrospectionField;
  selection: string;
}

const preferredScalars = [
  "id",
  "legacyResourceId",
  "title",
  "name",
  "handle",
  "email",
  "status",
  "displayName",
  "createdAt",
  "updatedAt"
];

export function buildOperation(options: BuildOperationOptions): BuiltOperation {
  const field = getRootField(options.schema, options.kind, options.fieldName);
  const knownArgs = new Set(field.args.map((arg) => arg.name));
  const unknownArgs = Object.keys(options.args).filter((arg) => !knownArgs.has(arg));
  if (unknownArgs.length > 0) {
    throw new ShopiError(
      `Unknown argument(s) for ${options.fieldName}: ${unknownArgs.join(", ")}`
    );
  }

  const missingRequired = field.args.filter((arg) => {
    return isNonNull(arg.type) && arg.defaultValue == null && !(arg.name in options.args);
  });
  if (missingRequired.length > 0) {
    throw new ShopiError(
      `Missing required argument(s) for ${options.fieldName}: ${missingRequired
        .map((arg) => `${arg.name}: ${typeRefToString(arg.type)}`)
        .join(", ")}`
    );
  }

  const usedArgs = field.args.filter((arg) => arg.name in options.args);
  const variableDefinitions = usedArgs
    .map((arg) => `$${arg.name}: ${typeRefToString(arg.type)}`)
    .join(", ");
  const invocationArgs = usedArgs.map((arg) => `${arg.name}: $${arg.name}`).join(", ");
  const operationName =
    options.operationName ?? operationNameFor(options.kind, options.fieldName);
  const selection = normalizeSelection(
    options.selection ??
      generateSelectionForType(options.schema, field.type, {
        depth: 0,
        seen: new Set<string>()
      })
  );

  const head = `${options.kind} ${operationName}${
    variableDefinitions ? `(${variableDefinitions})` : ""
  }`;
  const body = `${options.fieldName}${invocationArgs ? `(${invocationArgs})` : ""}${
    selection ? ` ${selection}` : ""
  }`;
  const query = `${head} {\n  ${indent(body, 2)}\n}`;
  const variables = Object.fromEntries(
    usedArgs.map((arg) => [arg.name, options.args[arg.name]])
  );

  return { query, variables, field, selection };
}

export function generateSelectionForType(
  schema: IntrospectionSchema,
  typeRef: IntrospectionField["type"],
  state: { depth: number; seen: Set<string> }
): string {
  const namedRef = unwrapType(typeRef);
  if (isLeafKind(namedRef.kind)) {
    return "";
  }
  const typeName = namedTypeName(namedRef);
  if (state.depth >= 3 || state.seen.has(typeName)) {
    return fallbackSelectionForName(typeName);
  }
  const type = getType(schema, typeName);
  if (!type) {
    return fallbackSelectionForName(typeName);
  }

  const nextState = {
    depth: state.depth + 1,
    seen: new Set([...state.seen, typeName])
  };

  if (isConnectionType(type)) {
    return connectionSelection(schema, type, nextState);
  }

  const fields = type.fields ?? [];
  const selected: string[] = [];

  const userErrorsField = fields.find((field) => field.name === "userErrors");
  if (userErrorsField) {
    selected.push("userErrors { field message }");
  }

  for (const fieldName of preferredScalars) {
    const field = fields.find((candidate) => candidate.name === fieldName);
    if (field && canAutoSelect(field)) {
      selected.push(field.name);
    }
  }

  for (const field of fields) {
    if (selected.length >= 8) {
      break;
    }
    if (selected.includes(field.name) || !canAutoSelect(field)) {
      continue;
    }
    selected.push(field.name);
  }

  if (selected.length < 5) {
    for (const field of fields) {
      if (selected.length >= 7) {
        break;
      }
      if (selected.some((item) => item.startsWith(`${field.name} `))) {
        continue;
      }
      if (field.args.length > 0 || field.name.startsWith("__")) {
        continue;
      }
      const nested = generateNestedField(schema, field, nextState);
      if (nested) {
        selected.push(nested);
      }
    }
  }

  if (selected.length === 0) {
    return fallbackSelectionForName(typeName);
  }

  return `{\n${selected.map((field) => indent(field, 2)).join("\n")}\n}`;
}

export function normalizeSelection(selection: string): string {
  const trimmed = selection.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  return `{\n${indent(trimmed, 2)}\n}`;
}

export function operationNameFor(kind: OperationKind, fieldName: string): string {
  const prefix = kind === "query" ? "ShopiRead" : "ShopiWrite";
  return `${prefix}${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`.replace(
    /[^_0-9A-Za-z]/g,
    ""
  );
}

function connectionSelection(
  schema: IntrospectionSchema,
  type: IntrospectionType,
  state: { depth: number; seen: Set<string> }
): string {
  const fields = type.fields ?? [];
  const nodes = fields.find((field) => field.name === "nodes");
  if (nodes) {
    const nodeSelection = generateSelectionForType(schema, nodes.type, state);
    return `{\n  nodes ${nodeSelection || "{ id }"}\n  pageInfo { hasNextPage endCursor }\n}`;
  }
  const edges = fields.find((field) => field.name === "edges");
  if (edges) {
    return `{\n  edges { node { id } cursor }\n  pageInfo { hasNextPage endCursor }\n}`;
  }
  return "{ nodes { id } }";
}

function generateNestedField(
  schema: IntrospectionSchema,
  field: IntrospectionField,
  state: { depth: number; seen: Set<string> }
): string | undefined {
  const namedRef = unwrapType(field.type);
  if (isLeafKind(namedRef.kind)) {
    return field.name;
  }
  const typeName = namedTypeName(namedRef);
  if (typeName === "PageInfo") {
    return `${field.name} { hasNextPage endCursor }`;
  }
  if (field.name === "userErrors") {
    return `${field.name} { field message }`;
  }
  if (state.depth >= 2) {
    return undefined;
  }
  const nested = generateSelectionForType(schema, field.type, state);
  if (!nested) {
    return undefined;
  }
  return `${field.name} ${nested}`;
}

function canAutoSelect(field: IntrospectionField): boolean {
  if (field.args.length > 0 || field.name.startsWith("__") || field.isDeprecated) {
    return false;
  }
  return isLeafKind(unwrapType(field.type).kind);
}

function isConnectionType(type: IntrospectionType): boolean {
  if (!type.fields) {
    return false;
  }
  return (
    type.name.endsWith("Connection") ||
    type.fields.some((field) => field.name === "nodes") ||
    type.fields.some((field) => field.name === "edges")
  );
}

function fallbackSelectionForName(typeName: string): string {
  if (typeName === "PageInfo") {
    return "{ hasNextPage endCursor }";
  }
  return "{ id }";
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join("\n");
}
