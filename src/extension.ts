import * as vscode from "vscode";
import { registerCommands } from "./extension/commands";

/** Activate Pairwave and register its initial smoke-test command. */
export function activate(context: vscode.ExtensionContext): void {
  registerCommands(context);
}

export function deactivate(): void {
  // Reserved for provider/session cleanup as the extension grows.
}
