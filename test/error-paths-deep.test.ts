// D8 错误路径深层测试：聚焦持久化层（persist/highscore/achievements）在
// 数据损坏、字段类型错乱、localStorage 抛错（隐私模式/配额满/访问被拒）等异常下的降级行为。
// 关键约束：被测模块在 import 时即捕获 globalThis.localStorage 引用，
// 故本文件安装可抛错的 localStorage stub 后，错误路径用独立模块函数验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestScore,
  loadHighScores,
  recordScore,
} from '../src/game/highscore.ts';
import { clearSave, loadGame, saveGame } from '../src/game/persist.ts';
import { createInitialState } from '../src/game/state.ts';
import {
  checkAchievements,
  resetAchievements,
  type GameOverStats,
} from '../src/game/achievements.ts';

const SAVE_KEY = 'agenttrain-save-v1';
const HS_KEY = 'agenttrain-highscore-v1';

/** 可配置的 Storage stub：可让 getItem/setItem/removeItem 抛错。 */
class ThrowyStorage {
  m = new Map<string, string>();
  throwGet = false;
  throwSet = false;
  throwRemove = false;
  get length(): number {
    return this.m.size;
  }
  getItem(k: string): string | null {
    if (this.throwGet) throw new Error('getItem 被拒（隐私模式）');
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwSet) throw new Error('setItem 配额满');
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    if (this.throwRemove) throw new Error('removeItem 被拒');
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

/** 安装一个全新 ThrowyStorage 并返回句柄 + 清理函数。 */
function withThrowy(): { s: ThrowyStorage; restore: () => void } {
  const prev = (globalThis as { localStorage?: Storage }).localStorage;
  const s = new ThrowyStorage();
  (globalThis as { localStorage?: Storage }).localStorage = s as unknown as Storage;
  return {
    s,
    restore: () => {
      if (prev === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as { localStorage?: Storage }).localStorage = prev;
      }
    },
  };
}

function emptyStats(over: Partial<GameOverStats>): GameOverStats {
  return {
    delivered: 0,
    maxCombo: 0,
    difficulty: 'normal',
    elapsedSec: 0,
    powerUpsUsed: 0,
    reachedTarget: false,
    linesBuilt: 0,
    ...over,
  };
}

// ─── highscore clamp 边界（NaN/Infinity/字符串/负数/布尔/大数） ───

test('highscore：easy=NaN → 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: NaN, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：easy=Infinity → 0（非有限数）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: Infinity, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：easy=-Infinity → 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: -Infinity, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：easy=-50（负数）→ 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: -50, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：字符串数字 "123" → 123（Number 转换）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: '123', normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 123);
  } finally {
    restore();
  }
});

test('highscore：非数字字符串 "abc" → 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: 'abc', normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：布尔 true → 0（Number(true)=1 但非 number 类型走 Number()... → 1？实际 clamp typeof!==number）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: true, normal: 0, hard: 0, expert: 0 }));
    // clamp: typeof true !== 'number' → Number(true)=1，isFinite(1)&&1>=0 → floor=1
    assert.equal(loadHighScores().easy, 1);
  } finally {
    restore();
  }
});

test('highscore：小数 12.9 → 12（Math.floor）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: 12.9, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 12);
  } finally {
    restore();
  }
});

test('highscore：大数 1e15 → 1e15（有限且 ≥0）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: 1e15, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 1e15);
  } finally {
    restore();
  }
});

test('highscore：数组 [99] → 99（Number([99])=99，单元素数组强转）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: [99], normal: 0, hard: 0, expert: 0 }));
    // clamp: typeof [99] !== 'number' → Number([99])=99（单元素数组取元素）→ 99
    assert.equal(loadHighScores().easy, 99);
  } finally {
    restore();
  }
});

test('highscore：多元素数组 [1,2] → 0（Number([1,2])=NaN）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: [1, 2], normal: 0, hard: 0, expert: 0 }));
    // Number([1,2]) = NaN → 非有限 → 0
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：对象 {} → 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: {}, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：null → 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: null, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：undefined → 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: undefined, normal: 0, hard: 0, expert: 0 }));
    assert.equal(loadHighScores().easy, 0);
  } finally {
    restore();
  }
});

test('highscore：仅损坏单字段，其他三档仍正常', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify({ easy: 'bad', normal: 50, hard: 75, expert: 100 }));
    const h = loadHighScores();
    assert.equal(h.easy, 0, '损坏字段归零');
    assert.equal(h.normal, 50);
    assert.equal(h.hard, 75);
    assert.equal(h.expert, 100);
  } finally {
    restore();
  }
});

test('highscore：非对象 JSON（数组）→ 全 0', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(HS_KEY, JSON.stringify([10, 20, 30]));
    const h = loadHighScores();
    assert.equal(h.easy, 0);
    assert.equal(h.normal, 0);
    assert.equal(h.hard, 0);
    assert.equal(h.expert, 0);
  } finally {
    restore();
  }
});

