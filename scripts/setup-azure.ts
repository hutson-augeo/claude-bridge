#!/usr/bin/env tsx
/**
 * scripts/setup-azure.ts
 *
 * Automates Azure App Registration for Claude Bridge SharePoint access.
 * Requires the Azure CLI (az) to be installed and in PATH.
 *
 * Usage:
 *   npm run setup:azure
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_PATH  = path.resolve(process.cwd(), 'config.json');
const EXAMPLE_PATH = path.resolve(process.cwd(), 'config.example.json');
const APP_NAME     = 'Claude Bridge';

// Microsoft Graph service principal
const GRAPH_API_ID = '00000003-0000-0000-c000-000000000000';

// Delegated permission IDs (from Microsoft Graph permission reference)
const GRAPH_PERMISSIONS = [
  '75359482-378d-4052-8f01-80520e7db3cd=Scope', // Files.ReadWrite.All
  '89fe6a52-be36-487e-b7d8-d061c450a026=Scope', // Sites.ReadWrite.All
  '7427e0e9-2fba-42fe-b0c0-848c9e6a8182=Scope', // offline_access
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runJson<T>(cmd: string): T {
  return JSON.parse(run(cmd)) as T;
}

function loadConfig(): Record<string, unknown> {
  if (fs.existsSync(CONFIG_PATH))  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  if (fs.existsSync(EXAMPLE_PATH)) return JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8')) as Record<string, unknown>;
  return {};
}

function saveConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function step(msg: string) { console.log(`\n${msg}`); }
function ok(msg: string)   { console.log(`  ✓  ${msg}`); }
function warn(msg: string) { console.warn(`  ⚠  ${msg}`); }
function fail(msg: string) { console.error(`  ✗  ${msg}`); }

// Docker containers have /.dockerenv; also respect an explicit env override.
function isInContainer(): boolean {
  return fs.existsSync('/.dockerenv') || process.env.AZURE_DEVICE_CODE_LOGIN === '1';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  Claude Bridge — Azure Setup                 ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const rl = readline.createInterface({ input, output });
  const ask = (q: string) => rl.question(`  ${q} `);

  // ── 1. Check Azure CLI ──────────────────────────────────────────────────────
  step('Checking Azure CLI...');
  try {
    run('az --version');
    ok('Azure CLI found');
  } catch {
    fail('Azure CLI not found.');
    console.error('\n  Install it from: https://learn.microsoft.com/cli/azure/install-azure-cli\n');
    rl.close();
    process.exit(1);
  }

  // ── 2. Ensure logged in ─────────────────────────────────────────────────────
  step('Checking login status...');
  let tenantId: string;
  let userName: string;
  try {
    const account = runJson<{ tenantId: string; user: { name: string } }>('az account show');
    tenantId = account.tenantId;
    userName = account.user.name;
    ok(`Logged in as ${userName}`);
    ok(`Tenant: ${tenantId}`);
  } catch {
    if (isInContainer()) {
      console.log('  Running in a container — using device code login.');
      console.log('  A URL and code will appear below. Open the URL in your browser.\n');
      execSync('az login --use-device-code', { stdio: 'inherit' });
    } else {
      console.log('  Not logged in — opening browser...\n');
      execSync('az login', { stdio: 'inherit' });
    }
    const account = runJson<{ tenantId: string; user: { name: string } }>('az account show');
    tenantId = account.tenantId;
    userName = account.user.name;
    ok(`Logged in as ${userName}`);
  }

  // ── 3. Load config for port ─────────────────────────────────────────────────
  const config = loadConfig();
  const port = (config.httpPort as number | undefined) ?? 3333;
  const redirectUri = `http://localhost:${port}/auth/callback`;

  console.log(`\n  App name:     ${APP_NAME}`);
  console.log(`  Redirect URI: ${redirectUri}`);
  console.log(`  Tenant:       ${tenantId}`);

  const proceed = await ask('\nProceed? (Y/n)');
  if (proceed.toLowerCase() === 'n') {
    console.log('\n  Cancelled.\n');
    rl.close();
    process.exit(0);
  }

  // ── 4. Find or create app registration ─────────────────────────────────────
  step('Checking for existing app registration...');
  let clientId: string;
  let objectId: string;

  interface AppEntry { appId: string; id: string }
  const existing = runJson<AppEntry[]>(
    `az ad app list --display-name "${APP_NAME}" --query "[].{appId:appId,id:id}"`
  );

  if (existing.length > 0) {
    ok(`Found existing app: ${existing[0].appId}`);
    const reuse = await ask('Reuse it? (Y/n)');
    if (reuse.toLowerCase() !== 'n') {
      clientId = existing[0].appId;
      objectId = existing[0].id;
      ok(`Reusing: ${clientId}`);
    } else {
      step('Creating new app registration...');
      const app = runJson<AppEntry>(
        `az ad app create --display-name "${APP_NAME}" --public-client-redirect-uris "${redirectUri}"`
      );
      clientId = app.appId;
      objectId = app.id;
      ok(`Created: ${clientId}`);
    }
  } else {
    step('Creating app registration...');
    const app = runJson<AppEntry>(
      `az ad app create --display-name "${APP_NAME}" --public-client-redirect-uris "${redirectUri}"`
    );
    clientId = app.appId;
    objectId = app.id;
    ok(`Created: ${clientId}`);
  }

  // ── 5. Ensure redirect URI is registered ────────────────────────────────────
  step('Registering redirect URI...');
  run(`az ad app update --id "${objectId}" --public-client-redirect-uris "${redirectUri}"`);
  ok(redirectUri);

  // ── 6. Add Microsoft Graph permissions ─────────────────────────────────────
  step('Adding Microsoft Graph permissions...');
  run(
    `az ad app permission add --id "${objectId}" --api "${GRAPH_API_ID}" --api-permissions ${GRAPH_PERMISSIONS.join(' ')}`
  );
  ok('Files.ReadWrite.All  (delegated)');
  ok('Sites.ReadWrite.All  (delegated)');
  ok('offline_access       (delegated)');

  // ── 7. Optional admin consent ───────────────────────────────────────────────
  step('Admin consent (optional)');
  console.log('  Granting admin consent lets all users in your tenant skip the per-user');
  console.log('  consent prompt. Requires Azure AD Global Admin or Application Admin role.');
  const grantConsent = await ask('Grant admin consent now? (y/N)');
  if (grantConsent.toLowerCase() === 'y') {
    try {
      run(`az ad app permission admin-consent --id "${objectId}"`);
      ok('Admin consent granted');
    } catch {
      warn('Admin consent failed — your account may not have admin rights.');
      warn('Users will be prompted to consent individually on first login.');
    }
  } else {
    ok('Skipped — users will consent on first login');
  }

  // ── 8. Write config.json ────────────────────────────────────────────────────
  step('Updating config.json...');
  const azure = (config.azure ?? {}) as Record<string, string>;
  config.azure = { ...azure, clientId, tenantId };
  saveConfig(config);
  ok('azure.clientId written');
  ok('azure.tenantId written');

  // ── 9. Done ─────────────────────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════╗
║  Setup complete!                             ║
╚══════════════════════════════════════════════╝

  Next steps:

  1. Start (or restart) the server
       npm run dev

  2. Open this URL in your browser to authenticate
       http://localhost:${port}/auth/login

  3. Sign in with your Microsoft account.
     Your token is saved to disk — you won't need
     to log in again after a server restart.
`);

  rl.close();
}

main().catch(err => {
  fail(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
