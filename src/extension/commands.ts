import * as vscode from "vscode";
import { collectEditorContext } from "../context";
import { createRepositoryContextProvider } from "../context/repository";
import { readVscodeEditorSnapshot, readVscodeWorkspaceRoot } from "../context/vscode";

/** Register Pairwave's extension-host commands. */
export function registerCommands(context: vscode.ExtensionContext): void {
  const startCommand = vscode.commands.registerCommand("pairwave.start", async () => {
    const snapshot = await readVscodeEditorSnapshot();
    const workspaceRoot = readVscodeWorkspaceRoot();
    const repository = workspaceRoot
      ? await createRepositoryContextProvider({ workspaceRoot }).collectInitial({ maxChars: 12_000 })
      : undefined;
    const editorContext = collectEditorContext(snapshot, { repositoryItems: repository?.items });
    void vscode.window.showInformationMessage("Pairwave is ready.");
    return editorContext;
  });

  context.subscriptions.push(startCommand);
}
