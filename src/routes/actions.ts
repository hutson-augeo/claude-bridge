import { FastifyInstance } from 'fastify';
import { ActionRegistry } from '../actions/registry.js';

export async function actionsRoutes(fastify: FastifyInstance, opts: { registry: ActionRegistry }) {
  const { registry } = opts;

  fastify.get('/actions/list', async () => {
    return { actions: registry.list() };
  });

  fastify.post('/actions/run', async (req, reply) => {
    const body = req.body as { action?: string; args?: Record<string, unknown> };
    if (!body.action) return reply.status(400).send({ error: 'action required' });
    try {
      const result = await registry.run(body.action, body.args ?? {});
      return { ok: true, result };
    } catch (e) {
      return reply.status(e instanceof Error && e.message.startsWith('Unknown action') ? 404 : 500)
        .send({ error: (e as Error).message });
    }
  });
}
