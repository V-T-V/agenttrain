// 输入处理：把原始鼠标/键盘事件翻译成对 GameState 的结构操作。
// 拖拽语义（Mini Metro 风）：
//   1. 在空白处/站点上按下 → 若按在某条线路的端点站，开始「延伸/重接」那条线；
//      若按在普通站点，开始「新建线路」；
//   2. 拖动 → 画虚线预览；
//   3. 松开在另一站点上 → 建线/延伸；松开在空白 → 取消。
//
// 这里只做「解析意图 + 调用 simulation 的结构函数」，不碰主循环时间。

import { SNAP_DISTANCE, STATION_RADIUS } from './game/config.ts';
import { MAX_LINES } from './game/config.ts';
import type { GameState, LineColor, Vec2 } from './game/types.ts';
import { dist } from './game/geometry.ts';
import { createLine, extendLine, lineEndpoints, removeLine } from './game/simulation.ts';

/** 拖拽中状态的描述，供渲染画预览。 */
export interface DragState {
  /** 新建线路时用的预定颜色；延伸时为被延伸线路的颜色。 */
  color: LineColor;
  from: Vec2;
  to: Vec2;
  /** 正在延伸的线路 id（undefined 表示新建线路）。 */
  extendingLineId?: number;
  /** 延伸方向：true=加到头部，false=加到尾部。 */
  extendingAtStart?: boolean;
  /** 拖拽起点的站点 id。 */
  originStationId: number;
}

/**
 * 找到鼠标位置附近的站点（吸附半径内）。返回站点 id 或 null。
 */
