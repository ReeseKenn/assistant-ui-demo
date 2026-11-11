/**
 * SSE 事件流解析 + 回放引擎
 *
 * 把录制的 chatflow SSE 帧（lifecycle / values / custom / messages / tools）
 * 转换成 assistant-ui ExternalStore 需要的消息列表，并按录制时间戳节奏回放。
 */

export interface SSEEvent {
  eventName: string;
  data: any;
}

/** 解析 SSE 文本为事件列表（跳过 `: heartbeat` 注释帧与无法解析的帧） */
export function parseSSE(text: string): SSEEvent[] {
  const clean = text.replace(/^\uFEFF/, "");
  const events: SSEEvent[] = [];
  for (const block of clean.split(/\r?\n\r?\n/)) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      events.push({ eventName, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      // 跳过损坏的帧
    }
  }
  return events;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText?: string;
  result?: unknown;
}

export type DemoContentPart = TextPart | ToolCallPart;

export interface DemoMessage {
  id: string;
  role: "user" | "assistant";
  content: string | DemoContentPart[];
  createdAt?: Date;
}

export interface ReplayHandlers {
  onMessages: (messages: DemoMessage[]) => void;
  onRunning: (running: boolean) => void;
  onPhase: (phase: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 工具输出外壳：{content:[{type:"text",text:"<业务 JSON 字符串>"}]} → 业务对象 */
function extractToolResult(output: any): unknown {
  if (output && Array.isArray(output.content)) {
    const texts = output.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => String(c.text ?? ""));
    if (texts.length === 1) {
      try {
        return JSON.parse(texts[0]);
      } catch {
        return texts[0];
      }
    }
    if (texts.length > 1) {
      return texts.map((t: string) => {
        try {
          return JSON.parse(t);
        } catch {
          return t;
        }
      });
    }
  }
  return output;
}

/**
 * 按录制节奏回放事件流。
 * shouldContinue 返回 false 时立即中止（用于「停止 / 重新播放 / 组件卸载」）。
 */
export async function replayEvents(
  events: SSEEvent[],
  shouldContinue: () => boolean,
  handlers: ReplayHandlers,
): Promise<void> {
  let msgs: DemoMessage[] = [];
  let current: DemoMessage | null = null; // 正在流式构建的 assistant 消息
  let lastTs = 0;
  let userSeeded = false;

  const snapshot = () => handlers.onMessages(structuredClone(msgs));

  const findToolPart = (toolCallId: string): ToolCallPart | undefined => {
    for (const m of msgs) {
      if (typeof m.content === "string") continue;
      for (const part of m.content) {
        if (part.type === "tool-call" && part.toolCallId === toolCallId) return part;
      }
    }
    return undefined;
  };

  for (const ev of events) {
    if (!shouldContinue()) return;

    const payload = ev.data;
    const method: string = payload?.method ?? ev.eventName;
    const params = payload?.params;
    const d = params?.data;
    const ts: number = params?.timestamp ?? 0;

    // 节奏：按录制时间戳间隔回放，钳制在 [每帧最小值, 500ms]，让流式效果可见又不拖沓
    if (ts && lastTs) {
      const gap = Math.min(Math.max(ts - lastTs, 0), 500);
      const wait = Math.max(gap, method === "messages" ? 40 : 0);
      if (wait > 0) {
        await sleep(wait);
        if (!shouldContinue()) return;
      }
    }
    if (ts) lastTs = ts;

    switch (method) {
      case "lifecycle": {
        const e = d?.event;
        if (e === "running") {
          handlers.onRunning(true);
          handlers.onPhase("running");
        } else if (e === "completed") {
          handlers.onRunning(false);
          handlers.onPhase("completed");
        }
        break;
      }

      case "custom": {
        if (d?.type === "status" && d?.phase) handlers.onPhase(d.phase);
        break;
      }

      case "values": {
        // 用第一个状态快照种下用户消息
        const human = d?.messages?.find((m: any) => m.type === "human");
        if (human && !userSeeded) {
          userSeeded = true;
          msgs = [
            {
              id: human.id ?? "user",
              role: "user",
              content: String(human.content ?? ""),
              createdAt: new Date(ts),
            },
            ...msgs,
          ];
          snapshot();
        }
        break;
      }

      case "messages": {
        const ns: string[] = params?.namespace ?? [];
        if (ns.length > 0) break; // 工具命名空间里的流由 `tools` 事件统一处理

        switch (d?.event) {
          case "message-start": {
            if (d.role === "ai") {
              current = {
                id: d.id ?? `ai-${msgs.length}`,
                role: "assistant",
                content: [],
                createdAt: new Date(ts),
              };
              msgs = [...msgs, current];
              snapshot();
            }
            break;
          }
          case "content-block-start": {
            if (!current || !Array.isArray(current.content)) break;
            const c = d.content;
            const index = d.index ?? 0;
            if (c?.type === "text") {
              current.content[index] = { type: "text", text: c.text ?? "" };
            } else if (c?.type === "tool_call_chunk") {
              current.content[index] = {
                type: "tool-call",
                toolCallId: c.id,
                toolName: c.name,
                args: {},
                argsText: c.args ?? "",
              };
            }
            snapshot();
            break;
          }
          case "content-block-delta": {
            if (!current || !Array.isArray(current.content)) break;
            const part = current.content[d.index ?? 0];
            const delta = d.delta;
            if (delta?.type === "text-delta" && part?.type === "text") {
              part.text += delta.text ?? "";
            } else if (
              delta?.type === "block-delta" &&
              delta.fields?.type === "tool_call_chunk" &&
              part?.type === "tool-call"
            ) {
              part.argsText = (part.argsText ?? "") + (delta.fields.args ?? "");
              try {
                part.args = JSON.parse(part.argsText);
              } catch {
                // 参数 JSON 还没流完，忽略
              }
            }
            snapshot();
            break;
          }
          case "content-block-finish": {
            if (!current || !Array.isArray(current.content)) break;
            const part = current.content[d.index ?? 0];
            const c = d.content;
            if (c?.type === "text" && part?.type === "text") {
              part.text = c.text ?? part.text;
            } else if (c?.type === "tool_call" && part?.type === "tool-call") {
              part.args = (c.args ?? part.args) as Record<string, unknown>;
              part.argsText = part.argsText || JSON.stringify(part.args);
            }
            snapshot();
            break;
          }
          case "message-finish": {
            current = null;
            break;
          }
        }
        break;
      }

      case "tools": {
        if (d?.event === "tool-started") {
          const part = findToolPart(d.tool_call_id);
          if (part) {
            part.args = (d.input ?? part.args) as Record<string, unknown>;
          } else {
            // 兜底：没在消息流里见过这个 tool call，直接补一条 assistant 消息
            msgs = [
              ...msgs,
              {
                id: `ai-tool-${d.tool_call_id}`,
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: d.tool_call_id,
                    toolName: d.tool_name,
                    args: (d.input ?? {}) as Record<string, unknown>,
                  },
                ],
                createdAt: new Date(ts),
              },
            ];
          }
          snapshot();
        } else if (d?.event === "tool-finished") {
          const part = findToolPart(d.tool_call_id);
          if (part) {
            part.result = extractToolResult(d.output);
            snapshot();
          }
        }
        break;
      }
    }
  }

  if (shouldContinue()) {
    handlers.onRunning(false);
    handlers.onPhase("completed");
  }
}
