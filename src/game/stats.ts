// 本局统计：从 GameState 派生结算面板用的汇总数据。
// 纯函数，不碰 DOM，便于单测。供 Game Over 面板 / 成就检测复用。

import type { GameState, Line } from './types.ts';
import { totalLength } from './geometry.ts';
import { linePoints } from './simulation.ts';

/** 本局汇总统计（结算面板展示用）。 */
export interface RunStats {
  /** 本局送达乘客数（= 分数）。 */
  delivered: number;
  /** 游戏时长（秒）。 */
  durationSec: number;
  /** 平均效率：每分钟送达乘客数（delivered / minutes）。 */
  efficiency: number;
  /** 最长线路的站点数（含两端）。 */
  longestLineStops: number;
  /** 最长线路的世界长度（像素）。 */
  longestLineLength: number;
  /** 本局达到的最高连击数。 */
  peakCombo: number;
  /** 最高连击对应的得分倍率（含连击阶梯）。 */
  peakComboMultiplier: number;
  /** 本局建立的线路总数。 */
  linesBuilt: number;
  /** 本局使用的道具总次数。 */
  powerUpsUsed: number;
  /** 当前在线线路数（未被删除）。 */
  activeLines: number;
  /** 列车总数。 */
  trainCount: number;
  /** 是否达成送达目标。 */
  reachedTarget: boolean;
  /** 送达目标值。 */
  deliverTarget: number;
  /** 完成度（0-1）：delivered / deliverTarget，可超过 1。 */
  completion: number;
}

/**
 * 从 GameState + 本局累计值（linesBuilt/powerUpsUsed 由 main.ts 跟踪）派生结算统计。
 */
export function computeRunStats(
  state: GameState,
  linesBuilt: number,
  powerUpsUsed: number,
): RunStats {
  const minutes = state.elapsed / 60;
  const efficiency = minutes > 0 ? state.delivered / minutes : 0;

  let longestStops = 0;
  let longestLen = 0;
  for (const line of state.lines) {
    longestStops = Math.max(longestStops, line.stops.length);
    longestLen = Math.max(longestLen, lineLength(state, line));
  }

  const deliverTarget = state.scenario.deliverTarget;

  return {
    delivered: state.delivered,
    durationSec: state.elapsed,
    efficiency,
    longestLineStops: longestStops,
    longestLineLength: longestLen,
    peakCombo: state.maxCombo,
    peakComboMultiplier: comboAtCount(state.maxCombo),
    linesBuilt,
    powerUpsUsed,
    activeLines: state.lines.length,
    trainCount: state.trains.length,
    reachedTarget: state.delivered >= deliverTarget,
    deliverTarget,
    completion: deliverTarget > 0 ? state.delivered / deliverTarget : 0,
  };
}

/** 一条线路的世界总长度（像素）。 */
function lineLength(state: GameState, line: Line): number {
  const pts = linePoints(state, line);
  return pts.length >= 2 ? totalLength(pts) : 0;
}

/** 给定连击数，返回对应的连击倍率（与 comboMultiplier 一致，但接受纯数字入参）。 */
function comboAtCount(count: number): number {
  if (count <= 0) return 1;
  // 与 powerups.comboMultiplier 公式保持一致：1 + floor(count / 5) * 0.5
  return 1 + Math.floor(count / 5) * 0.5;
}

/** 把秒数格式化成 mm:ss（结算面板展示用）。 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** 把 efficiency（人/分钟）格式化成一位小数。 */
export function formatEfficiency(eff: number): string {
  return eff.toFixed(1);
}

/** 把 completion（0-1）格式化成百分比（完成度可超过 100%）。 */
export function formatCompletion(completion: number): string {
  const pct = completion * 100;
  return `${pct.toFixed(0)}%`;
}
