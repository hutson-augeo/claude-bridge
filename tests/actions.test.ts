import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry } from '../src/actions/registry.js';
import { ClaudeBridgePlugin } from '../src/types/plugin.js';

const mockPlugin: ClaudeBridgePlugin = {
  name: 'test',
  actions: {
    greet: async (args) => `Hello, ${args.name ?? 'world'}!`,
    fail:  async () => { throw new Error('intentional failure'); },
  },
};

describe('ActionRegistry', () => {
  let registry: ActionRegistry;

  beforeEach(() => {
    registry = new ActionRegistry();
    registry.register(mockPlugin);
  });

  it('lists registered actions', () => {
    expect(registry.list()).toContain('greet');
    expect(registry.list()).toContain('fail');
  });

  it('runs a valid action', async () => {
    const result = await registry.run('greet', { name: 'Claude' });
    expect(result).toBe('Hello, Claude!');
  });

  it('uses default args', async () => {
    const result = await registry.run('greet');
    expect(result).toBe('Hello, world!');
  });

  it('throws on unknown action', async () => {
    await expect(registry.run('nonexistent')).rejects.toThrow('Unknown action');
  });

  it('propagates action errors', async () => {
    await expect(registry.run('fail')).rejects.toThrow('intentional failure');
  });

  it('later plugin overrides earlier', () => {
    const override: ClaudeBridgePlugin = {
      name: 'override',
      actions: { greet: async () => 'overridden!' },
    };
    registry.register(override);
    expect(registry.has('greet')).toBe(true);
  });
});
