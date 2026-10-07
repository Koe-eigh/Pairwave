import * as vscode from "vscode";
import { CodexAgent } from "./agents/codex";
import { FetchCodexTransport } from "./agents/codex-transport";
import { registerCommands } from "./extension/commands";

/** Activate Pairwave and register its initial smoke-test command. */
export function activate(context: vscode.ExtensionContext): void {
  const transport = new FetchCodexTransport();
  registerCommands(context, {
    name: "codex",
    run(request, options) {
      const settings = vscode.workspace.getConfiguration("pairwave.codex");
      const agent = new CodexAgent({
        configuration: {
          model: settings.get<string>("model", "gpt-4.1"),
          endpoint: settings.get<string>("endpoint", "https://api.openai.com/v1/responses"),
        },
        secrets: context.secrets,
        transport,
      });
      return agent.run(request, options);
    },
  });
}

export function deactivate(): void {
  // Reserved for provider/session cleanup as the extension grows.
}
