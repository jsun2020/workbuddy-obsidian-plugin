// Parse the WorkBuddy CLI's `--output-format stream-json` NDJSON into a small,
// UI-friendly event union.
//
// Pure module (no Obsidian / Node imports) so it is unit-testable. The wire
// format is Claude-Code-compatible (verified live, see prd.md 3.2):
//   {"type":"system","subtype":"init","session_id":...,"model":...,"tools":[...]}
//   {"type":"stream_event","event":{"type":"message_start","message":{"id":...}}}
//   {"type":"stream_event","event":{"type":"content_block_start","index":n,"content_block":{"type":"text"|"thinking"|"tool_use"}}}
//   {"type":"stream_event","event":{"type":"content_block_delta","index":n,"delta":{"type":"text_delta","text":..}}}
//   {"type":"stream_event","event":{"type":"content_block_delta","index":n,"delta":{"type":"thinking_delta","thinking":..}}}
//   {"type":"assistant","message":{"id":...,"content":[{"type":"text"|"thinking"|"tool_use",...}],"usage":{...}}}
//   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":..,"content":[...],"is_error":bool}]}}
//   {"type":"result","subtype":"success"|..,"is_error":bool,"result":str,"session_id":..,"usage":{..},"permission_denials":[..]}
//
// Dedupe rule (D9): with --include-partial-messages the text of an assistant
// message arrives twice - as deltas and then as the full `assistant` message.
// We render text from deltas and only take `tool_use` blocks from an
// `assistant` message whose id was already streamed; assistant messages that
// were never streamed (e.g. synthetic "Max turns exceeded") contribute their
// text. Tool use is always taken from the `assistant` message because its
// `input` is complete there (deltas only carry partial JSON).

export type StreamEvent =
  | { kind: "init"; sessionId: string; model: string; tools: string[]; permissionMode: string }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_start"; id: string; name: string; preview: string }
  | { kind: "tool_end"; id: string; isError: boolean; preview: string }
  | { kind: "perm_request"; requestId: string; toolName: string; toolUseId: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number }
  | {
      kind: "result";
      isError: boolean;
      text: string;
      sessionId: string;
      numTurns: number;
      durationMs: number;
      deniedTools: string[];
      inputTokens: number;
      outputTokens: number;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Shorten an absolute path to be relative to `cwd` when it lives inside it. */
export function relativeToCwd(p: string, cwd: string): string {
  if (!p || !cwd) return p;
  const norm = (s: string) => s.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const np = norm(p);
  const nc = norm(cwd);
  if (np.toLowerCase().startsWith(nc.toLowerCase() + "/")) return np.slice(nc.length + 1);
  return p;
}

/**
 * A one-line, human preview of a tool call, e.g. `Read notes/todo.md`,
 * `Bash git status`, `Grep "foo"`. Unknown tools show their first string arg.
 */
export function toolPreview(name: string, input: unknown, cwd: string): string {
  if (!isRecord(input)) return "";
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  };
  let text = "";
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      text = relativeToCwd(pick("file_path", "notebook_path", "path"), cwd);
      break;
    case "Bash":
    case "PowerShell":
      text = pick("description", "command");
      break;
    case "Glob":
      text = pick("pattern");
      break;
    case "Grep":
      text = pick("pattern");
      if (text) text = `"${text}"`;
      break;
    case "WebFetch":
      text = pick("url");
      break;
    case "WebSearch":
      text = pick("query");
      break;
    case "Agent":
      text = pick("description", "prompt");
      break;
    case "Skill":
      text = pick("skill", "name");
      break;
    default: {
      text = pick("description", "file_path", "path", "query", "pattern", "command", "name", "prompt");
      if (!text) {
        const firstStr = Object.values(input).find((v) => typeof v === "string" && v.trim());
        text = typeof firstStr === "string" ? firstStr : "";
      }
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 90 ? text.slice(0, 87) + "..." : text;
}

/** First ~100 chars of a tool_result's textual content (for the activity line). */
function toolResultPreview(content: unknown): string {
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        text = block.text;
        break;
      }
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 100 ? text.slice(0, 97) + "..." : text;
}

