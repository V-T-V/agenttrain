/**
 * R14-D5（agenttrain）：路径规划评分器。
 *
 * 评估「拟建线路」的质量——玩家在拖拽建线前预览评分，
 * 或 AI 顾问推荐最优路径。补 lineStrategy.ts 的「规划前瞻」缺口。
 *
 *   - scoreProposedPath：评估拟建路径（未落地的线路草案）
 *   - comparePaths：对比多条候选路径，推荐最优
 *   - pathFeasibility：检查路径可行性（站点重复/最小长度）
 *
 * 纯函数。
 */

import type { Station, Shape } from './types.ts';
import { dist, totalLength } from './geometry.ts';

/** 拟建路径评分 */
export interface PathScore {
  /** 站点数 */
  stopCount: number;
  /** 路径总长度（像素） */
  totalLength: number;
  /** 平均段长度 */
  avgSegmentLength: number;
  /** 覆盖的独特形状数 */
  shapeCoverage: number;
  /** 是否有重复站点 */
  hasDuplicate: boolean;
  /** 路径可行性 */
  feasibility: 'valid' | 'too_short' | 'duplicate' | 'empty';
  /** 综合评分（0~100） */
  score: number;
  /** 建议 */
  hint: string;
}

/**
 * 评估一条拟建路径。
 */
export function scoreProposedPath(stations: Station[]): PathScore {
  if (stations.length === 0) {
    return {
      stopCount: 0, totalLength: 0, avgSegmentLength: 0,
      shapeCoverage: 0, hasDuplicate: false,
      feasibility: 'empty', score: 0, hint: '路径为空',
    };
  }

  if (stations.length === 1) {
    return {
      stopCount: 1, totalLength: 0, avgSegmentLength: 0,
      shapeCoverage: new Set(stations.map((s) => s.shape)).size,
      hasDuplicate: false,
      feasibility: 'too_short', score: 0,
      hint: '至少需要 2 个站点',
    };
  }

  // 重复站点检测
  const ids = stations.map((s) => s.id);
  const hasDuplicate = new Set(ids).size !== ids.length;

  const pts = stations.map((s) => s.pos);
  const totalLen = totalLength(pts);
  const avgSeg = totalLen / (stations.length - 1);
  const shapes = new Set<Shape>(stations.map((s) => s.shape));

  let feasibility: PathScore['feasibility'] = 'valid';
  if (hasDuplicate) feasibility = 'duplicate';

  // 综合评分
  let score = 0;
  if (!hasDuplicate) {
    // 站点多 → 分高（最多 30 分，6 站满分）
    score += Math.min(30, stations.length * 5);
    // 形状覆盖广 → 分高（每种形状 10 分，最多 50 分）
    score += Math.min(50, shapes.size * 10);
    // 段长度适中 → 分高（100~300px 最佳，偏离扣分）
    const idealMin = 100, idealMax = 300;
    if (avgSeg >= idealMin && avgSeg <= idealMax) {
      score += 20;
    } else if (avgSeg > 0) {
      const ratio = avgSeg < idealMin ? avgSeg / idealMin : idealMax / avgSeg;
      score += Math.round(20 * ratio);
    }
  }

  let hint: string;
  if (hasDuplicate) {
    hint = '路径含重复站点，请移除';
  } else if (shapes.size === 1) {
    hint = `仅覆盖 ${shapes.size} 种形状，建议接入更多形状`;
  } else if (avgSeg > 400) {
    hint = `平均段长 ${avgSeg.toFixed(0)}px 偏长，列车往返慢`;
  } else if (avgSeg < 50 && stations.length > 2) {
    hint = '站点过密，可能浪费资源';
  } else if (score >= 80) {
    hint = '路径规划优秀';
  } else if (score >= 50) {
    hint = '路径基本合理';
  } else {
    hint = '路径可优化';
  }

  return {
    stopCount: stations.length,
    totalLength: totalLen,
    avgSegmentLength: avgSeg,
    shapeCoverage: shapes.size,
    hasDuplicate,
    feasibility,
    score,
    hint,
  };
}

/**
 * 对比多条候选路径，返回最优。
 */
export function comparePaths(candidates: Station[][]): { best: Station[] | null; scores: PathScore[] } {
  const scores = candidates.map((c) => scoreProposedPath(c));
  let bestIdx = -1;
  let bestScore = -1;
  scores.forEach((s, i) => {
    if (s.feasibility === 'valid' && s.score > bestScore) {
      bestScore = s.score;
      bestIdx = i;
    }
  });
  return {
    best: bestIdx >= 0 ? candidates[bestIdx]! : null,
    scores,
  };
}

/**
 * 快速检查路径可行性（不评分）。
 */
export function pathFeasibility(stations: Station[]): PathScore['feasibility'] {
  return scoreProposedPath(stations).feasibility;
}
