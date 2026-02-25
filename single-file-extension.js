#!/usr/bin/env node
/**
 * Claude Bridge — Single File Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Run this inside your VS Code terminal:
 *   node claude-bridge.js
 *
 * Requirements:
 *   npm install ws node-fetch
 *
 * ─── Microsoft / SharePoint (optional) ───────────────────────────────────────
 * Replace these with your Azure App Registration values.
 * Leave them blank to skip Microsoft auth.
 */

const AZURE_CLIENT_ID = '';   // e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
const AZURE_TENANT_ID = '';   // e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

// ─── Ports ────────────────────────────────────────────────────────────────────
const HTTP_PORT = 3333;
const WS_PORT   = 3334;

// ─────────────────────────────────────────────────────────────────────────────
const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');

const GRAPH_BASE    = 'https://graph.microsoft.com/v1.0';
const REDIRECT_URI  = `http://localhost:${HTTP_PORT}/auth/callback`;

let msAccessToken = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonRes(res, code, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ClaudeBridge/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isStr = typeof body === 'string';
    const buf   = isStr ? Buffer.from(body) : body;
    const u     = new URL(url);
    const opts  = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Length': buf.length, ...headers },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

async function graphFetch(apiPath, method = 'GET', body = null) {
  if (!msAccessToken) throw new Error('Not authenticated with Microsoft. Call /auth/login first.');
  const u = new URL(`${GRAPH_BASE}${apiPath}`);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${msAccessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ClaudeBridge/1.0',
      },
    };
    if (body) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      opts.headers['Content-Length'] = buf.length;
      if (Buffer.isBuffer(body)) opts.headers['Content-Type'] = 'application/octet-stream';
    }
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct  = res.headers['content-type'] || '';
        resolve(ct.includes('json') ? JSON.parse(buf.toString()) : buf);
      });
    });
    req.on('error', reject);
    if (body) req.write(Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    req.end();
  });
}

// ─── Open a file or URL in the OS default app ─────────────────────────────────
function openInOS(target) {
  const cmd = process.platform === 'win32' ? `start "" "${target}"`
            : process.platform === 'darwin' ? `open "${target}"`
            : `xdg-open "${target}"`;
  exec(cmd);
}

// ─── Custom actions (hardcoded) ───────────────────────────────────────────────
// These run shell commands — safe to extend.
const CUSTOM_ACTIONS = {
  formatDocument:    () => runShell('npx prettier --write .'),
  saveAll:           () => Promise.resolve('Use Ctrl+K S in VS Code to save all'),
  gitStatus:         () => runShell('git status'),
  gitCommit:         ({ message = 'Claude commit' }) => runShell(`git add -A && git commit -m "${message}"`),
  npmInstall:        () => runShell('npm install'),
  npmTest:           () => runShell('npm test'),
  npmBuild:          () => runShell('npm run build'),
  listFiles:         ({ dir = '.' }) => runShell(`ls -la "${dir}"`),
  showNotification:  ({ text = 'Hello from Claude!' }) => {
    console.log(`\n📢 NOTIFICATION: ${text}\n`);
    return Promise.resolve(text);
  },
};

