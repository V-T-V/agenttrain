// 事件类型插件注册表 —— 与 powerupRegistry 同理：加新事件类型只需在此注册一个对象。
//
// 每种事件类型是一个 EventTypeDef，包含：
//   - kind: 唯一标识（对应 ScriptedEvent.kind）
//   - name: 中文名（HUD 展示）
//   - needsShape: 是否需要 stationShape 参数（strike/surge 需要，slow 不需要）
//   - isActive: 给定 active 列表 + shape，判断该事件是否生效
//   - onSimulate: 可选，在 simulation step 中对该事件做额外处理（如 surge 多刷乘客）
//
// 这样 events.ts 的 isStrikeActive/isSlowActive/isSurgeActive 不再各写一个，
// simulation.ts 也不需要硬编码 hasSurge，而是遍历注册表。

import type { ActiveEvent, Shape } from './types.ts';
import { shapeGlyph } from './shapes.ts';

/** 事件类型定义（插件式）。 */
export interface EventTypeDef {
  kind: string;
  name: string;
  /** 是否需要 stationShape 参数。 */
  needsShape: boolean;
  /** 判断该事件是否在 active 列表中生效。shape 可选（全局事件忽略）。 */
  isActive: (active: readonly ActiveEvent[], shape?: Shape) => boolean;
}

/** 全部已注册事件类型。加新事件只需在此追加一项。 */
export const EVENT_TYPE_REGISTRY: readonly EventTypeDef[] = [
  {
    kind: 'strike',
    name: '罢工',
    needsShape: true,
    isActive: (active, shape) =>
      shape !== undefined && active.some((a) => a.kind === 'strike' && a.stationShape === shape),
  },
  {
    kind: 'slow',
    name: '减速',
    needsShape: false,
    isActive: (active) => active.some((a) => a.kind === 'slow'),
  },
  {
    kind: 'surge',
    name: '高峰',
    needsShape: true,
    isActive: (active, shape) =>
      shape !== undefined && active.some((a) => a.kind === 'surge' && a.stationShape === shape),
  },
];

const EVENT_MAP: Map<string, EventTypeDef> = new Map(EVENT_TYPE_REGISTRY.map((e) => [e.kind, e]));

/** 按 kind 查事件类型定义。 */
export function getEventTypeDef(kind: string): EventTypeDef | undefined {
  return EVENT_MAP.get(kind);
}

/** 通用：判断某 kind 的事件是否生效（可带 shape）。 */
export function isEventActive(
  active: readonly ActiveEvent[],
  kind: string,
  shape?: Shape,
): boolean {
  const def = EVENT_MAP.get(kind);
  return def ? def.isActive(active, shape) : false;
}

/** 把 active 事件转成简短中文描述（供 HUD 用）。遍历注册表自动支持新事件类型。 */
export function describeEvents(active: readonly ActiveEvent[]): string {
  if (active.length === 0) return '';
  return active
    .map((a) => {
      const def = EVENT_MAP.get(a.kind);
      const name = def?.name ?? a.kind;
      const sh = a.stationShape ? shapeGlyph(a.stationShape) : '';
      return `${sh}${name}`;
    })
    .join(' ');
}
