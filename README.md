# Claude Bridge

A local HTTP + WebSocket server that gives Claude structured access to your filesystem, shell, and Microsoft 365.

```
┌─────────────────────────────────────┐
│  Claude (AI agent)                  │
│    tool_use: POST /editor/replace   │
└──────────────────┬──────────────────┘
                   │ HTTP / WebSocket
                   ▼
┌─────────────────────────────────────┐
│  Claude Bridge  (this server)       │
│    • reads / writes local files     │
│    • runs shell commands            │
│    • calls Microsoft Graph API      │
└──────────┬──────────────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
Filesystem    SharePoint /
+ Shell       Microsoft 365
```

The server runs where your files are — Claude gets direct access without uploading your code anywhere.

---

## Quick Start

**Prerequisites:** Node.js 22+

```bash
npm install
cp config.example.json config.json
npm run dev
```

```bash
curl http://localhost:3333/ping
# → { "pong": true, "auth": false, "cwd": "/your/project" }
```

| Protocol  | Default port | Purpose                       |
|-----------|-------------|-------------------------------|
| HTTP      | 3333        | REST API                      |
| WebSocket | 3334        | Streaming / event-driven      |

---

## Configuration

Copy `config.example.json` → `config.json` (gitignored).

| Field            | Default          | Description                                    |
|------------------|------------------|------------------------------------------------|
| `host`           | `127.0.0.1`      | Bind address (`0.0.0.0` for Docker)            |
| `httpPort`       | `3333`           | HTTP port                                      |
| `wsPort`         | `3334`           | WebSocket port                                 |
| `logLevel`       | `info`           | `trace` / `debug` / `info` / `warn` / `error` |
| `pluginsDir`     | `./plugins`      | Directory scanned for plugin `.js` files       |
| `tokenStorePath` | `./.tokens.json` | Where Microsoft auth tokens are persisted      |
| `azure.clientId` | `""`             | Azure App Registration client ID               |
| `azure.tenantId` | `""`             | Azure tenant ID                                |

---

## API

### Health
`GET /ping` — returns `{ pong, auth, cwd }`

### Editor
| Method | Path              | Body / Query         | Description           |
|--------|-------------------|----------------------|-----------------------|
| `GET`  | `/editor/content` | `?file=<path>`       | Read a file           |
| `POST` | `/editor/replace` | `{ file, text }`     | Overwrite a file      |
| `POST` | `/editor/insert`  | `{ file, text, line? }` | Append or insert   |
| `POST` | `/editor/open`    | `{ path }`           | Open in VS Code       |

### Terminal
`POST /terminal/run` — `{ command }` → runs in shell, returns stdout

### Actions
`GET /actions/list` — list all registered actions
`POST /actions/run` — `{ action, args? }` → run a named action

**Built-in actions:** `formatDocument`, `saveAll`, `gitStatus`, `gitCommit`, `npmInstall`, `npmTest`, `npmBuild`, `listFiles`, `showNotification`

### Microsoft / SharePoint
| Method | Path                 | Description                           |
|--------|----------------------|---------------------------------------|
| `GET`  | `/auth/login`        | Redirect to Microsoft login           |
| `GET`  | `/auth/callback`     | OAuth2 callback                       |
| `GET`  | `/sharepoint/files`  | List files in a SharePoint drive      |
| `POST` | `/sharepoint/open`   | Download a SharePoint file to temp    |
| `POST` | `/sharepoint/upload` | Upload content to SharePoint          |
| `POST` | `/sharepoint/query`  | Raw Microsoft Graph API call          |

---

## WebSocket

Connect to `ws://localhost:3334`. Send JSON with an `id` for correlation:

```json
{ "id": "1", "type": "editor.content", "file": "./src/index.ts" }
```

```json
{ "id": "1", "ok": true, "content": "...", "file": "/abs/path/src/index.ts" }
```

**Message types:** `editor.content`, `editor.insert`, `terminal.run`, `action.run`, `sharepoint.files`

---

## Plugins

Drop a `.js` file in `plugins/` and restart. Same-name plugins override built-ins.

```js
// plugins/my-actions.plugin.js
module.exports = {
  name: 'my-actions',
  actions: {
    deployStaging: async () => require('child_process').execSync('npm run deploy:staging').toString(),
  },
};
```

---

## Microsoft / SharePoint Setup

**Prerequisite:** [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)

```bash
npm run setup:azure
```

The wizard creates an Azure App Registration, grants Graph permissions, and writes credentials into `config.json`. Then authenticate once:

```bash
npm run dev
open http://localhost:3333/auth/login
```

Your token is saved to `tokenStorePath` and reloaded on restart.

---

## Docker

```bash
docker compose up --build
```

The server guides you through remaining setup at the terminal. If SharePoint isn't configured, it prints the exact command to run next. No files to create beforehand.

```bash
docker compose --profile setup run --rm setup   # Azure setup (no host CLI needed)
docker compose restart claude-bridge            # reload after config changes
docker compose down -v                          # full reset
```

**Volumes:** `bridge-data` (config + tokens, shared by both services) · `azure-setup-creds` (Azure CLI login, setup only)

---

## Development

```bash
npm run dev          # run with tsx (no compile step)
npm run build        # compile TypeScript → dist/
npm start            # run compiled output
npm test             # vitest
npm run setup:azure  # Azure App Registration wizard
```

```
src/
├── index.ts        entry point
├── config.ts       zod schema + loader
├── app.ts          Fastify factory
├── wsServer.ts     WebSocket server
├── actions/        registry, builtins, plugin loader
├── auth/           Microsoft OAuth2 + token store
├── graph/          Microsoft Graph client
└── routes/         editor, terminal, actions, auth, sharepoint
```

---

## Security

- Binds to `127.0.0.1` by default — not reachable from other machines.
- `/terminal/run` runs arbitrary shell commands. Do not expose publicly.
- `config.json` and `.tokens.json` are gitignored.
- Docker image runs as a non-root user.