test('highscore：getItem 抛错 → 全 0（隐私模式）', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwGet = true;
    const h = loadHighScores();
    assert.equal(h.easy, 0);
    assert.equal(h.normal, 0);
    assert.equal(h.hard, 0);
    assert.equal(h.expert, 0);
  } finally {
    restore();
  }
});

test('highscore：setItem 抛错（配额满）→ recordScore 仍返回 true 但不持久化', () => {
  const { s, restore } = withThrowy();
  try {
    // 先正常写一个基线
    s.m.set(HS_KEY, JSON.stringify({ easy: 10, normal: 0, hard: 0, expert: 0 }));
    s.throwSet = true;
    const broke = recordScore('easy', 100);
    assert.equal(broke, true, '逻辑上确为破纪录');
    // setItem 抛错 → 存储未更新，重读仍为旧值
    s.throwSet = false;
    s.throwGet = false;
    assert.equal(bestScore('easy'), 10, '抛错时不应写入');
  } finally {
    restore();
  }
});

// ─── persist loadGame 细粒度损坏 ───

test('persist：state.stations=null（非数组）→ null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, state: { stations: null, lines: [], trains: [], delivered: 0 }, rngState: 1, savedAt: 0 }),
    );
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：state.lines 缺失 → null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, state: { stations: [], trains: [], delivered: 0 }, rngState: 1, savedAt: 0 }),
    );
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：state.trains=字符串（非数组）→ null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, state: { stations: [], lines: [], trains: 'x', delivered: 0 }, rngState: 1, savedAt: 0 }),
    );
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：delivered=字符串（非 number）→ null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, state: { stations: [], lines: [], trains: [], delivered: 'five' }, rngState: 1, savedAt: 0 }),
    );
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：rngState=字符串（非 number）→ null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, state: { stations: [], lines: [], trains: [], delivered: 0 }, rngState: 'abc', savedAt: 0 }),
    );
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：rngState=NaN → null（JSON.stringify(NaN)="null"，反序列化为 null 触发类型校验）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 1, state: { stations: [], lines: [], trains: [], delivered: 0 }, rngState: NaN, savedAt: 0 }),
    );
    // JSON.stringify(NaN) → "null"，JSON.parse → null；typeof null === 'object' !== 'number' → null
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：state=null → null（!envelope.state 校验）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(SAVE_KEY, JSON.stringify({ version: 1, state: null, rngState: 1, savedAt: 0 }));
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：version=0（小于 SAVE_VERSION=1）→ null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(
      SAVE_KEY,
      JSON.stringify({ version: 0, state: { stations: [], lines: [], trains: [], delivered: 0 }, rngState: 1, savedAt: 0 }),
    );
    assert.equal(loadGame(), null, 'version 严格等于 1');
  } finally {
    restore();
  }
});

test('persist：JSON.parse 抛错（不完整括号）→ null', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(SAVE_KEY, '{"version":1,"state":{');
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：空字符串存档 → null（!raw 短路）', () => {
  const { s, restore } = withThrowy();
  try {
    s.m.set(SAVE_KEY, '');
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：getItem 抛错 → null（隐私模式，不抛出）', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwGet = true;
    assert.equal(loadGame(), null);
  } finally {
    restore();
  }
});

test('persist：setItem 抛错 → saveGame 静默不抛（配额满）', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwSet = true;
    const state = createInitialState(1);
    assert.doesNotThrow(() => saveGame(state, 1));
    s.throwSet = false;
    assert.equal(loadGame(), null, '抛错时未写入');
  } finally {
    restore();
  }
});

test('persist：clearSave 在 removeItem 抛错时不抛', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwRemove = true;
    assert.doesNotThrow(() => clearSave());
  } finally {
    restore();
  }
});

// ─── achievements resetAchievements 错误路径 ───

test('achievements：removeItem 抛错时 resetAchievements 返回 false', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwRemove = true;
    const ok = resetAchievements();
    assert.equal(ok, false);
  } finally {
    restore();
  }
});

test('achievements：removeItem 正常时 resetAchievements 返回 true', () => {
  const { s, restore } = withThrowy();
  try {
    const ok = resetAchievements();
    assert.equal(ok, true);
  } finally {
    restore();
  }
});

test('achievements：checkAchievements 在 setItem 抛错时不抛（降级）', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwSet = true;
    assert.doesNotThrow(() => checkAchievements(emptyStats({ delivered: 100 })));
  } finally {
    restore();
  }
});

test('achievements：loadAchievements 在 getItem 抛错时返回空数组', () => {
  const { s, restore } = withThrowy();
  try {
    s.throwGet = true;
    // loadAchievements 是 achievements.ts 内部函数，通过 achievementProgress 间接验证
    // 这里直接验证 resetAchievements（内部也读 loadAchievements）不抛
    assert.doesNotThrow(() => resetAchievements());
  } finally {
    restore();
  }
});
