import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { ActionRegistry } from './actions/registry.js';
import { GraphClient } from './graph/client.js';
import { Logger } from './logger.js';
import { runShell } from './shell.js';

interface WsMessage {
  id?: string;
  type: string;
  file?: string;
  text?: string;
  command?: string;
  action?: string;
  args?: Record<string, unknown>;
  siteId?: string;
}

interface WsServerOptions {
  port: number;
  host: string;
  registry: ActionRegistry;
  graph: GraphClient;
  logger: Logger;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

export function startWsServer(opts: WsServerOptions): WebSocketServer {
  const { port, host, registry, graph, logger } = opts;

  const wss = new WebSocketServer({ port, host });

  wss.on('connection', (socket: WebSocket) => {
    logger.info('WebSocket client connected');
    socket.send(JSON.stringify({ event: 'connected', message: 'Claude Bridge ready' }));

    socket.on('message', async (raw: Buffer) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsMessage;
      } catch {
        return;
      }

      const reply = (data: object) => socket.send(JSON.stringify({ id: msg.id, ...data }));

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
            const output = await runShell(msg.command!);
            reply({ ok: true, output });
            break;
          }
          case 'action.run': {
            const result = await registry.run(msg.action!, msg.args ?? {});
            reply({ ok: true, result });
            break;
          }
          case 'sharepoint.files': {
            const data = await graph.graphFetch(`/sites/${msg.siteId || 'root'}/drive/root/children`);
            reply({ ok: true, data });
            break;
          }
          default:
            reply({ error: `Unknown type: ${msg.type}` });
        }
      } catch (e) {
        reply({ error: (e as Error).message });
      }
    });

    socket.on('close', () => logger.info('WebSocket client disconnected'));
  });

  return wss;
}
