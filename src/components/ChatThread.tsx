import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { TextMessagePartProps } from "@assistant-ui/react";
import { GenericToolCard, SamplePairCard } from "./SamplePairToolCard";

/** 基于 assistant-ui headless primitives 的会话 UI（样式全部在 styles.css） */
export function ChatThread() {
  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <ThreadPrimitive.Messages
          components={{
            UserMessage: DemoUserMessage,
            AssistantMessage: DemoAssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>

      <div className="composer-wrap">
        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input
            className="composer-input"
            placeholder="输入消息…（Demo 未连接后端，发送会得到提示）"
            autoFocus
          />
          <ComposerPrimitive.Send className="composer-send">发送</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}

function DemoUserMessage() {
  return (
    <MessagePrimitive.Root className="msg msg-user">
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </MessagePrimitive.Root>
  );
}

function DemoAssistantMessage() {
  return (
    <MessagePrimitive.Root className="msg msg-assistant">
      <div className="avatar">🤖</div>
      <div className="msg-body">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            tools: {
              by_name: {
                openapi_search_sample_pair: SamplePairCard,
              },
              Fallback: GenericToolCard,
            },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

const UserText = ({ text }: TextMessagePartProps) => <p className="msg-text user-text">{text}</p>;

const AssistantText = ({ text }: TextMessagePartProps) => <p className="msg-text assistant-text">{text}</p>;
