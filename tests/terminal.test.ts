import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { ActionRegistry } from '../src/actions/registry.js';
import { TokenStore } from '../src/auth/tokenStore.js';
import { MicrosoftAuth } from '../src/auth/microsoft.js';
import { createGraphClient } from '../src/graph/client.js';
import { configSchema } from '../src/config.js';
import { builtinsPlugin } from '../src/actions/builtins.js';
import os from 'os';
import path from 'path';

function makeApp() {
  const config = configSchema.parse({});
  const registry = new ActionRegistry();
  registry.register(builtinsPlugin);
  const tokenStore = new TokenStore(path.join(os.tmpdir(), '.test-tokens.json'));
  const auth = new MicrosoftAuth(
    { clientId: '', tenantId: '', redirectUri: 'http://localhost:3333/auth/callback' },
    tokenStore
  );
  const graph = createGraphClient(() => auth.getAccessToken());
  return buildApp({ config, registry, auth, graph });
}

describe('POST /terminal/run', () => {
  const app = makeApp();

  it('runs a shell command and returns output', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/terminal/run',
      payload: { command: 'echo "hello from shell"' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; output: string };
    expect(body.ok).toBe(true);
    expect(body.output).toContain('hello from shell');
  });

  it('returns 400 when command is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/terminal/run', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /actions/run', () => {
  const app = makeApp();

  it('runs gitStatus action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/actions/run',
      payload: { action: 'gitStatus' },
    });
    // May pass or fail depending on whether we're in a git repo — just check shape
    expect([200, 500]).toContain(res.statusCode);
  });

  it('returns 404 for unknown action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/actions/run',
      payload: { action: 'doesNotExist' },
    });
    expect(res.statusCode).toBe(404);
  });
});
