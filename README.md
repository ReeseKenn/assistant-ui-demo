# Chatflow 事件流回放 Demo（assistant-ui）

把录制的 chatflow SSE 事件流（原始文件：`新建 文本文档.txt`，已复制到 `public/chatflow-stream.txt`）用 [assistant-ui](https://github.com/assistant-ui/assistant-ui) 回放成一轮完整对话：

- 用户提问 → AI 调用工具 `openapi_search_sample_pair`（流式参数）→ 工具结果渲染成「展样配对」卡片（20 家门店 SKU 明细）→ AI 流式输出最终回答。
- 顶栏实时显示事件流阶段（pending / process / answer / completed），支持「重新播放 / 停止」。

## 运行

```bash
npm install
npm run dev        # 打开 http://localhost:5173
```

## 工作原理

```
public/chatflow-stream.txt        录制的 SSE 帧（lifecycle/values/custom/messages/tools）
        │ fetch
        ▼
src/replay.ts                     parseSSE() 解析帧；replayEvents() 按录制时间戳节奏回放，
        │                         把事件增量转换成消息快照（含 tool-call 参数流与结果）
        ▼
src/App.tsx                       useExternalStoreRuntime({ messages, isRunning, convertMessage, onNew })
        │                         convertMessage: DemoMessage → ThreadMessageLike
        ▼
src/components/ChatThread.tsx     ThreadPrimitive / MessagePrimitive / ComposerPrimitive（headless）
        │                         MessagePrimitive.Parts 的 components.tools.by_name 按工具名挂卡片
        ▼
src/components/SamplePairToolCard.tsx   openapi_search_sample_pair 结果卡片（调用中 → 摘要/状态/门店明细）
```

事件流与 UI 的对应关系：

| SSE 事件 | Demo 中的效果 |
| --- | --- |
| `lifecycle: running/completed` | isRunning 状态、顶栏阶段徽章 |
| `custom: status pending/process/answer` | 顶栏阶段徽章 |
| `values`（首个快照） | 种下用户消息 |
| `messages: content-block-delta (tool_call_chunk)` | 工具卡片「调用中」+ 参数流式拼装 |
| `tools: tool-started/tool-finished` | 工具卡片切换到结果态（解析业务 JSON） |
| `messages: content-block-delta (text-delta)` | 助手回答逐字输出 |

## 说明

- 未连接真实后端；在输入框发送新消息会得到 Demo 提示。
- 若接真实 chatflow，把 `replayEvents` 换成对 `EventSource`/fetch 流的逐帧处理即可，
  其余（runtime 接线、卡片渲染）完全复用。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建（输出 dist/） |
| `npm run typecheck` | TypeScript 检查 |
