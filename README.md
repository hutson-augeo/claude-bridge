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

Claude Bridge can read, write, and search files in SharePoint and OneDrive via the Microsoft Graph API. Setup is two steps: register an Azure app (automated), then sign in once in a browser.

### Automated setup (recommended)

**Prerequisite:** [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`)

```bash
npm run setup:azure
```

The script will:

1. Check that `az` is installed and log you in if needed
2. Look for an existing `Claude Bridge` app registration in your tenant and offer to reuse it
3. Create the app as a public client with `http://localhost:3333/auth/callback` as the redirect URI
4. Grant the required Microsoft Graph delegated permissions: `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `offline_access`
5. Optionally grant admin consent — requires Azure AD Global Admin or Application Admin role. Skip this to let each user consent individually on their first login
6. Write `azure.clientId` and `azure.tenantId` directly into `config.json`

Then authenticate:

```bash
npm run dev
open http://localhost:3333/auth/login   # macOS — or just paste the URL in a browser
```

Sign in with your Microsoft account. The token is saved to `tokenStorePath` and reloaded on restart, so you only need to do this once.

### Manual setup (fallback)

If you prefer the Azure portal or don't have the CLI installed:

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name it `Claude Bridge`, set account type to *Single tenant*
3. Under **Authentication** → **Add a platform** → **Mobile and desktop applications**
   - Redirect URI: `http://localhost:3333/auth/callback`
   - Enable **Allow public client flows**
4. Under **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**
   - Add: `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `offline_access`
   - Optionally click **Grant admin consent for \<tenant\>**
5. Copy the **Application (client) ID** and **Directory (tenant) ID** from the Overview page into `config.json`:

```json
{
  "azure": {
    "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "tenantId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `az` command not found | Azure CLI not installed | [Install Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) — or use `docker compose --profile setup run --rm setup` (no host CLI needed) |
| `az login` opens wrong account | Multiple accounts | `az login` manually, then `az account set --subscription <id>` |
| `/auth/login` returns 501 | `azure.clientId` is empty | Run the setup wizard — startup banner shows the exact command |
| `AADSTS65001` consent required | Permissions not granted | Re-run setup wizard and choose to grant admin consent, or accept the browser consent prompt |
| Token expires mid-session | Access token TTL | Re-open `http://localhost:3333/auth/login` |

---

## Running in Docker

Everything is automated — no files to create, no config to edit before you start.

```bash
docker compose up --build
```

That's it. The container guides you through every remaining step at the terminal.

### What happens on first run

1. **Config is created automatically.** The entrypoint detects the empty data volume and writes `config.json` with Docker-appropriate defaults (`host: 0.0.0.0`, tokens stored in the volume).

2. **The server starts and tells you what to do next.** If SharePoint isn't configured the banner reads:

   ```
   ┌─ SharePoint / OneDrive not configured ─────────────────────┐
   │                                                            │
   │  Run the Azure setup wizard to enable Microsoft 365:      │
   │    docker compose --profile setup run --rm setup          │
   │                                                            │
   └────────────────────────────────────────────────────────────┘
   ```

3. **Run setup in a second terminal** (no Azure CLI needed on your host — it's inside the image):

   ```bash
   docker compose --profile setup run --rm setup
   ```

   Because the container is headless, login uses **device code flow**: the script prints a URL and a short code. Open the URL in any browser, enter the code, and sign in. The script then creates the Azure app registration, grants permissions, and writes the credentials into the shared `bridge-data` volume.

4. **Restart to load the new credentials:**

   ```bash
   docker compose restart claude-bridge
   ```

5. **Sign in.** The banner now reads:

   ```
   ┌─ Sign in to Microsoft ──────────────────────────────────────┐
   │                                                             │
   │  Azure app is configured but no auth token found.          │
   │  Open this URL in your browser to sign in:                 │
   │    http://localhost:3333/auth/login                        │
   │                                                             │
   └─────────────────────────────────────────────────────────────┘
   ```

   Open `http://localhost:3333/auth/login`, sign in once, and the token is saved to the volume — no login needed on future restarts.

### Volumes

Everything persists in Docker-managed named volumes — nothing written to your host directory.

| Volume             | Mount point       | Contents                                     |
|--------------------|-------------------|----------------------------------------------|
| `bridge-data`      | `/app/data`       | `config.json` + auth tokens (shared by both services) |
| `azure-setup-creds`| `/root/.azure`    | Azure CLI login (setup service only)         |

### Useful commands

```bash
docker compose up --build               # start (builds image if needed)
docker compose restart claude-bridge    # reload after config changes
docker compose --profile setup run --rm setup   # run Azure setup wizard
docker compose down -v                  # stop and delete all volumes (full reset)
```

---

## Development

```bash
npm run dev          # run with tsx (no compile step)
npm run build        # compile TypeScript → dist/
npm start            # run compiled output
npm test             # run vitest test suite
npm run test:watch   # vitest in watch mode
npm run setup:azure  # automated Azure app registration
```

### Project Structure

```
scripts/
└── setup-azure.ts        Automated Azure App Registration
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
