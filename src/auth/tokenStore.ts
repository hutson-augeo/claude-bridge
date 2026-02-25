import fs from 'fs';
import path from 'path';

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export class TokenStore {
  private storePath: string;
  private data: TokenData | null = null;

  constructor(storePath: string) {
    this.storePath = path.resolve(process.cwd(), storePath);
    this.load();
  }

  private load() {
    if (fs.existsSync(this.storePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      } catch {
        this.data = null;
      }
    }
  }

  getAccessToken(): string | null {
    return this.data?.access_token ?? null;
  }

  save(tokens: TokenData) {
    this.data = tokens;
    fs.writeFileSync(this.storePath, JSON.stringify(tokens, null, 2), 'utf8');
  }

  clear() {
    this.data = null;
    if (fs.existsSync(this.storePath)) {
      fs.unlinkSync(this.storePath);
    }
  }
}
