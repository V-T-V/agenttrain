/**
 * R14-D7（agenttrain）：游戏平衡性评估器。
 *
 * 评估一局游戏的「平衡感」——难度是否合适、玩家是否被惩罚过重、
 * 通关时间是否在预期范围。供结算面板分析 + 难度自适应参考。
 *
 * 纯函数。
 */

import type { Difficulty } from './types.ts';

export interface BalanceInput {
  /** 难度档 */
  difficulty: Difficulty;
  /** 本局送达数 */
  delivered: number;
  /** 送达目标 */
  deliverTarget: number;
  /** 游戏时长（秒） */
  durationSec: number;
  /** 预期时长（秒，从难度推算） */
  expectedDurationSec: number;
  /** 最高连击 */
  peakCombo: number;
  /** 拥堵超时次数（站点满载超时） */
  overloadCount: number;
}

export type BalanceRating = '过易' | '适中' | '偏难' | '过难';

export interface BalanceReport {
  /** 完成度（0~1+） */
  completion: number;
  /** 是否通关 */
  cleared: boolean;
  /** 时间比（实际/预期，<1=快速通关，>1=超时） */
  timeRatio: number;
  /** 拥堵惩罚密度（次/分钟） */
  overloadDensity: number;
  /** 连击效率（peakCombo / 分钟） */
  comboEfficiency: number;
  /** 综合评级 */
  rating: BalanceRating;
  /** 难度建议（升/降/保持） */
  difficultyAdvice: '升档' | '降档' | '保持';
  /** 分析说明 */
  analysis: string;
}

/**
 * 评估游戏平衡性。
 */
export function evaluateBalance(input: BalanceInput): BalanceReport {
  const completion = input.deliverTarget > 0 ? input.delivered / input.deliverTarget : 0;
  const cleared = input.delivered >= input.deliverTarget;
  const timeRatio = input.expectedDurationSec > 0
    ? input.durationSec / input.expectedDurationSec
    : 1;
  const minutes = input.durationSec / 60;
  const overloadDensity = minutes > 0 ? input.overloadCount / minutes : 0;
  const comboEfficiency = minutes > 0 ? input.peakCombo / minutes : 0;

  // 评级
  let rating: BalanceRating;
  if (cleared && timeRatio < 0.6) {
    rating = '过易'; // 快速通关 → 太简单
  } else if (cleared && timeRatio <= 1.2) {
    rating = '适中';
  } else if (!cleared && completion >= 0.7) {
    rating = '偏难'; // 差一点通关
  } else if (!cleared) {
    rating = '过难';
  } else {
    rating = '偏难'; // 通关但超时很久
  }

  // 难度建议
  let difficultyAdvice: BalanceReport['difficultyAdvice'];
  if (rating === '过易') difficultyAdvice = '升档';
  else if (rating === '过难') difficultyAdvice = '降档';
  else difficultyAdvice = '保持';

  // 分析
  const parts: string[] = [];
  parts.push(`完成度 ${(completion * 100).toFixed(0)}%`);
  if (cleared) parts.push('已通关');
  else parts.push('未通关');
  parts.push(`用时比 ${timeRatio.toFixed(2)}`);
  if (overloadDensity > 2) parts.push(`拥堵频繁（${overloadDensity.toFixed(1)}/min）`);
  if (comboEfficiency > 3) parts.push('连击表现佳');

  return {
    completion,
    cleared,
    timeRatio,
    overloadDensity,
    comboEfficiency,
    rating,
    difficultyAdvice,
    analysis: parts.join(' · '),
  };
}

/**
 * 格式化平衡报告。
 */
export function describeBalance(report: BalanceReport): string {
  const icon = report.cleared ? '✅' : '❌';
  const advice = report.difficultyAdvice === '保持' ? '' : ` → 建议${report.difficultyAdvice}`;
  return `${icon} ${report.rating}（${(report.completion * 100).toFixed(0)}%）${advice}`;
}

/**
 * 基于多局历史推荐难度调整方向。
 */
export function recommendDifficulty(
  history: BalanceReport[],
  current: Difficulty,
  up: () => Difficulty,
  down: () => Difficulty,
): Difficulty {
  if (history.length < 3) return current; // 样本不足
  const recent = history.slice(-3);
  const overEasy = recent.filter((r) => r.rating === '过易').length;
  const overHard = recent.filter((r) => r.rating === '过难').length;
  if (overEasy >= 2) return up();
  if (overHard >= 2) return down();
  return current;
}
