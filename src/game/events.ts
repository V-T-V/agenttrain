// 剧本事件调度（纯函数，可单测）。
// 负责：到点把 ScriptedEvent 转成 ActiveEvent；逐帧衰减 ActiveEvent；提供查询。
// 事件类型的 isActive/describe 已插件化到 eventRegistry.ts。

import type { ActiveEvent, Scenario, ScriptedEvent, Shape } from './types.ts';
import { describeEvents, isEventActive } from './eventRegistry.ts';

// 向后兼容：旧调用方仍可用 isStrikeActive/isSlowActive/isSurgeActive/describeActive
export function isStrikeActive(active: readonly ActiveEvent[], shape: Shape): boolean {
  return isEventActive(active, 'strike', shape);
}
export function isSlowActive(active: readonly ActiveEvent[]): boolean {
  return isEventActive(active, 'slow');
}
export function isSurgeActive(active: readonly ActiveEvent[], shape: Shape): boolean {
  return isEventActive(active, 'surge', shape);
}
export function describeActive(active: readonly ActiveEvent[]): string {
  return describeEvents(active);
}

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
  // 从队首逐个检查：到点的事件移入 active 并从队列移除（splice 后不前进 i），
  // 遇到第一个未到点的事件即停止（队列已按 at 升序排序）。
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
      // splice 后 index i 的元素下移到 i，不递增 i，继续检查同一位置
    } else {
      // 已排序，后续都更晚
      break;
    }
  }
}

/** 逐帧衰减所有 active 事件的剩余时间，归零即移除。原地修改 active。 */
export function tickActiveEvents(active: ActiveEvent[], dt: number): void {
  for (let i = active.length - 1; i >= 0; i--) {
    active[i]!.remaining -= dt;
    if (active[i]!.remaining <= 0) active.splice(i, 1);
  }
}
