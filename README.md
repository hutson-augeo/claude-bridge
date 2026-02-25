# Claude Bridge

A local HTTP + WebSocket server that gives Claude (or any AI agent) structured access to your filesystem, shell, and Microsoft 365. Run it alongside your editor or in a Docker container, then point Claude's tool calls at it.

---

## The Strategy

Claude is powerful but sandboxed — it can reason about code but can't directly touch your files or run commands. Claude Bridge solves this by running a small, trusted server on your machine that exposes a well-defined API. Claude calls that API the same way it calls any other tool.

```
┌──────────────────────────────────────────────────────┐
│  Claude (AI agent)                                   │
│    tool_use: POST /editor/replace { file, text }     │
└─────────────────────────┬────────────────────────────┘
                          │ HTTP / WebSocket
                          ▼
┌──────────────────────────────────────────────────────┐
│  Claude Bridge  (this server)                        │
│    • reads / writes files on your machine            │
│    • runs shell commands in your project directory   │
│    • calls Microsoft Graph API on your behalf        │
└─────────────────────────┬────────────────────────────┘
                          │
                  ┌───────┴───────┐
                  ▼               ▼
            Filesystem       SharePoint /
            + Shell          Microsoft 365
```

The key insight is **locality**: the server runs where your files are, so Claude gets low-latency, direct access without uploading your code anywhere.

---

## Quick Start

**Prerequisites:** Node.js 22+

```bash
# 1. Install dependencies
npm install

# 2. Create your config
cp config.example.json config.json

# 3. Start the server
npm run dev
```

The server starts on two ports:

| Protocol  | Default port | Purpose                                  |
|-----------|-------------|------------------------------------------|
| HTTP      | 3333        | REST API (one-shot requests)             |
| WebSocket | 3334        | Streaming / event-driven communication  |

Verify it's up:

```bash
curl http://localhost:3333/ping
# → { "pong": true, "auth": false, "cwd": "/your/project" }
```

---

## Configuration

All settings live in `config.json` (gitignored). Copy `config.example.json` to get started.

| Field            | Default          | Description                                              |
|------------------|------------------|----------------------------------------------------------|
| `host`           | `127.0.0.1`      | Bind address. Set to `0.0.0.0` when running in Docker.  |
| `httpPort`       | `3333`           | HTTP server port                                         |
| `wsPort`         | `3334`           | WebSocket server port                                    |
| `logLevel`       | `info`           | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `pluginsDir`     | `./plugins`      | Directory scanned for plugin `.js` files on startup      |
| `tokenStorePath` | `./.tokens.json` | Where Microsoft auth tokens are persisted               |
| `azure.clientId` | `""`             | Azure App Registration client ID (SharePoint only)       |
| `azure.tenantId` | `""`             | Azure tenant ID (SharePoint only)                        |

---

## API Reference

### Health

| Method | Path    | Description                                        |
|--------|---------|----------------------------------------------------|
| `GET`  | `/ping` | Returns `{ pong, auth, cwd }`. Good for liveness.  |

### Editor (filesystem)

| Method | Path               | Body / Query                          | Description                         |
|--------|--------------------|---------------------------------------|-------------------------------------|
| `GET`  | `/editor/content`  | `?file=<path>`                        | Read a file                         |
| `POST` | `/editor/replace`  | `{ file, text }`                      | Overwrite a file                    |
| `POST` | `/editor/insert`   | `{ file, text, line? }`               | Append or insert at a line          |
| `POST` | `/editor/open`     | `{ path }`                            | Open in VS Code (or OS default)     |

### Terminal

| Method | Path            | Body              | Description                          |
|--------|-----------------|-------------------|--------------------------------------|
| `POST` | `/terminal/run` | `{ command }`     | Run a shell command, return stdout   |

### Actions

| Method | Path             | Body / Query                  | Description                          |
|--------|------------------|-------------------------------|--------------------------------------|
| `GET`  | `/actions/list`  | —                             | List all registered action names     |
| `POST` | `/actions/run`   | `{ action, args? }`           | Run a named action                   |

**Built-in actions:** `formatDocument`, `saveAll`, `gitStatus`, `gitCommit`, `npmInstall`, `npmTest`, `npmBuild`, `listFiles`, `showNotification`

### Microsoft / SharePoint

| Method | Path                  | Description                                         |
|--------|-----------------------|-----------------------------------------------------|
| `GET`  | `/auth/login`         | Redirect to Microsoft login (opens in browser)      |
| `GET`  | `/auth/callback`      | OAuth2 callback — handled automatically             |
| `GET`  | `/sharepoint/files`   | List files in a SharePoint drive                    |
| `POST` | `/sharepoint/open`    | Download a SharePoint file to a temp path and open  |
| `POST` | `/sharepoint/upload`  | Upload content to SharePoint                        |
| `POST` | `/sharepoint/query`   | Raw Microsoft Graph API call                        |

