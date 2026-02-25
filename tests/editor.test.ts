import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { ActionRegistry } from '../src/actions/registry.js';
import { TokenStore } from '../src/auth/tokenStore.js';
import { MicrosoftAuth } from '../src/auth/microsoft.js';
import { createGraphClient } from '../src/graph/client.js';
import { configSchema } from '../src/config.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function makeApp() {
  const config = configSchema.parse({});
  const registry = new ActionRegistry();
  const tokenStore = new TokenStore(path.join(os.tmpdir(), '.test-tokens.json'));
  const auth = new MicrosoftAuth(
    { clientId: '', tenantId: '', redirectUri: 'http://localhost:3333/auth/callback' },
    tokenStore
  );
  const graph = createGraphClient(() => auth.getAccessToken());
  return buildApp({ config, registry, auth, graph });
}

describe('GET /ping', () => {
  it('returns pong', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { pong: boolean };
    expect(body.pong).toBe(true);
  });
});

describe('Editor routes', () => {
  let tmpFile: string;
  const app = makeApp();

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `claude-bridge-test-${Date.now()}.txt`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('POST /editor/replace writes content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/editor/replace',
      payload: { file: tmpFile, text: 'hello world' },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('hello world');
  });

  it('GET /editor/content reads content', async () => {
    fs.writeFileSync(tmpFile, 'test content', 'utf8');
    const res = await app.inject({ method: 'GET', url: `/editor/content?file=${tmpFile}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { content: string };
    expect(body.content).toBe('test content');
  });

  it('GET /editor/content returns 404 for missing file', async () => {
    const res = await app.inject({ method: 'GET', url: '/editor/content?file=/nonexistent/path.txt' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /editor/insert appends text', async () => {
    fs.writeFileSync(tmpFile, 'line1\n', 'utf8');
    await app.inject({
      method: 'POST',
      url: '/editor/insert',
      payload: { file: tmpFile, text: 'line2' },
    });
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('line1\nline2');
  });
});
