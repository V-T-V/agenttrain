// 成就系统测试：里程碑检测、localStorage 持久化、去重。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  achievementProgress,
  checkAchievements,
  loadAchievements,
  type GameOverStats,
} from '../src/game/achievements.ts';

const store = new Map<string, string>();
// @ts-expect-error 注入 localStorage 桩
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

function stats(over: Partial<GameOverStats>): GameOverStats {
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

test('空存档时成就进度为 0', () => {
  store.clear();
  assert.equal(loadAchievements().length, 0);
  const p = achievementProgress();
  assert.equal(p.unlocked, 0);
  assert.equal(p.total, ACHIEVEMENTS.length);
});

test('送达 10 解锁 deliver-10', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 10 }));
  assert.ok(newly.includes('deliver-10'));
});

test('送达 100 解锁多个里程碑', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 100 }));
  assert.ok(newly.includes('deliver-10'));
  assert.ok(newly.includes('deliver-50'));
  assert.ok(newly.includes('deliver-100'));
  assert.ok(!newly.includes('deliver-200'));
});

test('连击成就', () => {
  store.clear();
  const newly = checkAchievements(stats({ maxCombo: 25 }));
  assert.ok(newly.includes('combo-10'));
  assert.ok(newly.includes('combo-25'));
});

test('困难达标解锁 hard-clear', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'hard', reachedTarget: true }));
  assert.ok(newly.includes('hard-clear'));
});

test('困难但未达标不解锁 hard-clear', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'hard', reachedTarget: false }));
  assert.ok(!newly.includes('hard-clear'));
});

test('道具达人：单局用 5 次', () => {
  store.clear();
  const newly = checkAchievements(stats({ powerUpsUsed: 5 }));
  assert.ok(newly.includes('power-user'));
});

test('生存成就：5 分钟', () => {
  store.clear();
  const newly = checkAchievements(stats({ elapsedSec: 300 }));
  assert.ok(newly.includes('survivor-5min'));
  assert.ok(!newly.includes('survivor-10min'));
});

test('重复检查不重复解锁', () => {
  store.clear();
  checkAchievements(stats({ delivered: 50 }));
  const second = checkAchievements(stats({ delivered: 50 }));
  assert.equal(second.length, 0, '已解锁的不应再返回');
});

test('成就持久化到 localStorage', () => {
  store.clear();
  checkAchievements(stats({ delivered: 100 }));
  const stored = loadAchievements();
  assert.ok(stored.includes('deliver-100'));
});

// ---------- 扩展成就 ----------

test('极限连击 100', () => {
  store.clear();
  const newly = checkAchievements(stats({ maxCombo: 100 }));
  assert.ok(newly.includes('combo-master'));
});

test('纯粹调度：不用道具且送达 50+', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 50, powerUpsUsed: 0 }));
  assert.ok(newly.includes('no-power-clear'));
});

test('纯粹调度：用了道具不解锁', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 50, powerUpsUsed: 1 }));
  assert.ok(!newly.includes('no-power-clear'));
});

test('线路编织者：建 10 条线', () => {
  store.clear();
  const newly = checkAchievements(stats({ linesBuilt: 10 }));
  assert.ok(newly.includes('line-master'));
});

test('简单/普通难度通关', () => {
  store.clear();
  const easy = checkAchievements(stats({ difficulty: 'easy', reachedTarget: true }));
  assert.ok(easy.includes('easy-master'));
  store.clear();
  const normal = checkAchievements(stats({ difficulty: 'normal', reachedTarget: true }));
  assert.ok(normal.includes('normal-master'));
});

test('闪电通关：3 分钟内送达 50+', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 50, elapsedSec: 120 }));
  assert.ok(newly.includes('speedrun'));
});

test('闪电通关：超时不解锁', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 50, elapsedSec: 200 }));
  assert.ok(!newly.includes('speedrun'));
});

test('全难通：三难度都通关后解锁', () => {
  store.clear();
  checkAchievements(stats({ difficulty: 'easy', reachedTarget: true }));
  checkAchievements(stats({ difficulty: 'normal', reachedTarget: true }));
  const third = checkAchievements(stats({ difficulty: 'hard', reachedTarget: true }));
  assert.ok(third.includes('all-difficulty'));
});
