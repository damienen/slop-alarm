/**
 * Type declarations for build.mjs's pure, exported helpers (the manifest generation and its
 * --prod guards), so test/build-manifest.test.ts can import them under `strict` TypeScript without
 * making the whole package allowJs. build.mjs itself remains the source of truth; keep this in
 * sync if its exported surface changes.
 */

export const PROVIDER_HOSTS: string[];

export function findE2EEnvVars(env: Record<string, string | undefined>): string[];

export function validateProdEnv(env: Record<string, string | undefined>): void;

export function resolveE2EProviderOrigin(raw: string | undefined): string[];

export interface SlopAlarmManifest {
  manifest_version: 3;
  name: string;
  short_name: string;
  version: string;
  description: string;
  icons: Record<number, string>;
  action: { default_popup: string; default_icon: Record<number, string> };
  background: { service_worker: string; type: 'module' };
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  options_page: string;
  commands: Record<string, { suggested_key: { default: string; mac: string }; description: string }>;
  minimum_chrome_version: string;
}

export function buildManifest(opts: { version: string; extraHosts?: string[] }): SlopAlarmManifest;
