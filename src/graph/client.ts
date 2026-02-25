import https from 'https';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export function createGraphClient(getToken: () => string | null) {
  function graphFetch(apiPath: string, method = 'GET', body: Buffer | object | null = null): Promise<object | Buffer> {
    const token = getToken();
    if (!token) throw new Error('Not authenticated with Microsoft. Call /auth/login first.');

    const u = new URL(`${GRAPH_BASE}${apiPath}`);
    return new Promise((resolve, reject) => {
      const opts: https.RequestOptions = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ClaudeBridge/1.0',
        },
      };

      if (body) {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
        (opts.headers as Record<string, string | number>)['Content-Length'] = buf.length;
        if (Buffer.isBuffer(body)) {
          (opts.headers as Record<string, string>)['Content-Type'] = 'application/octet-stream';
        }
      }

      const req = https.request(opts, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ct = res.headers['content-type'] || '';
          resolve(ct.includes('json') ? JSON.parse(buf.toString()) : buf);
        });
      });

      req.on('error', reject);
      if (body) req.write(Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
      req.end();
    });
  }

  return { graphFetch };
}

export type GraphClient = ReturnType<typeof createGraphClient>;
