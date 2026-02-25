import https from 'https';
import { TokenStore } from './tokenStore.js';

interface OAuthConfig {
  clientId: string;
  tenantId: string;
  redirectUri: string;
}

const SCOPE = 'Files.ReadWrite.All Sites.ReadWrite.All offline_access';

export class MicrosoftAuth {
  private config: OAuthConfig;
  private tokenStore: TokenStore;

  constructor(config: OAuthConfig, tokenStore: TokenStore) {
    this.config = config;
    this.tokenStore = tokenStore;
  }

  isConfigured(): boolean {
    return !!(this.config.clientId && this.config.tenantId);
  }

  buildLoginUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: SCOPE,
      response_mode: 'query',
    });
    return `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/authorize?${params}`;
  }

  async handleCallback(code: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      scope: SCOPE,
    }).toString();

    const raw = await this.httpsPost(
      `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );

    const data = JSON.parse(raw.toString()) as Record<string, string>;
    if (!data.access_token) {
      throw new Error(data.error_description || 'Auth failed');
    }

    this.tokenStore.save({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    });
  }

  getAccessToken(): string | null {
    return this.tokenStore.getAccessToken();
  }

  private httpsPost(url: string, body: string, headers: Record<string, string> = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(body);
      const u = new URL(url);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'POST',
          headers: { 'Content-Length': buf.length, ...headers },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      );
      req.on('error', reject);
      req.write(buf);
      req.end();
    });
  }
}
