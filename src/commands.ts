import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgv, getBooleanFlag, getFlag, getRepeatedFlag } from "./args";
import { ShopifyAdminClient, SHOP_STATUS_QUERY } from "./client";
import {
  deleteProfile,
  listProfiles,
  localConfigPath,
  normalizeShop,
  redactToken,
  resolveProfile,
  upsertProfile
} from "./config";
import { ShopiError } from "./errors";
import {
  parseJsonInput,
  parseKeyValueFlags,
  parsePrimitiveOrJson,
  readStdin,
  readTextInput
} from "./input";
import { buildOperation } from "./operation-builder";
import {
  describeArgs,
  getRootField,
  getSchema,
  getType,
  listRootFields,
  namedTypeName,
  schemaCachePath,
  typeRefToString,
  unwrapType,
  type IntrospectionField,
  type OperationKind
} from "./schema";
import { writeOutput } from "./output";
import {
  DEFAULT_API_VERSION,
  VERSION,
  type CommandContext,
  type FlagValue,
  type OutputFormat,
  type Profile,
  type ResolvedProfile
} from "./types";

export async function run(context: CommandContext): Promise<void> {
  const parsed = parseArgv(context.argv);
  const command = parsed.positionals[0];

  if (
    getBooleanFlag(parsed.flags, "version") ||
    command === "version" ||
    command === "--version"
  ) {
    context.stdout.write(`shopi-cli ${VERSION}\n`);
    return;
  }

  if (!command || command === "help" || getBooleanFlag(parsed.flags, "help")) {
    printHelp(context, parsed.positionals[1]);
    return;
  }

  switch (command) {
    case "auth":
      await handleAuth(context, parsed.positionals.slice(1), parsed.flags);
      return;
    case "gql":
    case "graphql":
      await handleGraphQL(context, parsed.positionals.slice(1), parsed.flags);
      return;
    case "read":
    case "query":
      await handleOperation(context, "query", parsed.positionals.slice(1), parsed.flags);
      return;
    case "write":
    case "mutate":
    case "mutation":
      await handleOperation(context, "mutation", parsed.positionals.slice(1), parsed.flags);
      return;
    case "ops":
    case "operations":
      await handleOperations(context, parsed.positionals.slice(1), parsed.flags);
      return;
    case "schema":
      await handleSchema(context, parsed.positionals.slice(1), parsed.flags);
      return;
    case "docs":
      await handleDocs(context, parsed.positionals.slice(1));
      return;
    case "init":
      await handleInit(context, parsed.flags);
      return;
    default:
      throw new ShopiError(`Unknown command: ${command}. Run \`shopi --help\`.`);
  }
}

