import * as vscode from "vscode";
import { CodexAgent } from "./agents/codex";
import { FetchCodexTransport } from "./agents/codex-transport";
import { registerCommands } from "./extension/commands";

/** Activate Pairwave and register its initial smoke-test command. */
export function activate(context: vscode.ExtensionContext): void {
  const agent = new CodexAgent({
    configuration: {},
    secrets: context.secrets,
    transport: new FetchCodexTransport(),
  });
  registerCommands(context, agent);
}

export function deactivate(): void {
  // Reserved for provider/session cleanup as the extension grows.
}