---

## WebSocket

Connect to `ws://localhost:3334`. The server sends a `connected` event immediately, then accepts JSON messages:

```json
{ "id": "1", "type": "editor.content", "file": "./src/index.ts" }
```

Every response echoes the `id` field for correlation:

```json
{ "id": "1", "ok": true, "content": "...", "file": "/abs/path/src/index.ts" }
```

**Message types:** `editor.content`, `editor.insert`, `terminal.run`, `action.run`, `sharepoint.files`

---

## Plugin System

Drop a `.js` file into the `plugins/` directory and restart the server. It will be loaded automatically and its actions merged into the registry. A plugin with the same action name as a built-in will override the built-in.

```js
// plugins/my-actions.plugin.js
/** @type {import('./src/types/plugin').ClaudeBridgePlugin} */
const plugin = {
  name: 'my-actions',
  description: 'Project-specific helpers',
  actions: {
    deployStaging: async () => {
      const { execSync } = require('child_process');
      return execSync('npm run deploy:staging').toString();
    },
    openDocs: async () => {
      require('child_process').exec('open https://docs.example.com');
      return 'opened';
    },
  },
};

module.exports = plugin;
```

Check it loaded:

```bash
curl http://localhost:3333/actions/list
# → { "actions": ["deployStaging", "formatDocument", "gitStatus", ...] }
```

Run it:

```bash
curl -X POST http://localhost:3333/actions/run \
  -H 'Content-Type: application/json' \
  -d '{ "action": "deployStaging" }'
```

---

## Microsoft / SharePoint Setup

1. Register an app in the [Azure portal](https://portal.azure.com) under **App registrations**
2. Add a redirect URI: `http://localhost:3333/auth/callback`
3. Grant API permissions: `Files.ReadWrite.All`, `Sites.ReadWrite.All`
4. Copy the **Client ID** and **Tenant ID** into `config.json`
5. Open `http://localhost:3333/auth/login` in a browser to authenticate

Auth tokens are persisted to `tokenStorePath` and reloaded on restart, so you only need to authenticate once.

---

## Running in Docker

The Docker image builds TypeScript at image-build time and runs the compiled output in a slim Alpine container as a non-root user.

```bash
# 1. Create config — host must be 0.0.0.0 for Docker port mapping to work
cp config.example.json config.json
# Edit config.json: "host": "0.0.0.0"

# 2. Optionally set tokenStorePath to the data volume for persistence
# Edit config.json: "tokenStorePath": "./data/.tokens.json"

# 3. Build and start
docker compose up --build

# 4. Verify
curl http://localhost:3333/ping
```

`docker-compose.yml` mounts:

| Host path    | Container path   | Mode      | Purpose                             |
|--------------|------------------|-----------|-------------------------------------|
| `config.json`| `/app/config.json`| read-only | Runtime configuration               |
| `plugins/`   | `/app/plugins`   | read-only | Plugin `.js` files                  |
| `bridge-data`| `/app/data`      | read-write| Persists auth tokens across restarts|

To rebuild after code changes:

```bash
docker compose up --build --force-recreate
```

---

## Development

```bash
npm run dev        # run with tsx (no compile step)
npm run build      # compile TypeScript → dist/
npm start          # run compiled output
npm test           # run vitest test suite
npm run test:watch # vitest in watch mode
```

### Project Structure

```
src/
├── index.ts              Entry point — wires everything together
├── config.ts             Config schema (zod) + loader
├── app.ts                Fastify factory — registers all routes
├── wsServer.ts           WebSocket server
├── logger.ts             Pino logger (pretty in dev, JSON in prod)
├── shell.ts              runShell utility
├── actions/
│   ├── builtins.ts       Built-in actions (git, npm, etc.)
│   ├── loader.ts         Loads plugin .js files from pluginsDir
│   └── registry.ts       ActionRegistry — merges builtins + plugins
├── auth/
│   ├── microsoft.ts      Microsoft OAuth2 flow
│   └── tokenStore.ts     Token persistence to disk
├── graph/
│   └── client.ts         Microsoft Graph API client
├── routes/
│   ├── editor.ts         /editor/*
│   ├── terminal.ts       /terminal/run
│   ├── actions.ts        /actions/*
│   ├── auth.ts           /auth/*
│   └── sharepoint.ts     /sharepoint/*
└── types/
    ├── config.ts         Config type (inferred from zod schema)
    └── plugin.ts         ClaudeBridgePlugin interface
```

---

## Security Notes

- By default the server binds to `127.0.0.1` — it is **not reachable from other machines** on your network.
- The `/terminal/run` endpoint runs arbitrary shell commands. Do not expose this server publicly.
- `config.json` and `.tokens.json` are gitignored. Keep them out of version control.
- The Docker image runs as a non-root user (`bridge`) with no extra capabilities.