function runShell(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ─── File helpers (replaces VS Code API) ─────────────────────────────────────
function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

// ─── HTTP Route handlers ──────────────────────────────────────────────────────

async function handleEditorInsert(body, res) {
  if (!body.file && !body.path) return jsonRes(res, 400, { error: 'file or path required' });
  const filePath = path.resolve(body.file || body.path);
  let content = fs.existsSync(filePath) ? readFile(filePath) : '';
  if (body.line != null) {
    const lines = content.split('\n');
    lines.splice(body.line, 0, body.text || '');
    content = lines.join('\n');
  } else {
    content += (body.text || '');
  }
  writeFile(filePath, content);
  jsonRes(res, 200, { ok: true, file: filePath });
}

async function handleEditorReplace(body, res) {
  if (!body.file && !body.path) return jsonRes(res, 400, { error: 'file or path required' });
  const filePath = path.resolve(body.file || body.path);
  writeFile(filePath, body.text || '');
  jsonRes(res, 200, { ok: true, file: filePath });
}

async function handleEditorOpen(body, res) {
  if (!body.path) return jsonRes(res, 400, { error: 'path required' });
  const filePath = path.resolve(body.path);
  // Open in VS Code if it's running, fallback to OS default
  exec(`code "${filePath}"`, err => {
    if (err) openInOS(filePath);
  });
  jsonRes(res, 200, { ok: true, path: filePath });
}

async function handleEditorContent(query, res) {
  const filePath = query.get('file') || query.get('path');
  if (!filePath) return jsonRes(res, 400, { error: 'file query param required' });
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return jsonRes(res, 404, { error: 'File not found' });
  jsonRes(res, 200, { content: readFile(resolved), file: resolved });
}

async function handleTerminalRun(body, res) {
  if (!body.command) return jsonRes(res, 400, { error: 'command required' });
  try {
    const output = await runShell(body.command);
    jsonRes(res, 200, { ok: true, output });
  } catch (e) {
    jsonRes(res, 500, { error: e.message });
  }
}

async function handleActionRun(body, res) {
  const fn = CUSTOM_ACTIONS[body.action];
  if (!fn) return jsonRes(res, 404, { error: `Unknown action: ${body.action}`, available: Object.keys(CUSTOM_ACTIONS) });
  try {
    const result = await fn(body.args || {});
    jsonRes(res, 200, { ok: true, result });
  } catch (e) {
    jsonRes(res, 500, { error: e.message });
  }
}

function handleActionsList(res) {
  jsonRes(res, 200, { actions: Object.keys(CUSTOM_ACTIONS) });
}

// ─── Microsoft Auth ───────────────────────────────────────────────────────────
function handleAuthLogin(res) {
  if (!AZURE_CLIENT_ID) return jsonRes(res, 501, { error: 'Azure credentials not configured in claude-bridge.js' });
  const params = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'Files.ReadWrite.All Sites.ReadWrite.All offline_access',
    response_mode: 'query',
  });
  const authUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize?${params}`;
  res.writeHead(302, { Location: authUrl });
  res.end();
}

async function handleAuthCallback(query, res) {
  const code = query.get('code');
  if (!code) return jsonRes(res, 400, { error: 'No code in callback' });
  try {
    const body = new URLSearchParams({
      client_id: AZURE_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      scope: 'Files.ReadWrite.All Sites.ReadWrite.All offline_access',
    }).toString();
    const raw = await httpsPost(
      `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    const data = JSON.parse(raw.toString());
    if (data.access_token) {
      msAccessToken = data.access_token;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2 style="font-family:sans-serif">✅ Authenticated with Microsoft! You can close this tab.</h2>');
      console.log('✅ Microsoft authentication successful!');
    } else {
      jsonRes(res, 400, { error: data.error_description || 'Auth failed' });
    }
  } catch (e) {
    jsonRes(res, 500, { error: e.message });
  }
}

async function handleSharePointFiles(query, res) {
  const siteId   = query.get('siteId') || 'root';
  const folderId = query.get('folderId');
  const apiPath  = folderId
    ? `/sites/${siteId}/drive/items/${folderId}/children`
    : `/sites/${siteId}/drive/root/children`;
  try {
    const data = await graphFetch(apiPath);
    jsonRes(res, 200, data);
  } catch (e) { jsonRes(res, 500, { error: e.message }); }
}

async function handleSharePointOpen(body, res) {
  const siteId = body.siteId || 'root';
  try {
    const buf = await graphFetch(`/sites/${siteId}/drive/items/${body.itemId}/content`);
    const tmpPath = path.join(os.tmpdir(), body.fileName || 'sharepoint-file');
    fs.writeFileSync(tmpPath, buf);
    exec(`code "${tmpPath}"`, err => { if (err) openInOS(tmpPath); });
    jsonRes(res, 200, { ok: true, tmpPath });
  } catch (e) { jsonRes(res, 500, { error: e.message }); }
}

async function handleSharePointUpload(body, res) {
  const siteId   = body.siteId || 'root';
  const fileName = body.fileName;
  const folderId = body.folderId;
  const uploadPath = folderId
    ? `/sites/${siteId}/drive/items/${folderId}:/${fileName}:/content`
    : `/sites/${siteId}/drive/root:/${fileName}:/content`;
  try {
    const content = Buffer.from(body.content || '', body.encoding === 'base64' ? 'base64' : 'utf8');
    const data = await graphFetch(uploadPath, 'PUT', content);
    jsonRes(res, 200, { ok: true, item: data });
  } catch (e) { jsonRes(res, 500, { error: e.message }); }
}

