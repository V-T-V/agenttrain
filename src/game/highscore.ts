// 最高分持久化：按难度档分别记录最高 delivered。
// localStorage 存储，损坏/隐私模式回退 0，永不抛错。

import type { Difficulty } from './types.ts';

const STORAGE_KEY = 'agenttrain-highscore-v1';

/** 按档记录的最高分。 */
export interface HighScores {
  easy: number;
  normal: number;
  hard: number;
}

function empty(): HighScores {
  return { easy: 0, normal: 0, hard: 0 };
}

/** 读取最高分；失败返回全 0。 */
export function loadHighScores(): HighScores {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<HighScores>;
    return {
      easy: clamp(parsed.easy),
      normal: clamp(parsed.normal),
      hard: clamp(parsed.hard),
    };
  } catch {
    return empty();
  }
}

/** 写入最高分；失败静默。 */
export function writeHighScores(data: HighScores): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 忽略 */
  }
}

/**
 * 记录一局得分。若超过该档历史最高则更新并返回是否破纪录。
 */
export function recordScore(difficulty: Difficulty, delivered: number): boolean {
  const scores = loadHighScores();
  if (delivered > scores[difficulty]) {
    scores[difficulty] = delivered;
    writeHighScores(scores);
    return true;
  }
  return false;
}

/** 取某档最高分。 */
export function bestScore(difficulty: Difficulty): number {
  return loadHighScores()[difficulty];
}

function clamp(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
