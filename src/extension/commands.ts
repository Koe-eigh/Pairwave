import * as vscode from "vscode";
import { CodingAgentError, type AgentRequest, type CodingAgent } from "../agents";
import { collectEditorContext } from "../context";
import { createRepositoryContextProvider, type RepositoryProvider, type RepositoryRequest } from "../context/repository";
import { readVscodeEditorSnapshot, readVscodeWorkspacePath, readVscodeWorkspaceRoot } from "../context/vscode";

/** Register Pairwave's extension-host commands. */
export function registerCommands(context: vscode.ExtensionContext, agent: CodingAgent): void {
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
      const requestedPath = "path" in request ? request.path : undefined;
      const provider = getRepository(requestedPath);
      if (!provider) return undefined;
      if ("path" in request && typeof request.path === "string") {
        return provider.retrieve({ ...request, path: readVscodeWorkspacePath(request.path) });
      }
      return provider.retrieve(request);
    },
  );

  const runAgent = vscode.commands.registerCommand("pairwave.runAgent", async (request: unknown) => {
    let agentRequest: AgentRequest;
    if (isAgentRequest(request)) {
      agentRequest = request;
    } else if (request === undefined) {
      const action = await vscode.window.showQuickPick(
        ["read", "search", "explain", "suggest", "modify"],
        { placeHolder: "Choose an agent action" },
      );
      const prompt = action === undefined ? undefined : await vscode.window.showInputBox({ prompt: "What should Pairwave ask the coding agent?" });
      if (action === undefined || prompt === undefined || prompt.trim().length === 0) return undefined;
      agentRequest = { action: action as AgentRequest["action"], prompt };
    } else {
      void vscode.window.showWarningMessage("Pairwave agent requests require an action and prompt.");
      return undefined;
    }
    const confirmation = await vscode.window.showWarningMessage(
      "This will send your request and workspace context to the configured coding-agent provider.",
      { modal: true },
      "Run agent",
    );
    if (confirmation !== "Run agent") return undefined;
    try {
      return await agent.run(agentRequest);
    } catch (error) {
      const message = error instanceof CodingAgentError ? error.message : "The coding-agent request failed.";
      void vscode.window.showErrorMessage(message);
      return undefined;
    }
  });

  context.subscriptions.push(startCommand, retrieveRepositoryContext, runAgent);
}

function isAgentRequest(request: unknown): request is AgentRequest {
  if (!request || typeof request !== "object" || !("action" in request) || !("prompt" in request)) return false;
  if (!["read", "search", "explain", "suggest", "modify"].includes(request.action as string)
    || typeof request.prompt !== "string") return false;
  if (!("context" in request) || request.context === undefined) return true;
  return Array.isArray(request.context) && request.context.every((item) => {
    if (!item || typeof item !== "object" || !("source" in item) || !("content" in item)) return false;
    return typeof item.source === "string"
      && typeof item.content === "string"
      && (!("path" in item) || item.path === undefined || typeof item.path === "string");
  });
}

function isRepositoryRequest(request: unknown): request is RepositoryRequest {
  if (!request || typeof request !== "object" || !("kind" in request) || typeof request.kind !== "string") return false;
  if (request.kind === "files" || request.kind === "modified-files") return true;
  if (request.kind === "diff") return !("path" in request) || typeof request.path === "string";
  return ["file", "symbols", "references", "dependencies"].includes(request.kind)
    && "path" in request
    && typeof request.path === "string";
}
