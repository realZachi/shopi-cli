export const VERSION = "0.1.0";
export const DEFAULT_API_VERSION = "2026-04";

export type OutputFormat = "json" | "table" | "markdown";

export interface Profile {
  name: string;
  shop: string;
  token: string;
  apiVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigFile {
  version: 1;
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

export interface ResolvedProfile extends Profile {
  source: "env" | "local" | "global" | "custom";
  configPath?: string;
}

export interface CommandContext {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, FlagValue>;
}

export type FlagValue = string | boolean | string[];

export interface GraphQLResponse<TData = unknown> {
  data?: TData;
  errors?: GraphQLErrorResponse[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLErrorResponse {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}
