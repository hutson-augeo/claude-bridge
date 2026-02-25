import { ActionArgs, ActionHandler, ClaudeBridgePlugin } from '../types/plugin.js';

export class ActionRegistry {
  private actions = new Map<string, ActionHandler>();
  private pluginNames = new Map<string, string>(); // action name → plugin name

  register(plugin: ClaudeBridgePlugin) {
    for (const [name, handler] of Object.entries(plugin.actions)) {
      this.actions.set(name, handler);
      this.pluginNames.set(name, plugin.name);
    }
  }

  list(): string[] {
    return Array.from(this.actions.keys()).sort();
  }

  async run(name: string, args: ActionArgs = {}): Promise<string> {
    const handler = this.actions.get(name);
    if (!handler) {
      throw new Error(`Unknown action: ${name}. Available: ${this.list().join(', ')}`);
    }
    return handler(args);
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }
}
