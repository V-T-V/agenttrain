// 策略顾问：把当前局势序列化成文本喂给 LLM，解析它的建议。
// 序列化与解析都是纯函数（serializeSnapshot / parseAdvice），便于单测。
// 顾问只「建议」，不代操作；玩家点采纳后由 UI 高亮提示该连的两站。

import type { AIClient, Message } from './types.ts';
import type { GameState, Shape } from '../game/types.ts';
import { describeActive } from '../game/events.ts';
import { shapeGlyph } from '../game/shapes.ts';

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
  return [
    `时间: ${Math.floor(state.elapsed)}s  已送达: ${state.delivered}/${state.scenario.deliverTarget}  线路: ${state.lines.length}/7${active ? `  事件: ${active}` : ''}`,
    '站点:',
    ...stationLines,
    '线路:',
    ...(lineLines.length ? lineLines : ['  (无线路)']),
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
