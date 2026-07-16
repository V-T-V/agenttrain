// 线路几何：把「线路 + 列车进度」映射到画布坐标，以及距离/命中辅助。
// 全部是纯函数，便于单测，且不依赖游戏状态结构（只吃坐标数组）。

import type { Vec2 } from './types.ts';

/** 欧氏距离。 */
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * 给定一组有序站点坐标，计算列车当前位置。
 * @param points 线路上各站点的坐标（points.length >= 2）
 * @param segment 当前所在段索引（points[segment] -> points[segment+1]）
 * @param t 段内进度 [0,1)
 * @returns 站在世界坐标系下的坐标
 */
export function positionAlong(points: readonly Vec2[], segment: number, t: number): Vec2 {
  if (points.length < 2) {
    const p = points[0];
    if (!p) return { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  }
  const seg = Math.max(0, Math.min(segment, points.length - 2));
  const from = points[seg]!;
  const to = points[seg + 1]!;
  const tt = Math.max(0, Math.min(1, t));
  return { x: from.x + (to.x - from.x) * tt, y: from.y + (to.y - from.y) * tt };
}

/** 线路总长度（所有段长度之和）。 */
export function totalLength(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += dist(points[i]!, points[i + 1]!);
  }
  return sum;
}

/** 单段长度。 */
export function segmentLength(points: readonly Vec2[], segment: number): number {
  if (segment < 0 || segment >= points.length - 1) return 0;
  return dist(points[segment]!, points[segment + 1]!);
}

/**
 * 在线段集合中找到离 point 最近的点所属的段索引。
 * 用于命中检测 / 拖拽吸附。
 * @returns 命中的段索引，没有合法段时返回 -1。
 */
export function nearestSegmentIndex(points: readonly Vec2[], point: Vec2): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegment(point, points[i]!, points[i + 1]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 点到线段的距离。 */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const closest = closestPointOnSegment(p, a, b);
  return dist(p, closest);
}

/** 点在线段上的最近点。 */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}
