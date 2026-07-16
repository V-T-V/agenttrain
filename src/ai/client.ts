// 前端 AI 客户端。
// 调用同源 /api/chat（开发期由 Vite 代理转发到本地 server）。
// 任何失败（代理没起 / 503 / 超时）都优雅降级为 MockAI，保证游戏离线可玩。

import {
  type AIClient,
  type Message,
  type ToolCall,
  type ToolDef,
  toOpenAITools,
} from './types.ts';

/** 默认请求超时（毫秒）。LLM 偶尔较慢，给到 25s。 */
const DEFAULT_TIMEOUT_MS = 25000;

/**
 * 真实客户端：走 /api/chat 代理。
 * online 状态在首次成功后置 true；失败即视为离线，后续走 MockAI。
 */
class HttpAIClient implements AIClient {
  online = false;
  private readonly timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async chat(input: { messages: Message[]; tools?: ToolDef[] }): Promise<Message> {
    const body = {
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.arguments) },
              })),
            }
          : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      tools: input.tools?.length ? toOpenAITools(input.tools) : undefined,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        throw new Error(`代理返回 ${resp.status}`);
      }
      const json = (await resp.json()) as { data?: { choices?: { message?: RawMsg }[] } };
      const msg = json.data?.choices?.[0]?.message;
      if (!msg) throw new Error('代理返回为空');
      this.online = true;
      return normalize(msg);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 代理返回的原始 assistant 消息。 */
interface RawMsg {
  role?: string;
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}

/** 把代理返回标准化为内部 Message。 */
function normalize(msg: RawMsg): Message {
  const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((c) => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      parsedArgs = { __raw: c.function.arguments };
    }
    return { id: c.id, name: c.function.name, arguments: parsedArgs };
  });
  return {
    role: 'assistant',
    content: msg.content ?? null,
    ...(toolCalls?.length ? { toolCalls } : {}),
  };
}

/**
 * MockAI：离线回退。
 * 不调用网络，按规则给出「占位但结构正确」的回复，让三个 AI 功能都能跑通：
 * - 要求 JSON 时回固定剧本/建议 JSON；
 * - 带工具时回一个合理的工具调用（基于局势）；
 * - 否则回一句话。
 */
export class MockAIClient implements AIClient {
  readonly online = false;
  constructor(
    private readonly delegate: (input: {
      messages: Message[];
      tools?: ToolDef[];
    }) => string | Message,
  ) {}

  async chat(input: { messages: Message[]; tools?: ToolDef[] }): Promise<Message> {
    // 模拟一点延迟，体验更接近真实
    await delay(150 + Math.random() * 200);
    const out = this.delegate(input);
    if (typeof out === 'string') return { role: 'assistant', content: out };
    return out;
  }
}

/**
 * 工厂：先尝试真实客户端；若 health 探测失败则返回一个 Mock 包装。
 * 返回的 client 永远可用（在线就用真 LLM，离线就走 mock delegate）。
 */
export async function createAIClient(
  mockDelegate: (input: { messages: Message[]; tools?: ToolDef[] }) => string | Message,
): Promise<AIClient> {
  const real = new HttpAIClient();
  try {
    const resp = await fetch('/api/health', { method: 'GET' });
    if (resp.ok) {
      const info = (await resp.json()) as { configured?: boolean };
      if (info.configured) {
        // 代理在线且配了 key：用真实客户端，但失败时仍要能降级。
        return new FallbackClient(real, new MockAIClient(mockDelegate));
      }
    }
  } catch {
    // 代理没起，直接走 mock
  }
  return new MockAIClient(mockDelegate);
}

/**
 * 包装客户端：优先真实，失败降级 mock。
 * online 反映「当前是否在用真实 LLM」。
 */
class FallbackClient implements AIClient {
  online = false;
  constructor(
    private readonly primary: HttpAIClient,
    private readonly fallback: MockAIClient,
  ) {}

  async chat(input: { messages: Message[]; tools?: ToolDef[] }): Promise<Message> {
    try {
      const msg = await this.primary.chat(input);
      this.online = this.primary.online;
      return msg;
    } catch {
      this.online = false;
      return this.fallback.chat(input);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