async function handleAuth(
  context: CommandContext,
  args: string[],
  flags: Record<string, FlagValue>
): Promise<void> {
  const subcommand = args[0] ?? "status";
  switch (subcommand) {
    case "login": {
      const profileName = getFlag(flags, "profile") ?? "default";
      const shop = getFlag(flags, "shop") ?? context.env.SHOPIFY_SHOP;
      const rawToken =
        getFlag(flags, "token") ??
        (getFlag(flags, "token-file")
          ? `@${getFlag(flags, "token-file")}`
          : context.env.SHOPIFY_ACCESS_TOKEN);
      if (!shop) {
        throw new ShopiError("Missing --shop.");
      }
      const token = (await readTextInput(rawToken, context))?.trim();
      if (!token) {
        throw new ShopiError("Missing --token or SHOPIFY_ACCESS_TOKEN.");
      }
      const saved = await upsertProfile({
        cwd: context.cwd,
        env: context.env,
        local: getBooleanFlag(flags, "local"),
        profile: profileName,
        shop,
        token,
        apiVersion:
          getFlag(flags, "api-version") ??
          context.env.SHOPIFY_API_VERSION ??
          DEFAULT_API_VERSION,
        makeDefault: true
      });
      const result: Record<string, unknown> = {
        profile: saved.profile.name,
        shop: saved.profile.shop,
        apiVersion: saved.profile.apiVersion,
        token: redactToken(saved.profile.token),
        config: saved.configPath,
        source: saved.source
      };
      if (getBooleanFlag(flags, "validate")) {
        const client = new ShopifyAdminClient({
          profile: saved.profile,
          debug: getBooleanFlag(flags, "api-debug"),
          stderr: context.stderr
        });
        result.shopInfo = (await client.request(SHOP_STATUS_QUERY)).data;
      }
      writeOutput(result, outputOptions(context, flags));
      return;
    }
    case "status": {
      const profile = await resolveProfileFromFlags(context, flags);
      const result: Record<string, unknown> = publicProfile(profile);
      if (getBooleanFlag(flags, "validate")) {
        const client = clientForProfile(context, profile, flags);
        result.shopInfo = (await client.request(SHOP_STATUS_QUERY)).data;
      }
      writeOutput(result, outputOptions(context, flags));
      return;
    }
    case "doctor": {
      const profile = await resolveProfileFromFlags(context, flags);
      const checks: Record<string, unknown> = {
        profile: publicProfile(profile),
        endpoint: new ShopifyAdminClient({ profile }).endpoint(),
        configReadable: profile.source === "env" ? true : Boolean(profile.configPath),
        network: "not-run"
      };
      try {
        const client = clientForProfile(context, profile, flags);
        checks.network = {
          ok: true,
          response: (await client.request(SHOP_STATUS_QUERY)).data
        };
      } catch (error) {
        checks.network = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      writeOutput(checks, outputOptions(context, flags));
      return;
    }
    case "profiles":
    case "list": {
      const listed = await listProfiles({
        cwd: context.cwd,
        env: context.env,
        local: getBooleanFlag(flags, "local")
      });
      const rows = Object.values(listed.config.profiles).map((profile) => ({
        name: profile.name,
        default: listed.config.defaultProfile === profile.name,
        shop: profile.shop,
        apiVersion: profile.apiVersion,
        token: redactToken(profile.token),
        updatedAt: profile.updatedAt
      }));
      writeOutput(
        {
          config: listed.configPath,
          source: listed.source,
          profiles: rows
        },
        outputOptions(context, flags)
      );
      return;
    }
    case "logout": {
      const profileName = getFlag(flags, "profile") ?? args[1] ?? "default";
      const deleted = await deleteProfile({
        cwd: context.cwd,
        env: context.env,
        local: getBooleanFlag(flags, "local"),
        profile: profileName
      });
      writeOutput({ profile: profileName, deleted: deleted.deleted, config: deleted.configPath }, outputOptions(context, flags));
      return;
    }
    default:
      throw new ShopiError(`Unknown auth command: ${subcommand}`);
  }
}

async function handleGraphQL(
  context: CommandContext,
  args: string[],
  flags: Record<string, FlagValue>
): Promise<void> {
  const query = await resolveGraphQLDocument(context, args, flags);
  const variables = await parseVariables(context, flags);

  if (getBooleanFlag(flags, "dry-run")) {
    writeOutput({ query, variables }, outputOptions(context, flags));
    return;
  }

  if (looksLikeMutation(query) && !getBooleanFlag(flags, "confirm")) {
    throw new ShopiError(
      "Refusing to run a mutation document without --confirm. Use --dry-run to preview it first."
    );
  }

  const { client } = await resolveClient(context, flags);
  const response = await client.request(query, variables);
  writeOutput(
    getBooleanFlag(flags, "full") ? response : response.data,
    outputOptions(context, flags)
  );
}

async function handleOperation(
  context: CommandContext,
  kind: OperationKind,
  args: string[],
  flags: Record<string, FlagValue>
): Promise<void> {
  const fieldName = args[0];
  if (!fieldName) {
    throw new ShopiError(`Missing ${kind} field name.`);
  }
  const { client, profile } = await resolveClient(context, flags);
  const schemaResult = await getSchema(client, profile, context, {
    refresh: getBooleanFlag(flags, "refresh") || getBooleanFlag(flags, "no-cache")
  });
  const field = getRootField(schemaResult.schema, kind, fieldName);
  const operationArgs = await collectOperationArgs(context, flags, field);
  const selection = getFlag(flags, "select");
  const built = buildOperation({
    schema: schemaResult.schema,
    kind,
    fieldName,
    args: operationArgs,
    ...(selection ? { selection } : {})
  });

  if (getBooleanFlag(flags, "dry-run")) {
    writeOutput(
      {
        query: built.query,
        variables: built.variables,
        schemaCache: schemaResult.path
      },
      outputOptions(context, flags)
    );
    return;
  }

  if (kind === "mutation" && !getBooleanFlag(flags, "confirm")) {
    throw new ShopiError(
      "Refusing to run a write without --confirm. Use --dry-run to preview the generated mutation."
    );
  }

  const response = await client.request(built.query, built.variables);
  writeOutput(
    getBooleanFlag(flags, "full") ? response : response.data,
    outputOptions(context, flags)
  );
}

async function handleOperations(
  context: CommandContext,
  args: string[],
  flags: Record<string, FlagValue>
): Promise<void> {
  const subcommand = args[0] ?? "list";
  const { client, profile } = await resolveClient(context, flags);
  const schemaResult = await getSchema(client, profile, context, {
    refresh: getBooleanFlag(flags, "refresh")
  });
  if (subcommand === "list") {
    const filter = getFlag(flags, "filter")?.toLowerCase();
    const kindFlag = getFlag(flags, "kind");
    const kinds: OperationKind[] =
      kindFlag === "query" || kindFlag === "mutation"
        ? [kindFlag]
        : ["query", "mutation"];
    const rows = kinds.flatMap((kind) =>
      listRootFields(schemaResult.schema, kind)
        .filter((field) => !filter || field.name.toLowerCase().includes(filter))
        .map((field) => ({
          kind,
          name: field.name,
          args: describeArgs(field.args),
          returns: typeRefToString(field.type),
          deprecated: field.isDeprecated,
          description: summarize(field.description)
        }))
    );
    writeOutput(rows, outputOptions(context, flags));
    return;
  }

  if (subcommand === "show") {
    const name = args[1];
    if (!name) {
      throw new ShopiError("Missing operation name.");
    }
    const kindFlag = getFlag(flags, "kind");
    const kinds: OperationKind[] =
      kindFlag === "query" || kindFlag === "mutation"
        ? [kindFlag]
        : ["query", "mutation"];
    const matches = kinds.flatMap((kind) => {
      try {
        const field = getRootField(schemaResult.schema, kind, name);
        return [{ kind, field }];
      } catch {
        return [];
      }
    });
    if (matches.length === 0) {
      throw new ShopiError(`Operation not found: ${name}`);
    }
    writeOutput(
      matches.map(({ kind, field }) => ({
        kind,
        name: field.name,
        description: field.description,
        args: field.args.map((arg) => ({
          name: arg.name,
          type: typeRefToString(arg.type),
          required: arg.type.kind === "NON_NULL",
          defaultValue: arg.defaultValue,
          description: arg.description
        })),
        returns: typeRefToString(field.type),
        returnType: namedTypeName(unwrapType(field.type)),
        deprecated: field.isDeprecated,
        deprecationReason: field.deprecationReason
      })),
      outputOptions(context, flags)
    );
    return;
  }

  throw new ShopiError(`Unknown ops command: ${subcommand}`);
}

async function handleSchema(
  context: CommandContext,
  args: string[],
  flags: Record<string, FlagValue>
): Promise<void> {
  const subcommand = args[0] ?? "pull";
  const profile = await resolveProfileFromFlags(context, flags);
  if (subcommand === "path") {
    writeOutput(
      { path: schemaCachePath(profile, context), profile: profile.name },
      outputOptions(context, flags)
    );
    return;
  }

  const client = clientForProfile(context, profile, flags);
  const schemaResult = await getSchema(client, profile, context, {
    refresh: true
  });
  if (subcommand === "pull") {
    writeOutput(
      {
        path: schemaResult.path,
        refreshed: schemaResult.refreshed,
        types: schemaResult.schema.types.length,
        queryFields: listRootFields(schemaResult.schema, "query").length,
        mutationFields: listRootFields(schemaResult.schema, "mutation").length
      },
      outputOptions(context, flags)
    );
    return;
  }

  if (subcommand === "show") {
    const typeName = args[1] ?? getFlag(flags, "type");
    if (!typeName) {
      throw new ShopiError("Missing type name.");
    }
    const type = getType(schemaResult.schema, typeName);
    if (!type) {
      throw new ShopiError(`Type not found: ${typeName}`);
    }
    writeOutput(type, outputOptions(context, flags));
    return;
  }

  throw new ShopiError(`Unknown schema command: ${subcommand}`);
}

async function handleDocs(context: CommandContext, args: string[]): Promise<void> {
  const topic = args[0] === "show" ? args[1] ?? "reference" : args[0] ?? "reference";
  const docs: Record<string, string> = {
    auth: "AUTHENTICATION.md",
    authentication: "AUTHENTICATION.md",
    commands: "COMMANDS.md",
    reference: "COMMANDS.md",
    use: "USE_CASES.md",
    "use-cases": "USE_CASES.md",
    workflows: "USE_CASES.md"
  };
  const file = docs[topic];
  if (!file) {
    throw new ShopiError(
      `Unknown docs topic: ${topic}. Try auth, commands, or use-cases.`
    );
  }
  const content = await readFile(new URL(`../docs/${file}`, import.meta.url), "utf8");
  context.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
}

async function handleInit(
  context: CommandContext,
  flags: Record<string, FlagValue>
): Promise<void> {
  const shopiDir = join(context.cwd, ".shopi");
  await mkdir(shopiDir, { recursive: true });
  await writeFile(
    join(shopiDir, ".gitignore"),
    "config.json\n*.schema.json\n",
    "utf8"
  );
  await writeFile(
    join(shopiDir, "README.md"),
    [
      "# Local shopi workspace",
      "",
      "This directory is for local Shopify Admin CLI state.",
      "Do not commit config.json because it contains Admin API access tokens.",
      ""
    ].join("\n"),
    "utf8"
  );

  const shop = getFlag(flags, "shop");
  const token = getFlag(flags, "token") ?? context.env.SHOPIFY_ACCESS_TOKEN;
  let profile: Profile | undefined;
  if (shop && token) {
    profile = (
      await upsertProfile({
        cwd: context.cwd,
        env: context.env,
        local: true,
        profile: getFlag(flags, "profile") ?? "default",
        shop,
        token,
        apiVersion:
          getFlag(flags, "api-version") ??
          context.env.SHOPIFY_API_VERSION ??
          DEFAULT_API_VERSION,
        makeDefault: true
      })
    ).profile;
  }
  writeOutput(
    {
      directory: shopiDir,
      config: localConfigPath(context.cwd),
      profile: profile ? publicProfile({ ...profile, source: "local" }) : undefined
    },
    outputOptions(context, flags)
  );
}

async function resolveClient(
  context: CommandContext,
  flags: Record<string, FlagValue>
): Promise<{ profile: ResolvedProfile; client: ShopifyAdminClient }> {
  const profile = await resolveProfileFromFlags(context, flags);
  return { profile, client: clientForProfile(context, profile, flags) };
}

async function resolveProfileFromFlags(
  context: CommandContext,
  flags: Record<string, FlagValue>
): Promise<ResolvedProfile> {
  const profile = getFlag(flags, "profile");
  const apiVersion = getFlag(flags, "api-version");
  return resolveProfile({
    cwd: context.cwd,
    env: context.env,
    local: getBooleanFlag(flags, "local"),
    ...(profile ? { profile } : {}),
    ...(apiVersion ? { apiVersion } : {})
  });
}

function clientForProfile(
  context: CommandContext,
  profile: Pick<Profile, "shop" | "token" | "apiVersion">,
  flags: Record<string, FlagValue>
): ShopifyAdminClient {
  return new ShopifyAdminClient({
    profile,
    debug: getBooleanFlag(flags, "api-debug"),
    stderr: context.stderr
  });
}

async function resolveGraphQLDocument(
  context: CommandContext,
  args: string[],
  flags: Record<string, FlagValue>
): Promise<string> {
  const file = getFlag(flags, "file");
  if (file) {
    return readTextInput(`@${file}`, context).then((value) => value ?? "");
  }

  const queryFlag = getFlag(flags, "query");
  if (queryFlag) {
    return readTextInput(queryFlag, context).then((value) => value ?? "");
  }

  if (args.length > 0) {
    return readTextInput(args.join(" "), context).then((value) => value ?? "");
  }

  if (!context.stdin.isTTY) {
    return readStdin(context);
  }

  throw new ShopiError("Missing GraphQL document. Use --query, --file, or stdin.");
}

async function parseVariables(
  context: CommandContext,
  flags: Record<string, FlagValue>
): Promise<Record<string, unknown>> {
  const variablesInput =
    getFlag(flags, "variables") ??
    getFlag(flags, "vars") ??
    (getFlag(flags, "variables-file")
      ? `@${getFlag(flags, "variables-file")}`
      : undefined);
  return parseJsonInput<Record<string, unknown>>(variablesInput, context, {});
}

async function collectOperationArgs(
  context: CommandContext,
  flags: Record<string, FlagValue>,
  field: IntrospectionField
): Promise<Record<string, unknown>> {
  const fromJson = await parseJsonInput<Record<string, unknown>>(
    getFlag(flags, "args") ?? getFlag(flags, "variables") ?? getFlag(flags, "vars"),
    context,
    {}
  );
  const fromPairs = await parseKeyValueFlags(getRepeatedFlag(flags, "arg"), context);
  const result: Record<string, unknown> = { ...fromJson, ...fromPairs };

  const input = getFlag(flags, "input");
  if (input !== undefined) {
    const candidates = field.args.filter((arg) => {
      const named = namedTypeName(unwrapType(arg.type));
      return named.endsWith("Input") || named.includes("Input");
    });
    const target =
      field.args.find((arg) => arg.name === "input") ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!target) {
      throw new ShopiError(
        "--input can only be used when the operation has one clear input argument. Use --arg name=@file instead."
      );
    }
    result[target.name] = await parseJsonInput(input, context, {});
  }

  for (const arg of field.args) {
    const exact = getFlag(flags, arg.name);
    const kebab = getFlag(flags, camelToKebab(arg.name));
    const value = exact ?? kebab;
    if (value !== undefined && !(arg.name in result)) {
      result[arg.name] = await parsePrimitiveOrJson(value, context);
    }
  }

  return result;
}