export function stationAt(state: GameState, pos: Vec2): number | null {
  let best: number | null = null;
  let bestD = SNAP_DISTANCE + STATION_RADIUS;
  for (const s of state.stations) {
    const d = dist(s.pos, pos);
    if (d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}

/**
 * 判断某个站点是不是某条线路的「端点站」，返回该线路信息或 null。
 * 用于决定拖拽是「延伸已有线」还是「新建线」。
 */
export function lineEndingAt(
  state: GameState,
  stationId: number,
): { lineId: number; color: LineColor; atStart: boolean } | null {
  for (const line of state.lines) {
    const ends = lineEndpoints(state, line.id);
    if (ends.head === stationId) return { lineId: line.id, color: line.color, atStart: true };
    if (ends.tail === stationId) return { lineId: line.id, color: line.color, atStart: false };
  }
  return null;
}

/**
 * 鼠标按下：决定是否开始一次拖拽，返回 DragState 或 null。
 * - 按在线路端点站 → 延伸该线；
 * - 按在普通站点且还能建线 → 新建线；
 * - 否则不开始。
 */
export function beginDrag(state: GameState, pos: Vec2): DragState | null {
  const sid = stationAt(state, pos);
  if (sid === null) return null;
  const station = state.stations.find((s) => s.id === sid);
  if (!station) return null;

  // 优先：该站是某条线端点 → 延伸
  const ending = lineEndingAt(state, sid);
  if (ending) {
    return {
      color: ending.color,
      from: { ...station.pos },
      to: { ...pos },
      extendingLineId: ending.lineId,
      extendingAtStart: ending.atStart,
      originStationId: sid,
    };
  }

  // 否则尝试新建（还有线路名额才允许）
  if (state.lines.length >= MAX_LINES) return null;
  const color = pickFreshColor(state);
  return {
    color,
    from: { ...station.pos },
    to: { ...pos },
    originStationId: sid,
  };
}

/**
 * 拖动中：更新预览终点。若靠近某站点则吸附到该站坐标。
 */
export function updateDrag(state: GameState, drag: DragState, pos: Vec2): DragState {
  const sid = stationAt(state, pos);
  if (sid !== null && sid !== drag.originStationId) {
    const st = state.stations.find((s) => s.id === sid);
    if (st) return { ...drag, to: { ...st.pos } };
  }
  return { ...drag, to: { ...pos } };
}

/**
 * 松开：完成建线/延伸；返回更新后的 DragState（用于清空）。
 * 失败（松在空白/同一站/无效）则什么都不做。
 */
export function endDrag(state: GameState, drag: DragState, pos: Vec2): void {
  const targetId = stationAt(state, pos);
  if (targetId === null || targetId === drag.originStationId) return;

  if (drag.extendingLineId !== undefined && drag.extendingAtStart !== undefined) {
    extendLine(state, drag.extendingLineId, targetId, drag.extendingAtStart);
  } else {
    createLine(state, drag.originStationId, targetId);
  }
}

/** 右键/双击某条线时删除它（简化操作：双击线路删除）。 */
export function deleteLineNear(state: GameState, pos: Vec2): void {
  // 找到鼠标距离哪条线最近且足够近
  let bestId: number | null = null;
  let bestD = 12;
  for (const line of state.lines) {
    const pts = line.stops
      .map((sid) => state.stations.find((s) => s.id === sid)?.pos)
      .filter((p): p is Vec2 => !!p);
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSeg(pos, pts[i]!, pts[i + 1]!);
      if (d < bestD) {
        bestD = d;
        bestId = line.id;
      }
    }
  }
  if (bestId !== null) removeLine(state, bestId);
}

/** 选一个尚未被使用的线路颜色。 */
function pickFreshColor(state: GameState): LineColor {
  const order: LineColor[] = ['red', 'blue', 'green', 'orange', 'purple', 'pink', 'teal'];
  const used = new Set(state.lines.map((l) => l.color));
  for (const c of order) if (!used.has(c)) return c;
  return order[0]!;
}

// 局部点到线段距离（避免和 geometry 形成循环依赖的小副本）
function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

// ---------- 统一指针抽象（鼠标 + 触摸）----------
// 参考 kids-games/src/core/input.ts 的 bindPointer：优先 PointerEvent，
// 回退到 mouse + touch 分立事件。让拖拽逻辑同时支持桌面鼠标和移动端触摸。

/** 统一的指针位置（屏幕坐标，供 toWorld 转换）。 */
export interface PointerPoint {
  clientX: number;
  clientY: number;
}

/** 统一的按下事件信息。button: 0=主键/触摸, 2=右键。 */
export interface PointerDown {
  point: PointerPoint;
  button: number;
}

/** 统一的指针处理器集合。 */
export interface PointerHandlers {
  onDown?: (e: PointerDown) => void;
  onMove?: (e: PointerPoint) => void;
  onUp?: (e: PointerPoint) => void;
}

/**
 * 给目标元素绑定统一的指针事件。
 * 优先用 PointerEvent（现代浏览器，一套事件覆盖鼠标/触摸/笔）；
 * 无 PointerEvent 时回退 mouse + touch 分立事件（touch 加 preventDefault 防页面滚动）。
 * @returns 解绑函数，调用后移除所有监听器。
 */
export function bindPointer(target: HTMLElement, handlers: PointerHandlers): () => void {
  const { onDown, onMove, onUp } = handlers;

  // 优先 PointerEvent
  if (typeof (window as unknown as { PointerEvent?: unknown }).PointerEvent !== 'undefined') {
    const down = (e: PointerEvent) =>
      onDown?.({ point: { clientX: e.clientX, clientY: e.clientY }, button: e.button });
    const move = (e: PointerEvent) => onMove?.({ clientX: e.clientX, clientY: e.clientY });
    const up = (e: PointerEvent) => onUp?.({ clientX: e.clientX, clientY: e.clientY });
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }

  // 回退：mouse + touch 分立
  const mouseDown = (e: MouseEvent) =>
    onDown?.({ point: { clientX: e.clientX, clientY: e.clientY }, button: e.button });
  const mouseMove = (e: MouseEvent) => onMove?.({ clientX: e.clientX, clientY: e.clientY });
  const mouseUp = (e: MouseEvent) => onUp?.({ clientX: e.clientX, clientY: e.clientY });
  target.addEventListener('mousedown', mouseDown);
  target.addEventListener('mousemove', mouseMove);
  window.addEventListener('mouseup', mouseUp);

  const touchStart = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault(); // 防止触摸触发页面滚动/缩放
    const t = e.changedTouches[0];
    if (t) onDown?.({ point: { clientX: t.clientX, clientY: t.clientY }, button: 0 });
  };
  const touchMove = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    const t = e.changedTouches[0];
    if (t) onMove?.({ clientX: t.clientX, clientY: t.clientY });
  };
  const touchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (t) onUp?.({ clientX: t.clientX, clientY: t.clientY });
  };
  target.addEventListener('touchstart', touchStart, { passive: false });
  target.addEventListener('touchmove', touchMove, { passive: false });
  target.addEventListener('touchend', touchEnd);

  return () => {
    target.removeEventListener('mousedown', mouseDown);
    target.removeEventListener('mousemove', mouseMove);
    window.removeEventListener('mouseup', mouseUp);
    target.removeEventListener('touchstart', touchStart);
    target.removeEventListener('touchmove', touchMove);
    target.removeEventListener('touchend', touchEnd);
  };
}
