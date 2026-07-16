// 自动驾驶：AI 每 N 秒拿一次局势快照 + 一组工具，
// 用 function-calling 自主调度。离线时用启发式 mock。
// autopilot 只是「另一个输入源」，复用全部已有 simulation 逻辑。

import type { AIClient, Message } from './types.ts';
import { buildAutopilotTools } from './tools.ts';
import type { GameState } from '../game/types.ts';
import { serializeSnapshot } from './advisor.ts';

const SYSTEM_PROMPT = `你是迷你地铁调度游戏的自动驾驶 AI。
每次给你当前局势和三个工具：create_line / extend_line / remove_line。
你的目标是尽量送达更多乘客、不让任何站点堵爆。

策略：
- 优先为最拥堵的站建立通往其目标形状的线路。
- 一条线最多覆盖 3-5 站，太长会降低效率。
- 线路冗余或绕远时果断 remove_line。
- 如果局势平稳，可以只回复文字「保持现状」而不调用任何工具。`;

export interface AutopilotAction {
  /** 是否实际做了改动。 */
  acted: boolean;
  /** 一句话说明做了什么（HUD 显示）。 */
  summary: string;
}

/** 执行一轮 AI 决策。返回本轮动作摘要。 */
export async function autopilotTick(ai: AIClient, state: GameState): Promise<AutopilotAction> {
  const tools = buildAutopilotTools(state);
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: serializeSnapshot(state) },
  ];

  try {
    const reply = await ai.chat({ messages, tools });

    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return { acted: false, summary: reply.content?.slice(0, 24) ?? '观察中' };
    }

    const summaries: string[] = [];
    for (const call of reply.toolCalls) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        summaries.push(`${call.name}?(未知工具)`);
        continue;
      }
      const result = await tool.execute(call.arguments);
      const ok = (result as { ok?: boolean }).ok;
      summaries.push(`${call.name} ${ok ? '✓' : '✗'}`);
    }
    return { acted: true, summary: summaries.join('  ') };
  } catch {
    return mockAutopilot(state);
  }
}

/** 离线启发式：为最堵站建线或延伸。 */
export function mockAutopilot(state: GameState): AutopilotAction {
  // 找最堵、且有乘客的站
  const overloaded = [...state.stations]
    .filter((s) => s.passengers.length > 0)
    .sort((a, b) => b.passengers.length - a.passengers.length);
  const worst = overloaded[0];
  if (!worst) return { acted: false, summary: '无需操作' };

  const target = worst.passengers[0]!.target;
  // 先尝试延伸已有线
  const tools = buildAutopilotTools(state);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  const extResult = extend.execute({ fromShape: worst.shape, toShape: target }) as { ok?: boolean };
  if (extResult.ok) return { acted: true, summary: 'extend_line ✓ (mock)' };

  const create = tools.find((t) => t.name === 'create_line')!;
  const crResult = create.execute({ fromShape: worst.shape, toShape: target }) as { ok?: boolean };
  if (crResult.ok) return { acted: true, summary: 'create_line ✓ (mock)' };

  return { acted: false, summary: '无法操作 (mock)' };
}
