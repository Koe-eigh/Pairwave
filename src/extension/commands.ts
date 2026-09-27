import * as vscode from "vscode";
import { collectEditorContext } from "../context";
import { createRepositoryContextProvider, type RepositoryProvider, type RepositoryRequest } from "../context/repository";
import { readVscodeEditorSnapshot, readVscodeWorkspaceRoot } from "../context/vscode";

/** Register Pairwave's extension-host commands. */
export function registerCommands(context: vscode.ExtensionContext): void {
  let repository: RepositoryProvider | undefined;
  let repositoryRoot: string | undefined;
  const getRepository = (requestedPath?: string): RepositoryProvider | undefined => {
    const workspaceRoot = readVscodeWorkspaceRoot(requestedPath);
    if (!workspaceRoot) return undefined;
    if (!repository || repositoryRoot !== workspaceRoot) {
      repository = createRepositoryContextProvider({ workspaceRoot });
      repositoryRoot = workspaceRoot;
    }
    return repository;
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
    async (request: unknown) => {
      if (!isRepositoryRequest(request)) {
        void vscode.window.showWarningMessage("Pairwave repository retrieval requires a valid request.");
        return undefined;
      }
      return getRepository("path" in request ? request.path : undefined)?.retrieve(request);
    },
  );

  context.subscriptions.push(startCommand, retrieveRepositoryContext);
}

function isRepositoryRequest(request: unknown): request is RepositoryRequest {
  if (!request || typeof request !== "object" || !("kind" in request) || typeof request.kind !== "string") return false;
  if (request.kind === "files" || request.kind === "modified-files") return true;
  if (request.kind === "diff") return !("path" in request) || typeof request.path === "string";
  return ["file", "symbols", "references", "dependencies"].includes(request.kind)
    && "path" in request
    && typeof request.path === "string";
}
