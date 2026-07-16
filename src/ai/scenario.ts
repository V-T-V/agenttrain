// 剧本生成：调用 AI 生成一局的结构化参数包，并做健壮的解析与降级。
// 解析/校验部分是纯函数（parseScenario / mockScenario），便于单测。

import type { AIClient, Message } from './types.ts';
import { defaultScenario } from '../game/state.ts';
import { ALL_SHAPES, type Scenario, type ScriptedEvent, type Shape } from '../game/types.ts';

const SYSTEM_PROMPT = `你是迷你地铁调度游戏（Mini Metro 风格）的关卡设计师。
你要为玩家生成一局「剧本」，控制难度与趣味性。

站点形状有：circle triangle square diamond star。
事件类型只有三种：
- strike：某形状的站点停运一段时间，列车经过不装卸
- slow：全图列车减速到一半
- surge：乘客涌现，生成变快

只输出一个 JSON 对象，不要任何解释文字。格式：
{
  "cityName": "字符串，中文城市/季节名，4-10字",
  "description": "一句话描述本局氛围，15-30字",
  "trainSpeedMultiplier": 0.8到1.0的数，越小越难,
  "stationIntervalMultiplier": 0.8到1.2的数，越小站点越密,
  "events": [
    { "at": 游戏开始后秒数(20-90), "kind": "strike|slow|surge", "stationShape": "circle等(strike/surge必填)", "duration": 秒数(8-20) }
  ],
  "deliverTarget": 送达目标人数(40-80)
}
events 数组 1-3 个事件，at 递增，shape 取自上述五种。`;

/** 构造一次剧本生成请求。 */
export async function generateScenario(
  ai: AIClient,
  rng: () => number,
): Promise<{ scenario: Scenario; online: boolean }> {
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: '请生成一局难度适中、有个性的剧本。' },
  ];
  try {
    const reply = await ai.chat({ messages });
    const scenario = parseScenario(reply.content ?? '', rng);
    return { scenario, online: ai.online };
  } catch {
    return { scenario: mockScenario(rng), online: false };
  }
}

/**
 * 从 LLM 文本里抠出 JSON 并解析成 Scenario。
 * 容错：兼容 ```json 代码块包裹、前后多余文字。
 * 解析失败返回默认剧本（保证游戏永远能开局）。
 */
export function parseScenario(text: string, rng: () => number): Scenario {
  const jsonStr = extractJson(text);
  if (!jsonStr) return defaultScenario();
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    return defaultScenario();
  }
  return normalizeScenario(obj, rng);
}

/** 从可能含 markdown / 解释文字的文本里提取第一个 JSON 对象。 */
export function extractJson(text: string): string | null {
  // 先去 ```json ... ``` 围栏
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** 把任意结构归一化成合法 Scenario，非法字段用默认值兜底。 */
export function normalizeScenario(obj: unknown, rng: () => number): Scenario {
  const o = (obj ?? {}) as Record<string, unknown>;
  const events: ScriptedEvent[] = [];
  if (Array.isArray(o.events)) {
    let lastAt = 0;
    for (const raw of o.events) {
      const ev = normalizeEvent(raw, lastAt, rng);
      if (ev) {
        events.push(ev);
        lastAt = ev.at;
      }
      if (events.length >= 3) break;
    }
  }
  return {
    cityName: nonEmpty(o.cityName, 12, '通勤之城'),
    description: nonEmpty(o.description, 40, defaultScenario().description),
    trainSpeedMultiplier: clampNum(o.trainSpeedMultiplier, 0.7, 1, 1),
    stationIntervalMultiplier: clampNum(o.stationIntervalMultiplier, 0.8, 1.2, 1),
    events,
    deliverTarget: clampInt(o.deliverTarget, 40, 80, 60),
  };
}

/** 把单个事件对象归一化。返回 null 表示丢弃。 */
function normalizeEvent(raw: unknown, minAt: number, rng: () => number): ScriptedEvent | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const kind = e.kind;
  if (kind !== 'strike' && kind !== 'slow' && kind !== 'surge') return null;

  // at 必须递增且在合理区间
  let at = typeof e.at === 'number' ? e.at : 20 + Math.floor(rng() * 40);
  at = Math.max(minAt + 5, Math.min(90, at));

  let stationShape: Shape | undefined;
  if (kind === 'strike' || kind === 'surge') {
    const s = e.stationShape;
    stationShape = ALL_SHAPES.includes(s as Shape)
      ? (s as Shape)
      : ALL_SHAPES[Math.floor(rng() * 3)]!;
  }

  const duration = clampInt(e.duration, 8, 20, 12);
  const ev: ScriptedEvent = { at, kind, duration };
  if (stationShape) ev.stationShape = stationShape;
  return ev;
}

/** 离线 mock：用 rng 生成一个确定性但随机的剧本。 */
export function mockScenario(rng: () => number): Scenario {
  const names = ['雾港', '雨城', '熔炉', '霜都', '夜行线', '早高峰'];
  const descs = [
    '一场突如其来的大雾笼罩了线路。',
    '暴雨倾盆，列车开始减速。',
    '通勤高峰，乘客涌现。',
  ];
  const kinds: ScriptedEvent['kind'][] = ['strike', 'slow', 'surge'];
  const events: ScriptedEvent[] = [];
  let lastAt = 15 + Math.floor(rng() * 15);
  const n = 1 + Math.floor(rng() * 2); // 1-2 个
  for (let i = 0; i < n; i++) {
    const kind = kinds[Math.floor(rng() * kinds.length)]!;
    const ev: ScriptedEvent = {
      at: lastAt,
      kind,
      duration: 8 + Math.floor(rng() * 10),
    };
    if (kind !== 'slow') ev.stationShape = ALL_SHAPES[Math.floor(rng() * 3)]!;
    events.push(ev);
    lastAt += 15 + Math.floor(rng() * 20);
  }
  return {
    cityName: names[Math.floor(rng() * names.length)]!,
    description: descs[Math.floor(rng() * descs.length)]!,
    trainSpeedMultiplier: 0.8 + rng() * 0.2,
    stationIntervalMultiplier: 0.9 + rng() * 0.2,
    events,
    deliverTarget: 50 + Math.floor(rng() * 20),
  };
}

/** 取非空字符串（去空白后），超长截断，空则用 fallback。不强制最小长度（中文名常较短）。 */
function nonEmpty(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (s.length === 0) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = clampNum(v, min, max, fallback);
  return Math.round(n);
}
