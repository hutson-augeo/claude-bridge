import { describe, it, expect } from 'vitest';
import { configSchema } from '../src/config.js';

describe('configSchema', () => {
  it('uses defaults when given empty object', () => {
    const result = configSchema.parse({});
    expect(result.host).toBe('127.0.0.1');
    expect(result.httpPort).toBe(3333);
    expect(result.wsPort).toBe(3334);
    expect(result.logLevel).toBe('info');
    expect(result.pluginsDir).toBe('./plugins');
    expect(result.tokenStorePath).toBe('./.tokens.json');
    expect(result.azure.clientId).toBe('');
    expect(result.azure.tenantId).toBe('');
  });

  it('accepts valid overrides', () => {
    const result = configSchema.parse({ httpPort: 4000, logLevel: 'debug' });
    expect(result.httpPort).toBe(4000);
    expect(result.logLevel).toBe('debug');
    expect(result.wsPort).toBe(3334); // default preserved
  });

  it('rejects invalid port', () => {
    expect(() => configSchema.parse({ httpPort: 80 })).toThrow();
  });

  it('rejects invalid logLevel', () => {
    expect(() => configSchema.parse({ logLevel: 'verbose' })).toThrow();
  });
});
