// 成就系统测试：里程碑检测、localStorage 持久化、去重。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  achievementProgress,
  checkAchievements,
  getAchievement,
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

test('全难通：四难度都通关后解锁', () => {
  store.clear();
  checkAchievements(stats({ difficulty: 'easy', reachedTarget: true }));
  checkAchievements(stats({ difficulty: 'normal', reachedTarget: true }));
  checkAchievements(stats({ difficulty: 'hard', reachedTarget: true }));
  // 三难度通关后还不应解锁（缺 expert）
  const beforeExpert = checkAchievements(stats({ delivered: 0 }));
  assert.ok(!beforeExpert.includes('all-difficulty'), '缺 expert 不应解锁全难通');
  const fourth = checkAchievements(stats({ difficulty: 'expert', reachedTarget: true }));
  assert.ok(fourth.includes('all-difficulty'));
});

// ---------- 专家难度成就 ----------

test('专家难度达标解锁 expert-clear', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'expert', reachedTarget: true }));
  assert.ok(newly.includes('expert-clear'));
});

test('专家难度未达标不解锁 expert-clear', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'expert', reachedTarget: false }));
  assert.ok(!newly.includes('expert-clear'));
});

test('专家难度送达 200 解锁 expert-200（同时触发 expert-clear 不依赖达标）', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'expert', delivered: 200 }));
  assert.ok(newly.includes('expert-200'));
});

test('困难难度送达 200 不解锁 expert-200', () => {
  store.clear();
  const newly = checkAchievements(stats({ difficulty: 'hard', delivered: 200 }));
  assert.ok(!newly.includes('expert-200'));
});

// ---------- 注册表完整性 ----------

test('每个成就 id 唯一', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, '成就 id 不应有重复');
});

test('每个成就字段非空（name/icon/hint）', () => {
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.id.length > 0, `${a.id} id 为空`);
    assert.ok(a.name.length > 0, `${a.id} name 为空`);
    assert.ok(a.icon.length > 0, `${a.id} icon 为空`);
    assert.ok(a.hint.length > 0, `${a.id} hint 为空`);
  }
});

test('成就总数 ≥ 20', () => {
  assert.ok(ACHIEVEMENTS.length >= 20, `当前 ${ACHIEVEMENTS.length} 个成就`);
});

test('checkAchievements 返回值只含已定义的 id（无幽灵成就）', () => {
  store.clear();
  const newly = checkAchievements(
    stats({ delivered: 200, maxCombo: 100, powerUpsUsed: 0, linesBuilt: 15, elapsedSec: 100 }),
  );
  const validIds = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const id of newly) {
    assert.ok(validIds.has(id), `返回了未定义的成就 id: ${id}`);
  }
});

test('getAchievement 未登记 id 返回占位', () => {
  const a = getAchievement('nonexistent-id');
  assert.equal(a.id, 'nonexistent-id');
  assert.ok(a.name.length > 0);
});

test('送达 0 不解锁任何里程碑', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 0 }));
  assert.ok(!newly.includes('deliver-10'));
  assert.ok(!newly.includes('deliver-50'));
});

test('送达 200 解锁全部四个送达里程碑', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200 }));
  assert.ok(newly.includes('deliver-10'));
  assert.ok(newly.includes('deliver-50'));
  assert.ok(newly.includes('deliver-100'));
  assert.ok(newly.includes('deliver-200'));
});

test('成就进度计数与解锁数一致', () => {
  store.clear();
  checkAchievements(stats({ delivered: 10 }));
  const p = achievementProgress();
  assert.equal(p.unlocked, loadAchievements().length);
  assert.equal(p.total, ACHIEVEMENTS.length);
  assert.ok(p.unlocked > 0);
});
