import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ShopiError } from "./errors";
import type { ShopifyAdminClient } from "./client";
import type { CommandContext, ResolvedProfile } from "./types";

export interface IntrospectionSchema {
  queryType: { name: string };
  mutationType?: { name: string } | null;
  types: IntrospectionType[];
}

export interface IntrospectionType {
  kind: TypeKind;
  name: string;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  inputFields?: IntrospectionInputValue[] | null;
  enumValues?: Array<{
    name: string;
    description?: string | null;
    isDeprecated: boolean;
    deprecationReason?: string | null;
  }> | null;
  possibleTypes?: Array<{ name: string; kind: TypeKind }> | null;
}

export interface IntrospectionField {
  name: string;
  description?: string | null;
  args: IntrospectionInputValue[];
  type: TypeRef;
  isDeprecated: boolean;
  deprecationReason?: string | null;
}

export interface IntrospectionInputValue {
  name: string;
  description?: string | null;
  type: TypeRef;
  defaultValue?: string | null;
}

export type TypeKind =
  | "SCALAR"
  | "OBJECT"
  | "INTERFACE"
  | "UNION"
  | "ENUM"
  | "INPUT_OBJECT"
  | "LIST"
  | "NON_NULL";

export interface TypeRef {
  kind: TypeKind;
  name?: string | null;
  ofType?: TypeRef | null;
}

export type OperationKind = "query" | "mutation";

export const INTROSPECTION_QUERY = `query ShopiIntrospection {
  __schema {
    queryType {
      name
    }
    mutationType {
      name
    }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        isDeprecated
        deprecationReason
        args {
          name
          description
          defaultValue
          type {
            ...ShopiTypeRef
          }
        }
        type {
          ...ShopiTypeRef
        }
      }
      inputFields {
        name
        description
        defaultValue
        type {
          ...ShopiTypeRef
        }
      }
      enumValues(includeDeprecated: true) {
        name
        description
        isDeprecated
        deprecationReason
      }
      possibleTypes {
        kind
        name
      }
    }
  }
}

fragment ShopiTypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}`;

export async function getSchema(
  client: ShopifyAdminClient,
  profile: ResolvedProfile,
  context: CommandContext,
  options: { refresh?: boolean } = {}
): Promise<{ schema: IntrospectionSchema; path: string; refreshed: boolean }> {
  const path = schemaCachePath(profile, context);
  if (!options.refresh) {
    const cached = await readCachedSchema(path);
    if (cached) {
      return { schema: cached, path, refreshed: false };
    }
  }
  const schema = await fetchSchema(client);
  await writeCachedSchema(path, schema);
  return { schema, path, refreshed: true };
}

export async function fetchSchema(
  client: ShopifyAdminClient
): Promise<IntrospectionSchema> {
  const response = await client.request<{ __schema: IntrospectionSchema }>(
    INTROSPECTION_QUERY
  );
  const schema = response.data?.__schema;
  if (!schema) {
    throw new ShopiError("Shopify did not return an introspection schema.");
  }
  return schema;
}

export function schemaCachePath(
  profile: Pick<ResolvedProfile, "shop" | "apiVersion">,
  context: Pick<CommandContext, "env" | "cwd">
): string {
  const base =
    context.env.XDG_CACHE_HOME && context.env.XDG_CACHE_HOME.trim()
      ? context.env.XDG_CACHE_HOME
      : join(context.env.HOME ?? homedir(), ".cache");
  const slug = `${profile.shop}-${profile.apiVersion}`.replace(/[^a-z0-9.-]+/gi, "_");
  return join(base, "shopi", `${slug}.schema.json`);
}

export function getType(
  schema: IntrospectionSchema,
  name: string
): IntrospectionType | undefined {
  return schema.types.find((type) => type.name === name);
}

export function rootType(
  schema: IntrospectionSchema,
  kind: OperationKind
): IntrospectionType {
  const name =
    kind === "query" ? schema.queryType.name : schema.mutationType?.name;
  if (!name) {
    throw new ShopiError(`Schema does not expose a ${kind} root.`);
  }
  const type = getType(schema, name);
  if (!type) {
    throw new ShopiError(`Schema root type not found: ${name}`);
  }
  return type;
}

export function getRootField(
  schema: IntrospectionSchema,
  kind: OperationKind,
  fieldName: string
): IntrospectionField {
  const field = rootType(schema, kind).fields?.find(
    (candidate) => candidate.name === fieldName
  );
  if (!field) {
    throw new ShopiError(`Unknown Admin GraphQL ${kind} field: ${fieldName}`);
  }
  return field;
}

export function listRootFields(
  schema: IntrospectionSchema,
  kind: OperationKind
): IntrospectionField[] {
  return [...(rootType(schema, kind).fields ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export function namedTypeName(type: TypeRef): string {
  let current: TypeRef | undefined | null = type;
  while (current) {
    if (current.name) {
      return current.name;
    }
    current = current.ofType;
  }
  throw new ShopiError("Could not resolve GraphQL type name.");
}

export function typeRefToString(type: TypeRef): string {
  if (type.kind === "NON_NULL") {
    if (!type.ofType) {
      throw new ShopiError("Invalid NON_NULL type reference.");
    }
    return `${typeRefToString(type.ofType)}!`;
  }
  if (type.kind === "LIST") {
    if (!type.ofType) {
      throw new ShopiError("Invalid LIST type reference.");
    }
    return `[${typeRefToString(type.ofType)}]`;
  }
  if (!type.name) {
    throw new ShopiError("Invalid named type reference.");
  }
  return type.name;
}

export function isNonNull(type: TypeRef): boolean {
  return type.kind === "NON_NULL";
}

export function unwrapType(type: TypeRef): TypeRef {
  let current = type;
  while (current.kind === "NON_NULL" || current.kind === "LIST") {
    if (!current.ofType) {
      throw new ShopiError("Invalid wrapped GraphQL type reference.");
    }
    current = current.ofType;
  }
  return current;
}

export function isLeafKind(kind: TypeKind): boolean {
  return kind === "SCALAR" || kind === "ENUM";
}

export function describeArgs(args: IntrospectionInputValue[]): string {
  if (args.length === 0) {
    return "";
  }
  return args
    .map((arg) => {
      const defaultValue = arg.defaultValue ? ` = ${arg.defaultValue}` : "";
      return `${arg.name}: ${typeRefToString(arg.type)}${defaultValue}`;
    })
    .join(", ");
}

async function readCachedSchema(
  path: string
): Promise<IntrospectionSchema | undefined> {
  try {
    await stat(path);
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      schema?: IntrospectionSchema;
    };
    return parsed.schema;
  } catch {
    return undefined;
  }
}

async function writeCachedSchema(
  path: string,
  schema: IntrospectionSchema
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), schema }, null, 2)}\n`,
    "utf8"
  );
}
