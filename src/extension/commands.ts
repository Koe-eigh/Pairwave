import * as vscode from "vscode";
import { collectEditorContext } from "../context";
import { readVscodeEditorSnapshot } from "../context/vscode";

/** Register Pairwave's extension-host commands. */
export function registerCommands(context: vscode.ExtensionContext): void {
  const startCommand = vscode.commands.registerCommand("pairwave.start", async () => {
    const editorContext = collectEditorContext(await readVscodeEditorSnapshot());
    void vscode.window.showInformationMessage("Pairwave is ready.");
    return editorContext;
  });

  context.subscriptions.push(startCommand);
}
