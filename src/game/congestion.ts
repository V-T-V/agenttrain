// 站点拥堵预测系统：基于站台等待乘客数的历史采样，预测「哪些站点即将满载」。
//
// 全部纯函数（只读 GameState），不碰 DOM，便于 node:test 单测。
// 设计为只读分析层：不改游戏状态、不触发副作用，与 stats.ts / lineStrategy.ts 叠加。
//
// 核心思路：每隔固定间隔（SAMPLE_INTERVAL）对每个站点的乘客数采样，
// 用最近若干个样本做线性回归估计「每秒净增长速率」，从而预测到达容量的剩余时间（ETA）。
// 净增长率综合考虑「乘客涌入（spawn）」与「列车接走（deliver）」，反映真实负荷趋势。

import type { GameState, Shape } from './types.ts';

/** 单个采样点：某站在某时刻的等待乘客数。 */
export interface CongestionSample {
  /** 游戏内时间（秒）。 */
  t: number;
  /** 该时刻站台等待乘客数。 */
  waiting: number;
}

/**
 * 拥堵历史：每个站点 id → 最近的采样序列（按时间升序）。
 * 用普通对象存储便于深拷贝/序列化（Map 不便 JSON）。
 */
export interface CongestionHistory {
  /** stationId → 样本数组（最多 MAX_SAMPLES 个，FIFO）。 */
  samples: Record<number, CongestionSample[]>;
}

/** 采样间隔（秒）。调用方按此节奏调用 sample()。 */
export const SAMPLE_INTERVAL = 2;
/** 每站保留的最大样本数（FIFO 滑窗）。 */
export const MAX_SAMPLES = 8;

/** 创建空历史。 */
export function createCongestionHistory(): CongestionHistory {
  return { samples: {} };
}

/**
 * 采样当前所有站点的等待人数，追加到历史（FIFO，超长截断）。
 * 纯函数：返回新的 history 对象，不修改入参。
 *
 * @param state 只读游戏状态。
 * @param history 既有历史。
 * @param now 当前游戏时间（秒），通常 = state.elapsed。
 */
export function sample(
  state: GameState,
  history: CongestionHistory,
  now: number,
): CongestionHistory {
  const next: Record<number, CongestionSample[]> = {};
  for (const st of state.stations) {
    const prev = history.samples[st.id] ?? [];
    const arr = prev.length >= MAX_SAMPLES ? prev.slice(prev.length - MAX_SAMPLES + 1) : prev.slice();
    arr.push({ t: now, waiting: st.passengers.length });
    next[st.id] = arr;
  }
  return { samples: next };
}

/**
 * 单站拥堵预测：用最小二乘线性回归估算每秒净增长率，预测到达容量的剩余秒数。
 *
 * - 样本不足 2 个 → 无法估计趋势，rate=0、eta=Infinity。
 * - 增长率 <= 0（在疏散）→ eta=Infinity（不会满载）。
 * - 当前已 >= capacity → eta=0（已满载）。
 *
 * @returns rate 每秒净增长人数；eta 达到 capacity 的剩余秒数（Infinity 表示不会达到）。
 */
export interface StationPrediction {
  stationId: number;
  shape: Shape;
  /** 当前等待人数。 */
  current: number;
  /** 站点容量。 */
  capacity: number;
  /** 当前负载率（0-1+）。 */
  loadRatio: number;
  /** 估计的每秒净增长人数（可为负，表示在疏散）。 */
  rate: number;
  /** 预计达到容量的剩余秒数（Infinity=不会达到，0=已达到）。 */
  eta: number;
  /** 严重程度分级。 */
  severity: CongestionSeverity;
}

export type CongestionSeverity = 'safe' | 'watch' | 'warning' | 'critical' | 'overloaded';

/** 评估单站拥堵预测。 */
export function predictStation(
  state: GameState,
  history: CongestionHistory,
  stationId: number,
): StationPrediction | null {
  const st = state.stations.find((s) => s.id === stationId);
  if (!st) return null;
  const samples = history.samples[stationId] ?? [];
  const rate = linearRate(samples);
  const current = st.passengers.length;
  const capacity = state.capacity;
  const loadRatio = capacity > 0 ? current / capacity : current > 0 ? 1 : 0;

  let eta: number;
  if (current >= capacity) {
    eta = 0;
  } else if (!(rate > 0)) {
    eta = Infinity;
  } else {
    eta = (capacity - current) / rate;
  }

  return {
    stationId,
    shape: st.shape,
    current,
    capacity,
    loadRatio,
    rate,
    eta,
    severity: classify(loadRatio, eta),
  };
}

/** 预测所有站点，按风险（eta 升序、loadRatio 降序）排序。 */
export function predictAll(
  state: GameState,
  history: CongestionHistory,
): StationPrediction[] {
  const preds = state.stations
    .map((st) => predictStation(state, history, st.id))
    .filter((p): p is StationPrediction => p !== null);
  // 风险排序：eta 小的在前（Infinity 视为最大）；eta 相同时 loadRatio 高的在前。
  return preds.sort((a, b) => {
    const ea = Number.isFinite(a.eta) ? a.eta : Infinity;
    const eb = Number.isFinite(b.eta) ? b.eta : Infinity;
    if (ea !== eb) return ea - eb;
    return b.loadRatio - a.loadRatio;
  });
}

