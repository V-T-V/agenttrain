// 策略顾问：把当前局势序列化成文本喂给 LLM，解析它的建议。
// 序列化与解析都是纯函数（serializeSnapshot / parseAdvice），便于单测。
// 顾问只「建议」，不代操作；玩家点采纳后由 UI 高亮提示该连的两站。

import type { AIClient, Message } from './types.ts';
import type { GameState, Shape } from '../game/types.ts';
import { describeActive } from '../game/events.ts';
import { shapeGlyph } from '../game/shapes.ts';
import { summarizeStrategy, evaluateLine } from '../game/lineStrategy.ts';

/** 一条结构化建议：描述要做什么 + 涉及的形状（用于高亮）。 */
export interface Advice {
  /** 一句话点评（显示给玩家）。 */
  comment: string;
  /** 建议的动作。 */
  action: AdviceAction;
  /** 涉及的站点形状，UI 据此高亮。 */
  fromShape?: Shape;
  toShape?: Shape;
}

export type AdviceAction = 'create' | 'extend' | 'remove' | 'observe';

const SYSTEM_PROMPT = `你是迷你地铁调度游戏的策略顾问。玩家会给你当前局势快照。
你要给出：一句话点评 + 一条最该立刻做的事。

只输出一个 JSON 对象，不要解释：
{
  "comment": "一句话点评，20字内",
  "action": "create|extend|remove",
  "fromShape": "circle|triangle|square|diamond|star",
  "toShape": "同上，表示要连到的目标形状"
}
- create=建议新建一条线连接 fromShape→toShape 两个站点
- extend=建议把现有线路延伸到 toShape
- remove=建议删除最没用的线路
优先缓解拥堵最严重的站点。`;

/** 把游戏状态序列化成简短文本快照（喂给 LLM）。纯函数。 */
export function serializeSnapshot(state: GameState): string {
  const cap = state.capacity;
  const stationLines = state.stations.map((s) => {
    const wait = s.passengers.length;
    const targets = countTargets(s.passengers);
    const overload = wait >= cap ? '⚠️过载' : '';
    return `  - ${shapeName(s.shape)}站(id${s.id}) 等待${wait}/${cap} ${overload} 去往:${targets}`;
  });

  const lineLines = state.lines.map((l, i) => {
    const shapes = l.stops
      .map((sid) => state.stations.find((s) => s.id === sid)?.shape)
      .filter(Boolean)
      .map((s) => shapeName(s as Shape))
      .join('-');
    return `  - 线${i}(${l.color}): ${shapes}`;
  });

  const active = describeActive(state.activeEvents);
  // 线路策略评估：告诉 LLM 哪条线最差、全局拥堵/利用率概况，便于它给出重构建议。
  const strategy = summarizeStrategy(state);
  const strategyLine =
    strategy.lineCount > 0
      ? `  策略: 均分${strategy.averageScore} 全局拥堵${strategy.totalCongestedStops} 利用率${(strategy.globalTrainUtilization * 100).toFixed(0)}% 形状覆盖${strategy.globalShapeCoverage}/5 — ${strategy.advice}`
      : '  策略: (尚无线路)';
  return [
    `时间: ${Math.floor(state.elapsed)}s  已送达: ${state.delivered}/${state.scenario.deliverTarget}  线路: ${state.lines.length}/7${active ? `  事件: ${active}` : ''}`,
    '站点:',
    ...stationLines,
    '线路:',
    ...(lineLines.length ? lineLines : ['  (无线路)']),
    strategyLine,
  ].join('\n');
}

