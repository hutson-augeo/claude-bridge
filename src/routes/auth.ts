import { FastifyInstance } from 'fastify';
import { MicrosoftAuth } from '../auth/microsoft.js';

export async function authRoutes(fastify: FastifyInstance, opts: { auth: MicrosoftAuth }) {
  const { auth } = opts;

  fastify.get('/auth/login', async (req, reply) => {
    if (!auth.isConfigured()) {
      return reply.status(501).send({ error: 'Azure credentials not configured in config.json' });
    }
    return reply.redirect(auth.buildLoginUrl());
  });

  fastify.get('/auth/callback', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const code = query.code;
    if (!code) return reply.status(400).send({ error: 'No code in callback' });
    try {
      await auth.handleCallback(code);
      fastify.log.info('Microsoft authentication successful');
      return reply
        .type('text/html')
        .send('<h2 style="font-family:sans-serif">✅ Authenticated with Microsoft! You can close this tab.</h2>');
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