/** Stateful line-buffered parser for one CLI process. */
export class StreamJsonParser {
  private buffer = "";
  /** Message ids seen via stream_event message_start (their text was streamed). */
  private streamedMessageIds = new Set<string>();
  /** Index -> block type for the message currently streaming. */
  private blockTypes = new Map<number, string>();
  /**
   * Text streamed as deltas since the last message_start. The CLI sometimes
   * re-emits a streamed block inside an `assistant` message with a FRESH id
   * (observed for thinking-only messages), so id-dedupe alone is not enough:
   * an unstreamed assistant text block is also skipped when its content was
   * already streamed verbatim.
   */
  private streamedText = "";
  private readonly cwd: string;

  constructor(cwd = "") {
    this.cwd = cwd;
  }

  /** Feed a chunk of stdout; returns all complete events parsed so far. */
  feed(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      events.push(...this.parseLine(line));
    }
    return events;
  }

  /** Flush a trailing partial line (call once at EOF). */
  flush(): StreamEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() ? this.parseLine(rest) : [];
  }

  /** Parse one NDJSON line into zero or more events (never throws). */
  parseLine(line: string): StreamEvent[] {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return [];
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return []; // log noise / partial line - ignore
    }
    if (!isRecord(obj)) return [];
    switch (obj.type) {
      case "system":
        return this.onSystem(obj);
      case "stream_event":
        return this.onStreamEvent(obj);
      case "assistant":
        return this.onAssistant(obj);
      case "user":
        return this.onUser(obj);
      case "result":
        return this.onResult(obj);
      case "control_request":
        return this.onControlRequest(obj);
      default:
        return [];
    }
  }

  /**
   * With `--input-format stream-json` the CLI does NOT silently deny a gated
   * tool (that is argv-prompt behaviour): it emits a `can_use_tool`
   * control_request on stdout and BLOCKS until a control_response arrives on
   * stdin - forever, even after stdin EOF. The client must answer every one
   * (see buildDenyResponse) or the turn hangs until the idle timeout.
   */
  private onControlRequest(obj: Record<string, unknown>): StreamEvent[] {
    const req = obj.request;
    if (!isRecord(req) || req.subtype !== "can_use_tool") return [];
    return [
      {
        kind: "perm_request",
        requestId: str(obj.request_id),
        toolName: str(req.tool_name),
        toolUseId: str(req.tool_use_id)
      }
    ];
  }

  private onSystem(obj: Record<string, unknown>): StreamEvent[] {
    if (obj.subtype !== "init") return [];
    const tools = Array.isArray(obj.tools) ? obj.tools.filter((t): t is string => typeof t === "string") : [];
    return [
      {
        kind: "init",
        sessionId: str(obj.session_id),
        model: str(obj.model),
        tools,
        permissionMode: str(obj.permissionMode)
      }
    ];
  }

  private onStreamEvent(obj: Record<string, unknown>): StreamEvent[] {
    const ev = obj.event;
    if (!isRecord(ev)) return [];
    switch (ev.type) {
      case "message_start": {
        const id = isRecord(ev.message) ? str(ev.message.id) : "";
        if (id) this.streamedMessageIds.add(id);
        this.blockTypes.clear();
        this.streamedText = "";
        return [];
      }
      case "content_block_start": {
        const idx = num(ev.index);
        const block = ev.content_block;
        if (isRecord(block)) this.blockTypes.set(idx, str(block.type));
        return [];
      }
      case "content_block_delta": {
        const delta = ev.delta;
        if (!isRecord(delta)) return [];
        if (delta.type === "text_delta") {
          const t = str(delta.text);
          if (!t) return [];
          this.streamedText += t;
          return [{ kind: "text", text: t }];
        }
        if (delta.type === "thinking_delta") {
          const t = str(delta.thinking);
          return t ? [{ kind: "thinking", text: t }] : [];
        }
        return [];
      }
      default:
        return [];
    }
  }

  private onAssistant(obj: Record<string, unknown>): StreamEvent[] {
    const msg = obj.message;
    if (!isRecord(msg)) return [];
    const id = str(msg.id);
    const streamed = id !== "" && this.streamedMessageIds.has(id);
    // Partial streaming is active once any message_start has been seen; from
    // then on thinking is rendered from deltas only (see `streamedText` doc).
    const partialActive = this.streamedMessageIds.size > 0;
    const events: StreamEvent[] = [];
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "tool_use") {
        const name = str(block.name);
        events.push({
          kind: "tool_start",
          id: str(block.id),
          name,
          preview: toolPreview(name, block.input, this.cwd)
        });
      } else if (!streamed && block.type === "text") {
        const t = str(block.text);
        if (!t) continue;
        if (partialActive && this.streamedText.trim() !== "" && this.streamedText.trim() === t.trim()) continue;
        events.push({ kind: "text", text: t });
      } else if (!streamed && !partialActive && block.type === "thinking") {
        const t = str(block.thinking);
        if (t) events.push({ kind: "thinking", text: t });
      }
    }
    const usage = msg.usage;
    if (isRecord(usage)) {
      const inTok = num(usage.input_tokens);
      const outTok = num(usage.output_tokens);
      if (inTok > 0 || outTok > 0) events.push({ kind: "usage", inputTokens: inTok, outputTokens: outTok });
    }
    return events;
  }

  private onUser(obj: Record<string, unknown>): StreamEvent[] {
    const msg = obj.message;
    if (!isRecord(msg)) return [];
    const content = Array.isArray(msg.content) ? msg.content : [];
    const events: StreamEvent[] = [];
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      const preview = toolResultPreview(block.content);
      const isError = block.is_error === true || /^error[:\s]/i.test(preview);
      events.push({ kind: "tool_end", id: str(block.tool_use_id), isError, preview });
    }
    return events;
  }

  private onResult(obj: Record<string, unknown>): StreamEvent[] {
    const denials: string[] = [];
    if (Array.isArray(obj.permission_denials)) {
      for (const d of obj.permission_denials) {
        if (isRecord(d) && typeof d.tool_name === "string") denials.push(d.tool_name);
        else if (typeof d === "string") denials.push(d);
      }
    }
    const usage = isRecord(obj.usage) ? obj.usage : {};
    return [
      {
        kind: "result",
        isError: obj.is_error === true || (typeof obj.subtype === "string" && obj.subtype.startsWith("error")),
        text: str(obj.result),
        sessionId: str(obj.session_id),
        numTurns: num(obj.num_turns),
        durationMs: num(obj.duration_ms),
        deniedTools: denials,
        inputTokens: num(usage.input_tokens),
        outputTokens: num(usage.output_tokens)
      }
    ];
  }
}

export type ErrorClass = "auth" | "other";

/**
 * The stdin line that answers a `can_use_tool` control_request with a denial.
 * The CLI then emits a normal is_error tool_result for the tool_use and the
 * model continues the turn with the tools it IS allowed to use (verified live,
 * prd.md 3.2). `message` is surfaced to the model as the rejection reason.
 */
export function buildDenyResponse(requestId: string, message: string): string {
  return (
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: { behavior: "deny", message }
      }
    }) + "\n"
  );
}

/**
 * Classify a raw CLI error message so the UI can show a plain-language hint
 * ("open WorkBuddy and sign in") instead of a stack of English.
 */
export function classifyError(message: string): ErrorClass {
  const m = (message || "").toLowerCase();
  if (
    /\b(401|403)\b/.test(m) ||
    /unauthori[sz]ed|not (logged|signed) in|login required|please (log|sign) in|authentication|invalid (token|api key)|token (expired|invalid)/.test(m) ||
    /未登录|请先登录|登录已过期|鉴权失败|认证失败/.test(message || "")
  ) {
    return "auth";
  }
  return "other";
}
