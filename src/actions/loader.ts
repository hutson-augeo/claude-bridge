import fs from 'fs';
import path from 'path';
import { ClaudeBridgePlugin } from '../types/plugin.js';

export function loadPlugins(pluginsDir: string): ClaudeBridgePlugin[] {
  const resolved = path.resolve(process.cwd(), pluginsDir);
  if (!fs.existsSync(resolved)) return [];

  const plugins: ClaudeBridgePlugin[] = [];
  const files = fs.readdirSync(resolved).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));

  for (const file of files) {
    const filePath = path.join(resolved, file);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(filePath) as { default?: ClaudeBridgePlugin } | ClaudeBridgePlugin;
      const plugin = ('default' in mod ? mod.default : mod) as ClaudeBridgePlugin;
      if (plugin && typeof plugin === 'object' && plugin.name && plugin.actions) {
        plugins.push(plugin);
      } else {
        console.warn(`[plugins] ${file} does not export a valid ClaudeBridgePlugin — skipping`);
      }
    } catch (err) {
      console.warn(`[plugins] Failed to load ${file}:`, (err as Error).message);
    }
  }

  return plugins;
}