async function handleGraphQuery(body, res) {
  try {
    const data = await graphFetch(body.path, body.method || 'GET', body.body || null);
    jsonRes(res, 200, { ok: true, data });
  } catch (e) { jsonRes(res, 500, { error: e.message }); }
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  const parsed   = new URL(req.url, `http://localhost`);
  const pathname = parsed.pathname;
  const query    = parsed.searchParams;
  const method   = req.method;

  console.log(`${method} ${pathname}`);

  try {
    if (method === 'POST' && pathname === '/editor/insert')      return handleEditorInsert(await readBody(req), res);
    if (method === 'POST' && pathname === '/editor/replace')     return handleEditorReplace(await readBody(req), res);
    if (method === 'POST' && pathname === '/editor/open')        return handleEditorOpen(await readBody(req), res);
    if (method === 'GET'  && pathname === '/editor/content')     return handleEditorContent(query, res);
    if (method === 'POST' && pathname === '/terminal/run')       return handleTerminalRun(await readBody(req), res);
    if (method === 'POST' && pathname === '/actions/run')        return handleActionRun(await readBody(req), res);
    if (method === 'GET'  && pathname === '/actions/list')       return handleActionsList(res);
    if (method === 'GET'  && pathname === '/auth/login')         return handleAuthLogin(res);
    if (method === 'GET'  && pathname === '/auth/callback')      return handleAuthCallback(query, res);
    if (method === 'GET'  && pathname === '/sharepoint/files')   return handleSharePointFiles(query, res);
    if (method === 'POST' && pathname === '/sharepoint/open')    return handleSharePointOpen(await readBody(req), res);
    if (method === 'POST' && pathname === '/sharepoint/upload')  return handleSharePointUpload(await readBody(req), res);
    if (method === 'POST' && pathname === '/sharepoint/query')   return handleGraphQuery(await readBody(req), res);
    if (pathname === '/ping') return jsonRes(res, 200, { pong: true, auth: !!msAccessToken, cwd: process.cwd() });
    jsonRes(res, 404, { error: 'Not found' });
  } catch (e) {
    jsonRes(res, 500, { error: e.message });
  }
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', socket => {
  console.log('🔌 WebSocket client connected');
  socket.send(JSON.stringify({ event: 'connected', message: 'Claude Bridge ready' }));

  socket.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const reply = data => socket.send(JSON.stringify({ id: msg.id, ...data }));

    try {
      switch (msg.type) {
        case 'editor.content': {
          const fp = path.resolve(msg.file || '.');
          reply({ ok: true, content: fs.existsSync(fp) ? readFile(fp) : null, file: fp });
          break;
        }
        case 'editor.insert': {
          const fp = path.resolve(msg.file || '.');
          let content = fs.existsSync(fp) ? readFile(fp) : '';
          content += (msg.text || '');
          writeFile(fp, content);
          reply({ ok: true });
          break;
        }
        case 'terminal.run': {
          const output = await runShell(msg.command);
          reply({ ok: true, output });
          break;
        }
        case 'action.run': {
          const fn = CUSTOM_ACTIONS[msg.action];
          if (!fn) return reply({ error: `Unknown action: ${msg.action}` });
          reply({ ok: true, result: await fn(msg.args || {}) });
          break;
        }
        case 'sharepoint.files': {
          const data = await graphFetch(`/sites/${msg.siteId || 'root'}/drive/root/children`);
          reply({ ok: true, data });
          break;
        }
        default:
          reply({ error: `Unknown type: ${msg.type}` });
      }
    } catch (e) {
      reply({ error: e.message });
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║       Claude Bridge — Running          ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  HTTP  →  http://localhost:${HTTP_PORT}       ║`);
  console.log(`║  WS    →  ws://localhost:${WS_PORT}         ║`);
  console.log(`║  CWD   →  ${process.cwd().slice(0, 28).padEnd(28)} ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log('║  Endpoints:                            ║');
  console.log('║  GET  /ping                            ║');
  console.log('║  GET  /editor/content?file=path        ║');
  console.log('║  POST /editor/insert   { file, text }  ║');
  console.log('║  POST /editor/replace  { file, text }  ║');
  console.log('║  POST /editor/open     { path }        ║');
  console.log('║  POST /terminal/run    { command }     ║');
  console.log('║  GET  /actions/list                    ║');
  console.log('║  POST /actions/run     { action,args } ║');
  console.log('║  GET  /auth/login   (Microsoft SSO)    ║');
  console.log('║  GET  /sharepoint/files?siteId=...     ║');
  console.log('║  POST /sharepoint/upload               ║');
  console.log('║  POST /sharepoint/open                 ║');
  console.log('║  POST /sharepoint/query  (Graph API)   ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  if (!AZURE_CLIENT_ID) {
    console.log('⚠️  SharePoint: Add AZURE_CLIENT_ID + AZURE_TENANT_ID to enable Microsoft auth.');
    console.log('');
  }
});
