import * as vscode from "vscode";
import { EditorDiagnostic, EditorSnapshot, TextRange } from "./index";

/** Read the current VS Code editor state into the provider-neutral snapshot. */
export async function readVscodeEditorSnapshot(): Promise<EditorSnapshot> {
  const editor = vscode.window.activeTextEditor;
  const symbol = editor ? await getSurroundingSymbol(editor) : undefined;
  const activeFile = editor && workspacePath(editor.document.uri)
    ? {
        path: workspacePath(editor.document.uri)!,
        languageId: editor.document.languageId,
        text: editor.document.getText(),
        isDirty: editor.document.isDirty,
        cursor: toPosition(editor.selection.active),
        selection: editor.selection.isEmpty ? undefined : {
          range: toRange(editor.selection),
          text: editor.document.getText(editor.selection),
        },
        surroundingSymbol: symbol,
      }
    : undefined;

  const openFiles = unique(vscode.workspace.textDocuments
    .map((document) => workspacePath(document.uri))
    .filter((path): path is string => path !== undefined));
  const diagnostics = activeFile && editor
    ? vscode.languages.getDiagnostics(editor.document.uri).map(toDiagnostic)
    : [];

  return { activeFile, openFiles, diagnostics };
}

function workspacePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  const includeWorkspaceFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return vscode.workspace.asRelativePath(uri, includeWorkspaceFolder);
}

async function getSurroundingSymbol(editor: vscode.TextEditor): Promise<string | undefined> {
  let symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
      "vscode.executeDocumentSymbolProvider",
      editor.document.uri,
    );
  } catch {
    return undefined;
  }
  if (!symbols) return undefined;
  const cursor = editor.selection.active;
  const matching = flattenSymbols(symbols).filter((symbol) => symbol.range.contains(cursor));
  return matching.sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0]?.name;
}

function flattenSymbols(symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]): Array<{ name: string; range: vscode.Range }> {
  const result: Array<{ name: string; range: vscode.Range }> = [];
  for (const symbol of symbols) {
    const range = "range" in symbol ? symbol.range : symbol.location.range;
    result.push({ name: symbol.name, range });
    if ("children" in symbol) result.push(...flattenSymbols(symbol.children));
  }
  return result;
}

function rangeSize(range: vscode.Range): number {
  return (range.end.line - range.start.line) * 100_000 + range.end.character - range.start.character;
}

function toPosition(position: vscode.Position) {
  return { line: position.line, character: position.character };
}

function toRange(range: vscode.Range): TextRange {
  return { start: toPosition(range.start), end: toPosition(range.end) };
}

function toDiagnostic(diagnostic: vscode.Diagnostic): EditorDiagnostic {
  let severity: EditorDiagnostic["severity"] = "information";
  if (diagnostic.severity === vscode.DiagnosticSeverity.Error) severity = "error";
  else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) severity = "warning";
  else if (diagnostic.severity === vscode.DiagnosticSeverity.Hint) severity = "hint";
  return { message: diagnostic.message, severity, range: toRange(diagnostic.range) };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
