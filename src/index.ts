import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildApp } from './app.js';
import { startWsServer } from './wsServer.js';
import { ActionRegistry } from './actions/registry.js';
import { builtinsPlugin } from './actions/builtins.js';
import { loadPlugins } from './actions/loader.js';
import { TokenStore } from './auth/tokenStore.js';
import { MicrosoftAuth } from './auth/microsoft.js';
import { createGraphClient } from './graph/client.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  // --- Actions ---
  const registry = new ActionRegistry();
  registry.register(builtinsPlugin);
  const userPlugins = loadPlugins(config.pluginsDir);
  for (const plugin of userPlugins) {
    registry.register(plugin);
    logger.info(`Loaded plugin: ${plugin.name} (${Object.keys(plugin.actions).length} actions)`);
  }

  // --- Auth ---
  const tokenStore = new TokenStore(config.tokenStorePath);
  const redirectUri = `http://${config.host}:${config.httpPort}/auth/callback`;
  const auth = new MicrosoftAuth(
    { clientId: config.azure.clientId, tenantId: config.azure.tenantId, redirectUri },
    tokenStore
  );

  // --- Graph client ---
  const graph = createGraphClient(() => auth.getAccessToken());

  // --- HTTP (Fastify) ---
  const app = buildApp({ config, registry, auth, graph });
  await app.listen({ port: config.httpPort, host: config.host });

  // --- WebSocket ---
  const wss = startWsServer({ port: config.wsPort, host: config.host, registry, graph, logger });
  logger.info(`WebSocket server listening on ws://${config.host}:${config.wsPort}`);

  // --- Startup summary ---
  const lines = [
    '',
    '╔════════════════════════════════════════╗',
    '║       Claude Bridge — Running          ║',
    '╠════════════════════════════════════════╣',
    `║  HTTP  →  http://localhost:${config.httpPort}       ║`,
    `║  WS    →  ws://localhost:${config.wsPort}         ║`,
    `║  CWD   →  ${process.cwd().slice(0, 28).padEnd(28)} ║`,
    '╠════════════════════════════════════════╣',
    `║  Actions: ${String(registry.list().length).padEnd(29)} ║`,
    `║  Auth:    ${(auth.getAccessToken() ? 'Authenticated' : 'Not authenticated').padEnd(29)} ║`,
    '╚════════════════════════════════════════╝',
    '',
  ];
  lines.forEach(l => process.stdout.write(l + '\n'));

  if (!config.azure.clientId) {
    logger.warn('SharePoint disabled — set azure.clientId + azure.tenantId in config.json to enable.');
  }

  // --- Graceful shutdown ---
  const shutdown = async () => {
    logger.info('Shutting down...');
    wss.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