function outputOptions(
  context: CommandContext,
  flags: Record<string, FlagValue>
): { format?: OutputFormat; pretty?: boolean; stdout: NodeJS.WriteStream; isTTY: boolean } {
  let format = getFlag(flags, "output") as OutputFormat | undefined;
  if (getBooleanFlag(flags, "json")) {
    format = "json";
  }
  if (getBooleanFlag(flags, "table")) {
    format = "table";
  }
  if (getBooleanFlag(flags, "markdown")) {
    format = "markdown";
  }
  if (format && !["json", "table", "markdown"].includes(format)) {
    throw new ShopiError(`Unsupported output format: ${format}`);
  }
  return {
    ...(format ? { format } : {}),
    pretty: getBooleanFlag(flags, "pretty"),
    stdout: context.stdout,
    isTTY: Boolean(context.stdout.isTTY)
  };
}

function publicProfile(profile: ResolvedProfile | (Profile & { source?: string })): Record<string, unknown> {
  return {
    name: profile.name,
    shop: normalizeShop(profile.shop),
    apiVersion: profile.apiVersion,
    token: redactToken(profile.token),
    source: "source" in profile ? profile.source : undefined,
    config: "configPath" in profile ? profile.configPath : undefined,
    authMethod: "authMethod" in profile ? profile.authMethod : undefined,
    tokenExpiresIn: "tokenExpiresIn" in profile ? profile.tokenExpiresIn : undefined,
    tokenScopes: "tokenScopes" in profile ? profile.tokenScopes : undefined
  };
}

