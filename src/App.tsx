import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import { ChatThread } from "./components/ChatThread";
import { parseSSE, replayEvents } from "./replay";
import type { DemoMessage, SSEEvent } from "./replay";

const STREAM_URL = "/chatflow-stream.txt";

const PHASES: Record<string, { label: string; cls: "idle" | "run" | "done" }> = {
  idle: { label: "空闲", cls: "idle" },
  loading: { label: "加载事件流…", cls: "run" },
  running: { label: "graph 启动", cls: "run" },
  pending: { label: "pending · 排队", cls: "run" },
  process: { label: "process · 调用工具", cls: "run" },
  answer: { label: "answer · 生成回答", cls: "run" },
  completed: { label: "completed · 完成", cls: "done" },
};

/** DemoMessage → assistant-ui ThreadMessageLike */
function convertMessage(m: DemoMessage): ThreadMessageLike {
  return {
    id: m.id,
    role: m.role,
    createdAt: m.createdAt,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((part) =>
            part.type === "text"
              ? ({ type: "text", text: part.text } as const)
              : ({
                  type: "tool-call",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  args: part.args as ReadonlyJSONObject,
                  argsText: part.argsText,
                  result: part.result,
                } as const),
          ),
  };
}

export default function App() {
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [events, setEvents] = useState<SSEEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  // 加载录制的 SSE 事件流（public/chatflow-stream.txt）
  useEffect(() => {
    let cancelled = false;
    fetch(STREAM_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setEvents(parseSSE(t));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startReplay = useCallback(() => {
    if (!events) return;
    const token = ++tokenRef.current;
    setMessages([]);
    setIsRunning(true);
    setPhase("loading");
    void replayEvents(events, () => tokenRef.current === token, {
      onMessages: setMessages,
      onRunning: setIsRunning,
      onPhase: setPhase,
    });
  }, [events]);

  const stopReplay = useCallback(() => {
    tokenRef.current++;
    setIsRunning(false);
    setPhase("idle");
  }, []);

  // 事件流加载完成后自动播放一次
  useEffect(() => {
    if (events) startReplay();
  }, [events, startReplay]);

  // demo 未连接真实后端：发送新消息时给出提示
  const onNew = useCallback(async (m: AppendMessage) => {
    tokenRef.current++; // 停止正在进行的回放
    const text = m.content
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text || "(空消息)", createdAt: new Date() },
    ]);
    setIsRunning(true);
    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: [
            {
              type: "text",
              text: "这是本地回放 Demo，未连接真实 chatflow 后端，无法回答新问题。点击上方「▶ 重新播放」可重放录制的一轮对话事件流。",
            },
          ],
          createdAt: new Date(),
        },
      ]);
      setIsRunning(false);
    }, 500);
  }, []);

  const runtime = useExternalStoreRuntime<DemoMessage>({
    messages,
    isRunning,
    convertMessage,
    onNew,
    onCancel: async () => {
      stopReplay();
    },
  });

  const phaseInfo = PHASES[phase] ?? { label: phase, cls: "run" as const };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="app">
        <header className="app-header">
          <div className="app-title">
            <span className="logo">⚡</span>
            <div>
              <h1>Chatflow 事件流回放 Demo</h1>
              <p className="subtitle">assistant-ui · useExternalStoreRuntime · 工具结果卡片</p>
            </div>
          </div>
          <div className="app-controls">
            <span className={`phase-badge ${phaseInfo.cls}`}>
              {phaseInfo.cls === "run" && <span className="dot-pulse" />}
              {phaseInfo.label}
            </span>
            <button className="btn btn-primary" onClick={startReplay} disabled={!events}>
              ▶ 重新播放
            </button>
            <button className="btn" onClick={stopReplay} disabled={!isRunning}>
              ■ 停止
            </button>
          </div>
        </header>

        {loadError && (
          <div className="load-error">
            无法加载 {STREAM_URL}：{loadError}（请确认 public/chatflow-stream.txt 存在，并通过 npm run dev 访问）
          </div>
        )}

        <main className="app-main">
          <ChatThread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}
