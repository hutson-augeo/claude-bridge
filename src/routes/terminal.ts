import { FastifyInstance } from 'fastify';
import { runShell } from '../shell.js';

export async function terminalRoutes(fastify: FastifyInstance) {
  fastify.post('/terminal/run', async (req, reply) => {
    const body = req.body as { command?: string };
    if (!body.command) return reply.status(400).send({ error: 'command required' });
    try {
      const output = await runShell(body.command);
      return { ok: true, output };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
