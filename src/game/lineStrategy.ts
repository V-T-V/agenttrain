// 多线路策略评估系统：对每条线路打分（效率/负载/扩展性/连通性），
// 帮助 AI 顾问与玩家判断「哪条线表现好、哪条该重构/延伸」。
//
// 全部纯函数（只读 GameState），不碰 DOM，便于 node:test 单测。
// 设计为只读分析层：不改状态、不触发副作用，可与 stats.ts / congestion.ts 叠加。

import type { GameState, Line, Shape, Vec2 } from './types.ts';
import { dist, totalLength } from './geometry.ts';
import { linePoints } from './simulation.ts';

/** 单条线路的评估指标。 */
export interface LineScore {
  /** 线路 id。 */
  lineId: number;
  /** 线路颜色（便于 UI 展示）。 */
  color: Line['color'];
  /** 站点数（含两端）。 */
  stopCount: number;
  /** 线路世界总长度（像素）。 */
  lengthPx: number;
  /** 线路覆盖的「独特形状」数（1-5）。 */
  shapeCoverage: number;
  /** 该线路上所有站台等待乘客总数（线路负载）。 */
  waitingPassengers: number;
  /** 该线路上满载/接近满载（>=capacity*0.8）的站点数（拥堵压力）。 */
  congestedStops: number;
  /** 平均每站等待乘客数（waitingPassengers / stopCount）。 */
  avgLoadPerStop: number;
  /** 列车数。 */
  trainCount: number;
  /** 列车上当前乘客总数。 */
  onboardPassengers: number;
  /** 列车平均满载率（onboard / (trainCount * TRAIN_CAPACITY)）。 */
  trainUtilization: number;
  /** 端点是否仍有「可延伸空间」（端点附近有无未连接站点）。 */
  expandableHead: boolean;
  expandableTail: boolean;
  /** 综合评分（0-100，越高越好）。 */
  overall: number;
  /** 各维度子评分（0-100），便于解释。 */
  breakdown: {
    /** 效率：列车满载率越高，运输越充分。 */
    efficiency: number;
    /** 负载覆盖：覆盖独特形状多、站点适度多为佳。 */
    coverage: number;
    /** 拥堵缓解：该线路沿线拥堵站点越少越好（反映分流效果）。 */
    congestionRelief: number;
    /** 扩展性：端点可延伸得分。 */
    extensibility: number;
  };
  /** 一句话建议（中文，UI/日志用）。 */
  hint: string;
}

const TRAIN_CAPACITY = 6;
/** 端点延伸判定半径：端点周围此距离内有未连接站点则「可延伸」。 */
const EXPAND_RADIUS = 600;

/**
 * 评估所有线路，返回按 overall 降序排列的评分列表。
 * 无线路时返回空数组。
 */
export function evaluateAllLines(state: GameState): LineScore[] {
  const scores = state.lines.map((line) => evaluateLine(state, line));
  return scores.sort((a, b) => b.overall - a.overall);
}

