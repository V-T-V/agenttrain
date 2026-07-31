// 难度档系统：三档差异化参数。
// config.ts 里的对应常量是「普通」档的基准值，本表给出各档覆盖。

import { OVERLOAD_GRACE, PASSENGER_INTERVAL, STATION_CAPACITY, TRAIN_SPEED } from './config.ts';
import type { Difficulty } from './types.ts';

/** 难度档 → 中文名。 */
export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  expert: '专家',
};

/** 全部难度档（展示顺序，由易到难）。 */
export const ALL_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/** 某一档的具体游戏参数。 */
export interface DifficultyParams {
  /** 站点最大乘客数。 */
  capacity: number;
  /** 满载后宽限秒数。 */
  overloadGrace: number;
  /** 乘客生成基础间隔（秒）。 */
  passengerInterval: number;
  /** 列车速度（段/秒）。 */
  trainSpeed: number;
}

/** 三档参数表。 */
export const DIFFICULTY_PARAMS: Record<Difficulty, DifficultyParams> = {
  easy: {
    capacity: 8,
    overloadGrace: 9,
    passengerInterval: 7,
    trainSpeed: 0.5,
  },
  normal: {
    capacity: STATION_CAPACITY, // 6
    overloadGrace: OVERLOAD_GRACE, // 6
    passengerInterval: PASSENGER_INTERVAL, // 5.5
    trainSpeed: TRAIN_SPEED, // 0.45
  },
  hard: {
    capacity: 5,
    overloadGrace: 4,
    passengerInterval: 4,
    trainSpeed: 0.4,
  },
  expert: {
    capacity: 4,
    overloadGrace: 3,
    passengerInterval: 3.2,
    trainSpeed: 0.38,
  },
};

/** 取某档的参数。 */
export function paramsFor(difficulty: Difficulty): DifficultyParams {
  return DIFFICULTY_PARAMS[difficulty];
}

/** 难度档排序（easy<normal<hard<expert），用于比较升降。 */
const RANK: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, expert: 3 };

/** 是否比另一档更高。 */
export function isHigher(a: Difficulty, b: Difficulty): boolean {
  return RANK[a] > RANK[b];
}

/** 升一档；已最高则不变。 */
export function bumpUp(d: Difficulty): Difficulty {
  return d === 'easy' ? 'normal' : d === 'normal' ? 'hard' : d === 'hard' ? 'expert' : 'expert';
}

/** 降一档；已最低则不变。 */
export function bumpDown(d: Difficulty): Difficulty {
  return d === 'expert' ? 'hard' : d === 'hard' ? 'normal' : d === 'normal' ? 'easy' : 'easy';
}

/** 从 localStorage 记忆上次难度（失败回退 normal）。 */
const PREF_KEY = 'agenttrain-difficulty-pref';
export function loadPreferredDifficulty(): Difficulty {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === 'easy' || v === 'normal' || v === 'hard' || v === 'expert') return v;
  } catch {
    /* 隐私模式：忽略 */
  }
  return 'normal';
}

export function savePreferredDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem(PREF_KEY, d);
  } catch {
    /* 忽略 */
  }
}
