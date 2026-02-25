import { FastifyInstance } from 'fastify';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { GraphClient } from '../graph/client.js';

export async function sharepointRoutes(fastify: FastifyInstance, opts: { graph: GraphClient }) {
  const { graph } = opts;

  fastify.get('/sharepoint/files', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const siteId = query.siteId || 'root';
    const folderId = query.folderId;
    const apiPath = folderId
      ? `/sites/${siteId}/drive/items/${folderId}/children`
      : `/sites/${siteId}/drive/root/children`;
    try {
      return await graph.graphFetch(apiPath);
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  fastify.post('/sharepoint/open', async (req, reply) => {
    const body = req.body as { siteId?: string; itemId?: string; fileName?: string };
    const siteId = body.siteId || 'root';
    try {
      const buf = await graph.graphFetch(`/sites/${siteId}/drive/items/${body.itemId}/content`) as Buffer;
      const tmpPath = path.join(os.tmpdir(), body.fileName || 'sharepoint-file');
      fs.writeFileSync(tmpPath, buf);
      exec(`code "${tmpPath}"`, err => { if (err) { /* fallback silently */ } });
      return { ok: true, tmpPath };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  fastify.post('/sharepoint/upload', async (req, reply) => {
    const body = req.body as { siteId?: string; fileName?: string; folderId?: string; content?: string; encoding?: string };
    const siteId = body.siteId || 'root';
    const fileName = body.fileName;
    const folderId = body.folderId;
    const uploadPath = folderId
      ? `/sites/${siteId}/drive/items/${folderId}:/${fileName}:/content`
      : `/sites/${siteId}/drive/root:/${fileName}:/content`;
    try {
      const content = Buffer.from(body.content || '', body.encoding === 'base64' ? 'base64' : 'utf8');
      const data = await graph.graphFetch(uploadPath, 'PUT', content);
      return { ok: true, item: data };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  fastify.post('/sharepoint/query', async (req, reply) => {
    const body = req.body as { path?: string; method?: string; body?: object };
    try {
      const data = await graph.graphFetch(body.path!, body.method || 'GET', body.body || null);
      return { ok: true, data };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });
}
