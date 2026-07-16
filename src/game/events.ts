// 剧本事件调度（纯函数，可单测）。
// 负责：到点把 ScriptedEvent 转成 ActiveEvent；逐帧衰减 ActiveEvent；提供查询。

import type { ActiveEvent, Scenario, ScriptedEvent, Shape } from './types.ts';

/**
 * 把 scenario.events 拷成 eventQueue（按 at 排序）。
 * 返回新数组，不改 scenario。
 */
export function buildEventQueue(scenario: Scenario): ScriptedEvent[] {
  return [...scenario.events].sort((a, b) => a.at - b.at);
}

/**
 * 推进事件队列：把 elapsed 时已到点的事件转化为 active，
 * 从 eventQueue 里移除。原地修改 state-like 入参。
 */
export function pumpEvents(
  elapsed: number,
  eventQueue: ScriptedEvent[],
  active: ActiveEvent[],
): void {
  let i = 0;
  while (i < eventQueue.length) {
    const ev = eventQueue[i]!;
    if (ev.at <= elapsed) {
      active.push({
        kind: ev.kind,
        stationShape: ev.stationShape,
        remaining: ev.duration,
      });
      eventQueue.splice(i, 1);
    } else {
      // 已排序，后续都更晚
      break;
    }
    i++;
  }
}

/** 逐帧衰减所有 active 事件的剩余时间，归零即移除。原地修改 active。 */
export function tickActiveEvents(active: ActiveEvent[], dt: number): void {
  for (let i = active.length - 1; i >= 0; i--) {
    active[i]!.remaining -= dt;
    if (active[i]!.remaining <= 0) active.splice(i, 1);
  }
}

/** 当前是否有「某形状站点罢工」生效。 */
export function isStrikeActive(active: ActiveEvent[], shape: Shape): boolean {
  return active.some((a) => a.kind === 'strike' && a.stationShape === shape);
}

/** 当前是否有「列车减速」生效（全局）。 */
export function isSlowActive(active: ActiveEvent[]): boolean {
  return active.some((a) => a.kind === 'slow');
}

/** 当前是否有「乘客涌现」（针对某形状站点）。 */
export function isSurgeActive(active: ActiveEvent[], shape: Shape): boolean {
  return active.some((a) => a.kind === 'surge' && a.stationShape === shape);
}

/** 把 active 事件转成简短中文描述（供 HUD/渲染用）。 */
export function describeActive(active: ActiveEvent[]): string {
  if (active.length === 0) return '';
  const names: Record<ActiveEvent['kind'], string> = {
    strike: '罢工',
    slow: '减速',
    surge: '高峰',
  };
  return active
    .map((a) => {
      const base = names[a.kind];
      const sh = a.stationShape ? emojiOf(a.stationShape) : '';
      return `${sh}${base}`;
    })
    .join(' ');
}

function emojiOf(shape: Shape): string {
  switch (shape) {
    case 'circle':
      return '○';
    case 'triangle':
      return '△';
    case 'square':
      return '□';
    case 'diamond':
      return '◇';
    case 'star':
      return '☆';
  }
}