/** 统计站台乘客的目标形状分布。 */
function countTargets(passengers: { target: Shape }[]): string {
  const m = new Map<string, number>();
  for (const p of passengers) m.set(p.target, (m.get(p.target) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${shapeName(k as Shape)}×${v}`).join(' ') || '无';
}

/** 请求一条建议。 */
export async function askAdvice(ai: AIClient, state: GameState): Promise<Advice> {
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: serializeSnapshot(state) },
  ];
  try {
    const reply = await ai.chat({ messages });
    return parseAdvice(reply.content ?? '', state);
  } catch {
    return mockAdvice(state);
  }
}

/** 从 LLM 文本解析建议。容错：取 JSON、字段非法则降级为 observe。 */
export function parseAdvice(text: string, state: GameState): Advice {
  const jsonStr = extractJson(text);
  if (!jsonStr) return mockAdvice(state);
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    return mockAdvice(state);
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  const action: AdviceAction = isAction(o.action) ? (o.action as AdviceAction) : 'observe';

  const fromShape = asShape(o.fromShape);
  const toShape = asShape(o.toShape);
  const comment =
    typeof o.comment === 'string' && o.comment.trim().length > 0
      ? clampStr(o.comment.trim(), 4, 30)
      : '观察一下局势。';

  return { comment, action, fromShape, toShape };
}

/** 离线 mock 启发式：找最堵的站，建议把它的乘客目标形状连起来。 */
export function mockAdvice(state: GameState): Advice {
  const overloaded = [...state.stations].sort((a, b) => b.passengers.length - a.passengers.length);
  const worst = overloaded[0];
  if (!worst || worst.passengers.length === 0) {
    return { comment: '线路通畅，继续保持。', action: 'observe' };
  }
  const topTarget = worst.passengers[0]!.target;
  return {
    comment: `${shapeName(worst.shape)}站拥堵，建议连到${shapeName(topTarget)}站。`,
    action: state.lines.length < 7 ? 'create' : 'extend',
    fromShape: worst.shape,
    toShape: topTarget,
  };
}

/**
 * 线路策略建议：基于多线路评估系统，给出「重构/延伸最差线路」的结构化建议。
 * 纯函数（只读 state），用于离线启发式增强与 UI 展示。
 *
 * 决策规则：
 *  - 无线路或仅一条线 → 返回 observe（策略对单线无意义）。
 *  - 最差线路 overall < 35 且线路数 >= 2 → 建议 remove 该线（腾出线路槽）。
 *  - 否则若最差线路某一端可延伸且该端存在拥堵站 → 建议 extend。
 *  - 否则 → observe 并附上策略点评（strategy.advice）。
 */
export function lineStrategyAdvice(state: GameState): Advice {
  const strategy = summarizeStrategy(state);
  if (strategy.lineCount < 2 || strategy.worstLineId === null) {
    return { comment: strategy.advice, action: 'observe' };
  }
  const worstLine = state.lines.find((l) => l.id === strategy.worstLineId);
  if (!worstLine) {
    return { comment: strategy.advice, action: 'observe' };
  }
  const score = evaluateLine(state, worstLine);

  // 最差线得分过低 → 建议删除重构
  if (score.overall < 35) {
    return {
      comment: `${worstLine.color}线综合评分仅 ${score.overall}，建议拆除重构。`,
      action: 'remove',
    };
  }

  // 找最差线路上最堵的站，若端点可延伸则建议延伸到其乘客目标形状
  const stopsOnLine = worstLine.stops
    .map((sid) => state.stations.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (stopsOnLine.length > 0 && score.congestedStops > 0) {
    const worstStop = [...stopsOnLine].sort((a, b) => b.passengers.length - a.passengers.length)[0]!;
    const topTarget = worstStop.passengers[0]?.target;
    const canExtend = score.expandableHead || score.expandableTail;
    if (topTarget && canExtend) {
      return {
        comment: `${worstLine.color}线沿线拥堵，建议延伸到${shapeName(topTarget)}站分流。`,
        action: 'extend',
        fromShape: worstStop.shape,
        toShape: topTarget,
      };
    }
  }

  return { comment: strategy.advice, action: 'observe' };
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function isAction(v: unknown): boolean {
  return v === 'create' || v === 'extend' || v === 'remove' || v === 'observe';
}

function asShape(v: unknown): Shape | undefined {
  const shapes: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'star'];
  return shapes.includes(v as Shape) ? (v as Shape) : undefined;
}

function clampStr(v: string, min: number, max: number): string {
  return v.length > max ? v.slice(0, max) : v.length < min ? v.padEnd(min, '。') : v;
}

/** 形状 → 单字符展示。委托给 shapes.ts 的统一实现（消除重复）。 */
export function shapeName(s: Shape): string {
  return shapeGlyph(s);
}