/** 评估单条线路。 */
export function evaluateLine(state: GameState, line: Line): LineScore {
  const points = linePoints(state, line);
  const lengthPx = points.length >= 2 ? totalLength(points) : 0;
  const stopCount = line.stops.length;

  const stopsOnLine = line.stops
    .map((sid) => state.stations.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const shapes = new Set<Shape>(stopsOnLine.map((s) => s.shape));
  const shapeCoverage = shapes.size;

  const waitingPassengers = stopsOnLine.reduce((n, s) => n + s.passengers.length, 0);
  const congestedThreshold = Math.max(1, Math.floor(state.capacity * 0.8));
  const congestedStops = stopsOnLine.filter(
    (s) => s.passengers.length >= congestedThreshold,
  ).length;
  const avgLoadPerStop = stopCount > 0 ? waitingPassengers / stopCount : 0;

  const trains = state.trains.filter((t) => t.lineId === line.id);
  const trainCount = trains.length;
  const onboardPassengers = trains.reduce((n, t) => n + t.passengers.length, 0);
  const trainCap = trainCount * TRAIN_CAPACITY;
  const trainUtilization = trainCap > 0 ? onboardPassengers / trainCap : 0;

  const { expandableHead, expandableTail } = expandability(state, line, stopsOnLine);

  const breakdown = scoreBreakdown({
    stopCount,
    shapeCoverage,
    avgLoadPerStop,
    congestedStops,
    trainUtilization,
    trainCount,
    expandableHead,
    expandableTail,
  });
  const overall = weightedOverall(breakdown);

  const hint = makeHint({
    stopCount,
    shapeCoverage,
    congestedStops,
    trainUtilization,
    expandableHead,
    expandableTail,
  });

  return {
    lineId: line.id,
    color: line.color,
    stopCount,
    lengthPx,
    shapeCoverage,
    waitingPassengers,
    congestedStops,
    avgLoadPerStop,
    trainCount,
    onboardPassengers,
    trainUtilization,
    expandableHead,
    expandableTail,
    overall,
    breakdown,
    hint,
  };
}

/**
 * 判断线路两端是否「可延伸」：端点站附近（EXPAND_RADIUS 内）存在未挂在该线路的站点。
 */
function expandability(
  state: GameState,
  line: Line,
  stopsOnLine: { id: number; pos: Vec2 }[],
): { expandableHead: boolean; expandableTail: boolean } {
  if (stopsOnLine.length === 0) return { expandableHead: false, expandableTail: false };
  const head = stopsOnLine[0]!;
  const tail = stopsOnLine[stopsOnLine.length - 1]!;
  const onLine = new Set(line.stops);
  const expandableHead = state.stations.some(
    (s) => !onLine.has(s.id) && s.id !== head.id && dist(s.pos, head.pos) <= EXPAND_RADIUS,
  );
  const expandableTail = state.stations.some(
    (s) => !onLine.has(s.id) && s.id !== tail.id && dist(s.pos, tail.pos) <= EXPAND_RADIUS,
  );
  return { expandableHead, expandableTail };
}

/** 四维度子评分（各 0-100）。 */
function scoreBreakdown(args: {
  stopCount: number;
  shapeCoverage: number;
  avgLoadPerStop: number;
  congestedStops: number;
  trainUtilization: number;
  trainCount: number;
  expandableHead: boolean;
  expandableTail: boolean;
}): LineScore['breakdown'] {
  const { stopCount, shapeCoverage, congestedStops, trainUtilization, trainCount, expandableHead, expandableTail } = args;

  // 效率：列车满载率（0-1）映射到 0-100；无列车则 0。
  const efficiency = clamp01(trainUtilization) * 100;

  // 覆盖：形状覆盖（最多 5 种 → 60 分）+ 站点适度多（每站 +8，上限 40）。
  const shapePart = Math.min(60, (shapeCoverage / 5) * 60);
  const stopPart = Math.min(40, stopCount * 8);
  const coverage = shapePart + stopPart;

  // 拥堵缓解：线路沿线拥堵站越多 → 该线压力越大 → 分越低。
  // 基础 100，每个拥堵站 -25，下限 0。
  const congestionRelief = clamp01((100 - congestedStops * 25) / 100) * 100;

  // 扩展性：两端可延伸各 50 分；无列车（说明线没跑车）扣 20 分下限保护。
  let extensibility = (expandableHead ? 50 : 0) + (expandableTail ? 50 : 0);
  if (trainCount === 0) extensibility = Math.max(0, extensibility - 20);

  return { efficiency, coverage, congestionRelief, extensibility };
}

/** 综合分：效率 35% + 覆盖 25% + 拥堵缓解 25% + 扩展性 15%。 */
function weightedOverall(b: LineScore['breakdown']): number {
  return Math.round(
    b.efficiency * 0.35 + b.coverage * 0.25 + b.congestionRelief * 0.25 + b.extensibility * 0.15,
  );
}

/** 根据指标生成一句中文建议。 */
function makeHint(args: {
  stopCount: number;
  shapeCoverage: number;
  congestedStops: number;
  trainUtilization: number;
  expandableHead: boolean;
  expandableTail: boolean;
}): string {
  const { stopCount, shapeCoverage, congestedStops, trainUtilization, expandableHead, expandableTail } = args;
  if (stopCount < 2) return '线路站点过少，建议延伸或重建。';
  if (congestedStops >= 2) return `沿线 ${congestedStops} 站拥堵，建议增配列车或分流。`;
  if (trainUtilization > 0.8) return '列车接近满载，运输效率高。';
  if (shapeCoverage <= 1) return '形状覆盖单一，建议接入不同形状站点。';
  if (!expandableHead && !expandableTail) return '两端无可延伸站点，线路已饱和。';
  if (expandableHead && expandableTail) return '两端均可延伸，扩展性好。';
  return '线路运转正常。';
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ---------- 策略对比 / 全局建议 ----------

/** 全局策略评估汇总（用于 AI 顾问或结算面板）。 */
export interface StrategySummary {
  /** 线路总数。 */
  lineCount: number;
  /** 平均综合分。 */
  averageScore: number;
  /** 最佳线路 id。 */
  bestLineId: number | null;
  /** 最差线路 id。 */
  worstLineId: number | null;
  /** 全局形状覆盖率（所有线路覆盖的独特形状 / ALL_SHAPES）。 */
  globalShapeCoverage: number;
  /** 全局拥堵压力（所有线路上拥堵站总数）。 */
  totalCongestedStops: number;
  /** 全局列车利用率。 */
  globalTrainUtilization: number;
  /** 一句话全局建议。 */
  advice: string;
}

/** 汇总全局策略，给出建议（如「3 号线表现差，考虑重构」）。 */
export function summarizeStrategy(state: GameState): StrategySummary {
  const scores = evaluateAllLines(state);
  const lineCount = scores.length;
  if (lineCount === 0) {
    return {
      lineCount: 0,
      averageScore: 0,
      bestLineId: null,
      worstLineId: null,
      globalShapeCoverage: 0,
      totalCongestedStops: 0,
      globalTrainUtilization: 0,
      advice: '尚无线路，建议先连接两个拥堵站点。',
    };
  }
  const averageScore = Math.round(scores.reduce((n, s) => n + s.overall, 0) / lineCount);
  // scores 已按 overall 降序：最佳在 [0]，最差在 [last]
  const best = scores[0]!;
  const worst = scores[scores.length - 1]!;
  const allShapes = new Set<Shape>();
  for (const line of state.lines) {
    for (const sid of line.stops) {
      const st = state.stations.find((s) => s.id === sid);
      if (st) allShapes.add(st.shape);
    }
  }
  const globalShapeCoverage = allShapes.size;
  const totalCongestedStops = scores.reduce((n, s) => n + s.congestedStops, 0);
  const totalOnboard = scores.reduce((n, s) => n + s.onboardPassengers, 0);
  const totalCap = scores.reduce((n, s) => n + s.trainCount * TRAIN_CAPACITY, 0);
  const globalTrainUtilization = totalCap > 0 ? totalOnboard / totalCap : 0;

  let advice: string;
  if (totalCongestedStops >= 3) {
    advice = `全局 ${totalCongestedStops} 处拥堵，优先分流最差线路（${worst.color}线）。`;
  } else if (best.overall - worst.overall >= 40) {
    advice = `${worst.color}线评分（${worst.overall}）远低于 ${best.color}线（${best.overall}），考虑重构。`;
  } else if (globalTrainUtilization > 0.85) {
    advice = '全局列车利用率高，运输效率优秀。';
  } else if (globalShapeCoverage <= 2) {
    advice = '形状覆盖不足，建议接入更多形状的站点。';
  } else {
    advice = '整体线路策略均衡，继续保持。';
  }

  return {
    lineCount,
    averageScore,
    bestLineId: best.lineId,
    worstLineId: worst.lineId,
    globalShapeCoverage,
    totalCongestedStops,
    globalTrainUtilization,
    advice,
  };
}
