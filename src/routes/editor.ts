import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf8');
}

function openInOS(target: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${target}"`
    : process.platform === 'darwin' ? `open "${target}"`
    : `xdg-open "${target}"`;
  exec(cmd);
}

export async function editorRoutes(fastify: FastifyInstance) {
  fastify.get('/editor/content', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const filePath = query.file || query.path;
    if (!filePath) return reply.status(400).send({ error: 'file query param required' });
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return reply.status(404).send({ error: 'File not found' });
    return { content: readFile(resolved), file: resolved };
  });

  fastify.post('/editor/insert', async (req, reply) => {
    const body = req.body as { file?: string; path?: string; text?: string; line?: number };
    const filePath = body.file || body.path;
    if (!filePath) return reply.status(400).send({ error: 'file or path required' });
    const resolved = path.resolve(filePath);
    let content = fs.existsSync(resolved) ? readFile(resolved) : '';
    if (body.line != null) {
      const lines = content.split('\n');
      lines.splice(body.line, 0, body.text || '');
      content = lines.join('\n');
    } else {
      content += (body.text || '');
    }
    writeFile(resolved, content);
    return { ok: true, file: resolved };
  });

  fastify.post('/editor/replace', async (req, reply) => {
    const body = req.body as { file?: string; path?: string; text?: string };
    const filePath = body.file || body.path;
    if (!filePath) return reply.status(400).send({ error: 'file or path required' });
    const resolved = path.resolve(filePath);
    writeFile(resolved, body.text || '');
    return { ok: true, file: resolved };
  });

  fastify.post('/editor/open', async (req, reply) => {
    const body = req.body as { path?: string };
    if (!body.path) return reply.status(400).send({ error: 'path required' });
    const resolved = path.resolve(body.path);
    exec(`code "${resolved}"`, err => {
      if (err) openInOS(resolved);
    });
    return { ok: true, path: resolved };
  });
}
