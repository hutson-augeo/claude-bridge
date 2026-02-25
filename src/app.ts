import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Config } from './config.js';
import { ActionRegistry } from './actions/registry.js';
import { MicrosoftAuth } from './auth/microsoft.js';
import { GraphClient } from './graph/client.js';
import { editorRoutes } from './routes/editor.js';
import { terminalRoutes } from './routes/terminal.js';
import { actionsRoutes } from './routes/actions.js';
import { authRoutes } from './routes/auth.js';
import { sharepointRoutes } from './routes/sharepoint.js';

interface AppOptions {
  config: Config;
  registry: ActionRegistry;
  auth: MicrosoftAuth;
  graph: GraphClient;
}

export function buildApp(opts: AppOptions) {
  const { config, registry, auth, graph } = opts;

  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  fastify.get('/ping', async () => ({
    pong: true,
    auth: !!auth.getAccessToken(),
    cwd: process.cwd(),
  }));

  fastify.register(editorRoutes);
  fastify.register(terminalRoutes);
  fastify.register(actionsRoutes, { registry });
  fastify.register(authRoutes, { auth });
  fastify.register(sharepointRoutes, { graph });

  return fastify;
}
