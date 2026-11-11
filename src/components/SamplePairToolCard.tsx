import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

/** openapi_search_sample_pair 的入参 */
export interface SearchArgs {
  spuCodes?: string[];
  city?: string;
}

export interface StorePair {
  siteName: string;
  skuCode: string;
  skuName: string;
  source?: string;
  contact?: string;
  openingTime?: string;
  siteAddress?: string;
}

/** 工具返回的业务负载（剥掉 SSE 外壳后的 JSON） */
export interface SearchResult {
  ok?: boolean;
  status?: string;
  summary?: string;
  confidence?: number;
  requiresConfirmation?: boolean;
  toolContractVersion?: number;
  entityRefs?: Array<{ type: string; id: string; title: string }>;
  evidence?: Array<{ type: string; detail?: { truncated?: boolean; rowCount?: number; hitCount?: number } }>;
  data?: { pairs?: StorePair[]; truncated?: boolean; unresolvedSpuCodes?: string[] };
  present?: {
    inline?: Array<{ type: string; payload?: Record<string, unknown> }>;
    artifact?: { type?: string; title?: string; open?: string };
  };
}

function tryParse(text: string): SearchResult | null {
  try {
    return JSON.parse(text) as SearchResult;
  } catch {
    return null;
  }
}

/**
 * openapi_search_sample_pair 的结果卡片。
 * 通过 MessagePrimitive.Parts 的 components.tools.by_name 挂到对应 tool-call 消息块上：
 * - 调用中（无 result）：显示工具名 + 流式参数
 * - 完成后：渲染「展样配对」卡片（摘要 / 状态 / 门店 SKU 明细 / 展示建议）
 */
export const SamplePairCard: ToolCallMessagePartComponent<SearchArgs, SearchResult | string | undefined> = ({
  args,
  argsText,
  result,
}) => {
  const parsed: SearchResult | null =
    result == null ? null : typeof result === "string" ? tryParse(result) : (result as SearchResult);
  const pairs = parsed?.data?.pairs ?? [];
  const hitCount = parsed?.evidence?.find((e) => e.type === "count")?.detail?.hitCount;
  const truncated = Boolean(parsed?.data?.truncated) || parsed?.status === "partial";

  let badge: { cls: string; text: string };
  if (!parsed) badge = { cls: "badge-run", text: "调用中" };
  else if (parsed.ok === false) badge = { cls: "badge-err", text: "调用失败" };
  else if (parsed.status === "partial") badge = { cls: "badge-warn", text: "部分结果 · 已截断" };
  else if (parsed.status === "empty") badge = { cls: "badge-idle", text: "无结果" };
  else badge = { cls: "badge-ok", text: "成功" };

  const argsDisplay =
    argsText && argsText.trim() ? argsText.replace(/\s+/g, " ").trim() : JSON.stringify(args ?? {});

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-icon">{parsed ? "🗂️" : "⏳"}</span>
        <div className="tool-title">
          <strong>展样配对查询</strong>
          <code>openapi_search_sample_pair</code>
        </div>
        <span className={`badge ${badge.cls}`}>
          {!parsed && <span className="dot-pulse" />}
          {badge.text}
        </span>
      </div>

      <div className="tool-args">
        <span className="args-label">参数</span>
        <code>{argsDisplay}</code>
      </div>

      {!parsed && <div className="tool-loading">正在执行工具调用，等待返回…</div>}

      {parsed && (
        <>
          <div className="tool-summary">
            <span>{parsed.summary ?? "查询完成"}</span>
            {typeof parsed.confidence === "number" && (
              <span className="confidence">置信度 {Math.round(parsed.confidence * 100)}%</span>
            )}
          </div>

          {pairs.length > 0 && (
            <div className="pairs">
              <div className="pairs-head">
                <span>
                  🏬 命中 {hitCount ?? pairs.length} 条展样配对 · 展示 {pairs.length} 家门店
                </span>
                <span className="pairs-sub">
                  {[args?.city, (args?.spuCodes ?? []).join("、")].filter(Boolean).join(" · ")}
                  {truncated && " · 已截断"}
                </span>
              </div>
              <ul className="pairs-list">
                {pairs.map((p, i) => (
                  <li className="pair-item" key={`${p.siteName}-${p.skuCode}-${i}`}>
                    <div className="pair-main">
                      <span className="pair-store">{p.siteName}</span>
                      <span className="pair-sku">
                        {p.skuName}
                        <code>{p.skuCode}</code>
                      </span>
                    </div>
                    <div className="pair-meta">
                      {p.siteAddress && <span>📍 {p.siteAddress}</span>}
                      {p.openingTime && <span>🕐 {p.openingTime}</span>}
                      {p.contact && <span>📞 {p.contact.replace(/^联系方式：/, "")}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="tool-footer">
            {parsed.present?.artifact?.title && (
              <span>
                展示建议：{parsed.present.artifact.title}（{parsed.present.artifact.type ?? "artifact"}
                {parsed.present.artifact.open ? ` · open: ${parsed.present.artifact.open}` : ""}）
              </span>
            )}
            {parsed.toolContractVersion != null && <span>toolContract v{parsed.toolContractVersion}</span>}
          </div>
        </>
      )}
    </div>
  );
};

/** 未注册工具的兜底卡片：直接展示 JSON */
export const GenericToolCard: ToolCallMessagePartComponent = ({ toolName, args, argsText, result }) => (
  <div className="tool-card">
    <div className="tool-card-header">
      <span className="tool-icon">🔧</span>
      <div className="tool-title">
        <strong>工具调用</strong>
        <code>{toolName}</code>
      </div>
      <span className={`badge ${result === undefined ? "badge-run" : "badge-ok"}`}>
        {result === undefined && <span className="dot-pulse" />}
        {result === undefined ? "调用中" : "已返回"}
      </span>
    </div>
    <div className="tool-args">
      <span className="args-label">参数</span>
      <code>{argsText?.trim() || JSON.stringify(args ?? {})}</code>
    </div>
    {result !== undefined && (
      <pre className="tool-json">{typeof result === "string" ? result : JSON.stringify(result, null, 2)}</pre>
    )}
  </div>
);
