// 成就系统 —— 基于本局表现 + 历史累计的里程碑成就。
// localStorage 持久化已解锁成就；Game Over 时检测并解锁。

import type { Difficulty } from './types.ts';

const STORAGE_KEY = 'agenttrain-achievements-v1';

/** 成就元数据。 */
export interface Achievement {
  id: string;
  name: string;
  icon: string;
  hint: string;
}

/** 全部成就定义。 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  // 送达里程碑
  { id: 'deliver-10', name: '初出茅庐', icon: '🌱', hint: '单局送达 10 名乘客' },
  { id: 'deliver-50', name: '渐入佳境', icon: '🌿', hint: '单局送达 50 名乘客' },
  { id: 'deliver-100', name: '运输能手', icon: '🌳', hint: '单局送达 100 名乘客' },
  { id: 'deliver-200', name: '调度大师', icon: '🏔️', hint: '单局送达 200 名乘客' },
  // 连击
  { id: 'combo-10', name: '连击新手', icon: '🔥', hint: '达成 10 连击' },
  { id: 'combo-25', name: '连击高手', icon: '⚡', hint: '达成 25 连击' },
  { id: 'combo-50', name: '连击狂魔', icon: '💫', hint: '达成 50 连击' },
  // 难度
  { id: 'hard-clear', name: '挑战者', icon: '⚔️', hint: '在困难难度下通关（送达目标）' },
  { id: 'hard-200', name: '硬核调度', icon: '💀', hint: '困难难度下单局送达 200' },
  { id: 'expert-clear', name: '极限挑战', icon: '🏆', hint: '在专家难度下通关（送达目标）' },
  { id: 'expert-200', name: '调度之神', icon: '👑', hint: '专家难度下单局送达 200' },
  // 道具
  { id: 'power-user', name: '道具达人', icon: '🧰', hint: '单局使用 5 次道具' },
  // 生存
  { id: 'survivor-5min', name: '持久战', icon: '⏰', hint: '单局存活 5 分钟' },
  { id: 'survivor-10min', name: '马拉松', icon: '🕐', hint: '单局存活 10 分钟' },
  // 扩展成就（挑战型）
  { id: 'no-power-clear', name: '纯粹调度', icon: '🚫', hint: '单局不使用任何道具且送达 50+' },
  { id: 'line-master', name: '线路编织者', icon: '🕸️', hint: '单局建立 10 条线路' },
  { id: 'easy-master', name: '简单也认真', icon: '😊', hint: '简单难度下达成送达目标' },
  { id: 'normal-master', name: '稳中求胜', icon: '👍', hint: '普通难度下达成送达目标' },
  { id: 'all-difficulty', name: '全难通', icon: '🎖️', hint: '三个难度都达成过送达目标' },
  { id: 'combo-master', name: '极限连击', icon: '🌀', hint: '达成 100 连击' },
  { id: 'speedrun', name: '闪电通关', icon: '⚡', hint: '3 分钟内送达 50+' },
] as const;

const META_MAP: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

/** 读取已解锁成就 id 列表；失败返回空。 */
export function loadAchievements(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** 写入成就列表；失败静默。 */
function writeAchievements(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 忽略 */
  }
}

/** 查成就元数据；未登记返回占位。 */
export function getAchievement(id: string): Achievement {
  return META_MAP[id] ?? { id, name: '隐藏成就', icon: '🎁', hint: '神秘成就' };
}

/** 本局结算数据（Game Over 时传入）。 */
export interface GameOverStats {
  delivered: number;
  maxCombo: number;
  difficulty: Difficulty;
  elapsedSec: number;
  powerUpsUsed: number;
  reachedTarget: boolean;
  /** 本局建立的线路总数。 */
  linesBuilt: number;
}

/**
 * 检测本局表现，解锁新成就。返回新解锁的 id 列表（可能为空）。
 */
export function checkAchievements(stats: GameOverStats): string[] {
  const unlocked = new Set(loadAchievements());
  const newly: string[] = [];
  const tryUnlock = (id: string): void => {
    if (!unlocked.has(id)) {
      unlocked.add(id);
      newly.push(id);
    }
  };

  // 送达里程碑
  if (stats.delivered >= 10) tryUnlock('deliver-10');
  if (stats.delivered >= 50) tryUnlock('deliver-50');
  if (stats.delivered >= 100) tryUnlock('deliver-100');
  if (stats.delivered >= 200) tryUnlock('deliver-200');
  // 连击
  if (stats.maxCombo >= 10) tryUnlock('combo-10');
  if (stats.maxCombo >= 25) tryUnlock('combo-25');
  if (stats.maxCombo >= 50) tryUnlock('combo-50');
  if (stats.maxCombo >= 100) tryUnlock('combo-master');
  // 难度
  if (stats.difficulty === 'hard' && stats.reachedTarget) tryUnlock('hard-clear');
  if (stats.difficulty === 'hard' && stats.delivered >= 200) tryUnlock('hard-200');
  if (stats.difficulty === 'expert' && stats.reachedTarget) tryUnlock('expert-clear');
  if (stats.difficulty === 'expert' && stats.delivered >= 200) tryUnlock('expert-200');
  if (stats.difficulty === 'easy' && stats.reachedTarget) tryUnlock('easy-master');
  if (stats.difficulty === 'normal' && stats.reachedTarget) tryUnlock('normal-master');
  // 全难通：四个难度通关成就是否都已解锁
  if (
    unlocked.has('easy-master') &&
    unlocked.has('normal-master') &&
    unlocked.has('hard-clear') &&
    unlocked.has('expert-clear')
  ) {
    tryUnlock('all-difficulty');
  }
  // 道具
  if (stats.powerUpsUsed >= 5) tryUnlock('power-user');
  // 纯粹调度：不用道具且送达 50+
  if (stats.powerUpsUsed === 0 && stats.delivered >= 50) tryUnlock('no-power-clear');
  // 线路编织者
  if (stats.linesBuilt >= 10) tryUnlock('line-master');
  // 生存
  if (stats.elapsedSec >= 300) tryUnlock('survivor-5min');
  if (stats.elapsedSec >= 600) tryUnlock('survivor-10min');
  // 闪电通关：3 分钟内送达 50+
  if (stats.elapsedSec <= 180 && stats.delivered >= 50) tryUnlock('speedrun');

  if (newly.length > 0) writeAchievements([...unlocked]);
  return newly;
}

/** 已解锁数 / 总数。 */
export function achievementProgress(): { unlocked: number; total: number } {
  return { unlocked: loadAchievements().length, total: ACHIEVEMENTS.length };
}
