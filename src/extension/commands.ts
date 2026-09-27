import * as vscode from "vscode";
import { collectEditorContext } from "../context";
import { createRepositoryContextProvider, type RepositoryProvider, type RepositoryRequest } from "../context/repository";
import { readVscodeEditorSnapshot, readVscodeWorkspaceRoot } from "../context/vscode";

/** Register Pairwave's extension-host commands. */
export function registerCommands(context: vscode.ExtensionContext): void {
  let repository: RepositoryProvider | undefined;
  const getRepository = (): RepositoryProvider | undefined => {
    const workspaceRoot = readVscodeWorkspaceRoot();
    if (!workspaceRoot) return undefined;
    return repository ??= createRepositoryContextProvider({ workspaceRoot });
  };

  const startCommand = vscode.commands.registerCommand("pairwave.start", async () => {
    const snapshot = await readVscodeEditorSnapshot();
    const repositoryContext = await getRepository()?.collectInitial({ maxChars: 12_000 });
    const editorContext = collectEditorContext(snapshot, { repositoryItems: repositoryContext?.items });
    void vscode.window.showInformationMessage("Pairwave is ready.");
    return editorContext;
  });

  const retrieveRepositoryContext = vscode.commands.registerCommand(
    "pairwave.retrieveRepositoryContext",
    async (request: RepositoryRequest) => getRepository()?.retrieve(request),
  );

  context.subscriptions.push(startCommand, retrieveRepositoryContext);
}