function summarize(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function looksLikeMutation(query: string): boolean {
  return query
    .replace(/#[^\n\r]*/g, "")
    .trimStart()
    .toLowerCase()
    .startsWith("mutation");
}

function printHelp(context: CommandContext, topic?: string): void {
  const helpByTopic: Record<string, string> = {
    auth: `shopi auth

Environment auth:
  export SHOPIFY_SHOP=your-store.myshopify.com
  export SHOPIFY_CLIENT_ID=...
  export SHOPIFY_CLIENT_SECRET=...
  shopi auth status --validate

Commands:
  shopi auth login --shop <shop> --token <token> [--profile default] [--local] [--validate]
  shopi auth status [--validate]
  shopi auth profiles
  shopi auth doctor
  shopi auth logout [--profile default]
`,
    gql: `shopi gql

Run an exact Shopify Admin GraphQL document.

Examples:
  shopi gql --query '{ shop { name } }'
  shopi gql --file examples/shop-info.graphql --output json --pretty
  shopi gql --file mutation.graphql --variables @variables.json
`,
    read: `shopi read

Build and run a QueryRoot field from the live Admin schema.

Examples:
  shopi read products --first 10 --select 'nodes { id title handle }'
  shopi read product --id gid://shopify/Product/123 --output json --pretty
`,
    write: `shopi write

Build and run a Mutation field from the live Admin schema. Requires --confirm.

Examples:
  shopi write productCreate --input @product.json --select 'product { id title } userErrors { field message }' --confirm
  shopi write metafieldsSet --arg metafields=@metafields.json --confirm
`
  };

  if (topic && helpByTopic[topic]) {
    context.stdout.write(helpByTopic[topic]);
    return;
  }

  context.stdout.write(`shopi-cli ${VERSION}

JSON-first Shopify Admin GraphQL CLI for humans, agents, and CI.

Usage:
  export SHOPIFY_SHOP=your-store.myshopify.com
  export SHOPIFY_CLIENT_ID=...
  export SHOPIFY_CLIENT_SECRET=...
  shopi auth login --shop <shop> --token <token> [--validate]
  shopi gql --query '{ shop { name } }'
  shopi read <QueryRoot-field> [--arg name=value] [--select '<selection>']
  shopi write <Mutation-field> --input @input.json --confirm
  shopi ops list [--kind query|mutation] [--filter product]
  shopi schema pull
  shopi docs show commands

Global flags:
  --profile <name>       Config profile to use
  --local                Use ./.shopi/config.json
  --api-version <ver>    Shopify API version, default ${DEFAULT_API_VERSION}
  --output <format>      json, table, or markdown
  --json --table --markdown
  --pretty               Pretty-print JSON
  --api-debug            Print HTTP diagnostics to stderr

Run 'shopi help auth', 'shopi help gql', 'shopi help read', or 'shopi help write' for command examples.
`);
}