/**
 * 返回在 horizonSec 秒内「即将满载」的高风险站点（eta <= horizon 且未已满载）。
 * 已满载（eta=0）的站点不计入「即将」（它们是当前问题，不是预测）。
 */
export function atRiskStations(
  state: GameState,
  history: CongestionHistory,
  horizonSec: number,
): StationPrediction[] {
  return predictAll(state, history).filter(
    (p) => p.eta > 0 && p.eta <= horizonSec,
  );
}

/** 负载率与 ETA 联合分级。 */
function classify(loadRatio: number, eta: number): CongestionSeverity {
  if (loadRatio >= 1) return 'overloaded';
  if (loadRatio >= 0.8) return 'critical';
  if (Number.isFinite(eta) && eta <= 10) return 'warning';
  if (loadRatio >= 0.5 || (Number.isFinite(eta) && eta <= 20)) return 'watch';
  return 'safe';
}

/**
 * 最小二乘线性回归：拟合 waiting = a + b*t，返回斜率 b（每秒变化人数）。
 * 样本不足 2 个或时间跨度为 0 时返回 0。
 *
 * 数学：b = Σ((t-t̄)(w-w̄)) / Σ((t-t̄)²)
 */
export function linearRate(samples: CongestionSample[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  let sumT = 0;
  let sumW = 0;
  for (const s of samples) {
    sumT += s.t;
    sumW += s.waiting;
  }
  const meanT = sumT / n;
  const meanW = sumW / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dt = s.t - meanT;
    num += dt * (s.waiting - meanW);
    den += dt * dt;
  }
  if (den === 0) return 0;
  const rate = num / den;
  if (Number.isNaN(rate)) return 0;
  return rate;
}

// ---------- 全局汇总 / 建议 ----------

/** 全局拥堵预测汇总（供 AI 顾问 / UI 警报条使用）。 */
export interface CongestionSummary {
  /** 站点总数。 */
  stationCount: number;
  /** 当前已满载站点数。 */
  overloadedCount: number;
  /** 10 秒内即将满载的站点数。 */
  upcomingCount: number;
  /** 最快将达到满载的站点（eta 最小，排除已满载）。 */
  mostUrgentId: number | null;
  /** 最紧急站点的 ETA（秒，Infinity=无）。 */
  mostUrgentEta: number;
  /** 全局平均每秒净增长人数（所有站 rate 之和）。 */
  globalRate: number;
  /** 一句话建议。 */
  advice: string;
}

/** 汇总全局拥堵预测。 */
export function summarizeCongestion(
  state: GameState,
  history: CongestionHistory,
  horizonSec = 10,
): CongestionSummary {
  const preds = predictAll(state, history);
  const stationCount = preds.length;
  const overloadedCount = preds.filter((p) => p.severity === 'overloaded').length;
  const upcoming = preds.filter((p) => p.eta > 0 && p.eta <= horizonSec);
  const upcomingCount = upcoming.length;
  const globalRate = preds.reduce((n, p) => n + p.rate, 0);

  const urgent = upcoming.sort((a, b) => a.eta - b.eta)[0];
  const mostUrgentId = urgent?.stationId ?? null;
  const mostUrgentEta = urgent?.eta ?? Infinity;

  let advice: string;
  if (overloadedCount > 0) {
    advice = `${overloadedCount} 站已满载，立即疏散防过载判负。`;
  } else if (upcomingCount >= 2) {
    advice = `${upcomingCount} 站将在 ${horizonSec} 秒内满载，优先分流。`;
  } else if (upcomingCount === 1 && Number.isFinite(mostUrgentEta)) {
    advice = `1 站约 ${mostUrgentEta.toFixed(0)} 秒后满载，提前布线。`;
  } else if (globalRate > 0.5) {
    advice = '全局乘客增长较快，留意运力。';
  } else {
    advice = '全局负荷平稳，暂无拥堵风险。';
  }

  return {
    stationCount,
    overloadedCount,
    upcomingCount,
    mostUrgentId,
    mostUrgentEta,
    globalRate,
    advice,
  };
}

/** 把拥堵预测附加到 AI 顾问快照的一行文本（便于 LLM 感知未来风险）。 */
export function congestionSnapshotLine(
  state: GameState,
  history: CongestionHistory,
  horizonSec = 10,
): string {
  const summary = summarizeCongestion(state, history, horizonSec);
  if (summary.stationCount === 0) return '  预测: (无站点)';
  const etaText = Number.isFinite(summary.mostUrgentEta)
    ? `${summary.mostUrgentEta.toFixed(0)}s`
    : '—';
  return `  预测: 已满载${summary.overloadedCount} 即将满载${summary.upcomingCount}(最急${etaText}) 全局增速${summary.globalRate.toFixed(2)}/s — ${summary.advice}`;
}
