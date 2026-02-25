/**
 * Example Claude Bridge Plugin
 *
 * Copy this file and modify it to add your own actions.
 * Drop it into the `plugins/` directory and restart the server.
 *
 * The plugin must export a default object matching the ClaudeBridgePlugin interface:
 *   { name: string, description?: string, actions: Record<string, (args) => Promise<string>> }
 */

/** @type {import('../src/types/plugin').ClaudeBridgePlugin} */
const plugin = {
  name: 'example',
  description: 'Example plugin demonstrating the plugin API',
  actions: {
    hello: async (args) => {
      const name = args.name ?? 'world';
      return `Hello, ${name}! This is a plugin action.`;
    },

    echoJson: async (args) => {
      return JSON.stringify(args, null, 2);
    },
  },
};

module.exports = plugin;
