import * as vscode from "vscode";
import { EditorDiagnostic, EditorSnapshot, TextRange } from "./index";

/** Read the current VS Code editor state into the provider-neutral snapshot. */
export function readVscodeEditorSnapshot(): EditorSnapshot {
  const editor = vscode.window.activeTextEditor;
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
      }
    : undefined;

  const openFiles = unique(vscode.window.visibleTextEditors
    .map((visibleEditor) => workspacePath(visibleEditor.document.uri))
    .filter((path): path is string => path !== undefined));
  const diagnostics = activeFile && editor
    ? vscode.languages.getDiagnostics(editor.document.uri).map(toDiagnostic)
    : [];

  return { activeFile, openFiles, diagnostics };
}

function workspacePath(uri: vscode.Uri): string | undefined {
  if (!vscode.workspace.getWorkspaceFolder(uri)) return undefined;
  return vscode.workspace.asRelativePath(uri, false);
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
