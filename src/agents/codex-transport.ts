import type { AgentEdit, AgentProgress } from "./index";
import type { CodexRequest, CodexResponse, CodexTransport, CodexTransportOptions } from "./codex";

interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly body?: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}

type FetchImplementation = (input: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<FetchResponseLike>;

/** Production HTTP transport for the OpenAI Responses endpoint. */
export class FetchCodexTransport implements CodexTransport {
  private readonly fetchImplementation: FetchImplementation;

  public constructor(fetchImplementation: FetchImplementation = globalThis.fetch as unknown as FetchImplementation) {
    this.fetchImplementation = fetchImplementation;
  }

  public async send(request: CodexRequest, options: CodexTransportOptions): Promise<CodexResponse> {
    const response = await this.fetchImplementation(request.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        input: formatInput(request),
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const error = new Error(`Codex returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    if (!response.body) return mapResponse(await response.json());
    return readEventStream(response.body, options.onProgress);
  }
}

function formatInput(request: CodexRequest): string {
  const context = request.context.map((item) => {
    const location = item.path ? ` (${item.path})` : "";
    return `[${item.source}${location}]\n${item.content}`;
  }).join("\n\n");
  return context ? `${request.action}: ${request.input}\n\nContext:\n${context}` : `${request.action}: ${request.input}`;
}

async function readEventStream(body: ReadableStream<Uint8Array>, onProgress?: (progress: AgentProgress) => void): Promise<CodexResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finalResponse: unknown;

  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as { type?: string; delta?: string; response?: unknown };
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
        onProgress?.({ phase: "working", message: "Codex is generating a response." });
      } else if (event.type === "response.completed") {
        finalResponse = event.response;
      } else if (event.type === "error") {
        throw new Error("Codex reported an error while streaming the response.");
      }
    }
    if (chunk.done) break;
  }

  const mapped = finalResponse ? mapResponse(finalResponse) : undefined;
  return { text: text || mapped?.text || "", edits: mapped?.edits };
}

function mapResponse(value: unknown): CodexResponse {
  const response = value as { output_text?: unknown; output?: unknown };
  const text = typeof response.output_text === "string" ? response.output_text : extractOutputText(response.output);
  return { text, edits: extractEdits(response.output) };
}

function extractOutputText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = "content" in item ? item.content : undefined;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : []);
  }).join("");
}

function extractEdits(output: unknown): readonly AgentEdit[] {
  if (!Array.isArray(output)) return [];
  return output.filter((item): item is AgentEdit => item !== null && typeof item === "object"
    && "path" in item && typeof item.path === "string"
    && "newText" in item && typeof item.newText === "string");
}
