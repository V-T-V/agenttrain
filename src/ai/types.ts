// 前端 AI 层共享类型。
// 刻意保持与 agentresearch/src/agent/types.ts 一致的形状（Message / ToolCall / ToolDef），
// 这样两个子项目在 AI 交互上的「契约」是统一的。

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 一条对话消息。 */
export interface Message {
  role: Role;
  content: string | null;
  /** 仅 assistant：模型要调用的工具。 */
  toolCalls?: ToolCall[];
  /** 仅 tool：对应的工具调用 id。 */
  toolCallId?: string;
  /** 仅 tool：工具名（用于日志）。 */
  name?: string;
}

/** 模型发起的一次工具调用。 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** OpenAI 风格的工具参数 JSON Schema 子集。 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
}

export interface JsonSchemaProp {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number)[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

/** 一个可被模型调用的工具定义。 */
export interface ToolDef<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: TArgs) => unknown | Promise<unknown>;
}

/** OpenAI 风格的工具描述（发给代理时用）。 */
export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: ToolParameters };
}

/** 把 ToolDef 转成发给代理的 tools 描述。 */
export function toOpenAITools(tools: ToolDef[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** AI 客户端：发消息（可选附带工具），返回 assistant 回复。 */
export interface AIClient {
  /** 是否处于离线 Mock 状态（没接通真实 LLM）。 */
  readonly online: boolean;
  chat(input: { messages: Message[]; tools?: ToolDef[] }): Promise<Message>;
}
