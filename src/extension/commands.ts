import * as vscode from "vscode";

/** Register Pairwave's extension-host commands. */
export function registerCommands(context: vscode.ExtensionContext): void {
  const startCommand = vscode.commands.registerCommand("pairwave.start", () => {
    void vscode.window.showInformationMessage("Pairwave is ready.");
  });

  context.subscriptions.push(startCommand);
}
