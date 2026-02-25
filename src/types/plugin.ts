export type ActionArgs = Record<string, unknown>;
export type ActionHandler = (args: ActionArgs) => Promise<string>;

export interface ClaudeBridgePlugin {
  name: string;
  description?: string;
  actions: Record<string, ActionHandler>;
}
