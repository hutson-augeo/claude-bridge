import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export const configSchema = z.object({
  host: z.string().default('127.0.0.1'),
  httpPort: z.number().int().min(1024).max(65535).default(3333),
  wsPort: z.number().int().min(1024).max(65535).default(3334),
  azure: z.object({
    clientId: z.string().default(''),
    tenantId: z.string().default(''),
  }).default({}),
  pluginsDir: z.string().default('./plugins'),
  tokenStorePath: z.string().default('./.tokens.json'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

// CLAUDE_BRIDGE_CONFIG lets Docker (and the setup script) redirect the config
// file into a named volume without changing the source layout.
const CONFIG_PATH  = process.env.CLAUDE_BRIDGE_CONFIG
  ? path.resolve(process.env.CLAUDE_BRIDGE_CONFIG)
  : path.resolve(process.cwd(), 'config.json');
const EXAMPLE_PATH = path.resolve(process.cwd(), 'config.example.json');

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) {
      fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      console.warn(`[config] config.json not found — copied from config.example.json. Edit it before use.`);
    } else {
      console.warn(`[config] No config.json found — using defaults.`);
      return configSchema.parse({});
    }
  }

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config.json:\n${issues}`);
  }

  return result.data;
}
