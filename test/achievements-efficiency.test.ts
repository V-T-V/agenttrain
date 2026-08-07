// D6 新功能测试：efficiency-ace 成就（5 分钟内送达 200）+ resetAchievements 重置进度。
// 与现有 achievements.test.ts 共用 localStorage 桩模式（独立 store，互不干扰）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  achievementProgress,
  checkAchievements,
  getAchievement,
  loadAchievements,
  resetAchievements,
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

// ─── efficiency-ace 成就触发 ───

test('efficiency-ace：300s 送达 200 解锁', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200, elapsedSec: 300 }));
  assert.ok(newly.includes('efficiency-ace'));
});

test('efficiency-ace：100s 送达 200 解锁（远超阈值）', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200, elapsedSec: 100 }));
  assert.ok(newly.includes('efficiency-ace'));
});

test('efficiency-ace：301s 送达 200 不解锁（时间边界严格）', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200, elapsedSec: 301 }));
  assert.ok(!newly.includes('efficiency-ace'), '301s 超过 300s 阈值');
});

test('efficiency-ace：300s 送达 199 不解锁（送达边界严格）', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 199, elapsedSec: 300 }));
  assert.ok(!newly.includes('efficiency-ace'), '199 < 200 阈值');
});

test('efficiency-ace：0s 送达 0 不解锁（双零）', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 0, elapsedSec: 0 }));
  assert.ok(!newly.includes('efficiency-ace'));
});

test('efficiency-ace 与 speedrun 独立：300s/200 同时解锁两者', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200, elapsedSec: 150 }));
  // 150s ≤ 180 且 delivered 200 ≥ 50 → speedrun
  assert.ok(newly.includes('speedrun'));
  // 150s ≤ 300 且 delivered 200 ≥ 200 → efficiency-ace
  assert.ok(newly.includes('efficiency-ace'));
});

test('efficiency-ace 与 deliver-200 共存', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200, elapsedSec: 300 }));
  assert.ok(newly.includes('deliver-200'));
  assert.ok(newly.includes('efficiency-ace'));
});

test('efficiency-ace 幂等：已解锁不重复返回', () => {
  store.clear();
  const first = checkAchievements(stats({ delivered: 200, elapsedSec: 300 }));
  assert.ok(first.includes('efficiency-ace'));
  const second = checkAchievements(stats({ delivered: 200, elapsedSec: 300 }));
  assert.ok(!second.includes('efficiency-ace'), '二次调用不应重复解锁');
});

test('efficiency-ace 与 survivor 互不干扰：300s 同时触发 survivor-5min', () => {
  store.clear();
  const newly = checkAchievements(stats({ delivered: 200, elapsedSec: 300 }));
  assert.ok(newly.includes('efficiency-ace'));
  assert.ok(newly.includes('survivor-5min'), '300s ≥ 300 触发 5min 生存');
});

// ─── efficiency-ace 元数据完整性 ───

test('efficiency-ace 存在于 ACHIEVEMENTS 且字段非空', () => {
  const ace = ACHIEVEMENTS.find((a) => a.id === 'efficiency-ace');
  assert.ok(ace, 'efficiency-ace 应已注册');
  assert.ok(ace!.name.length > 0);
  assert.ok(ace!.icon.length > 0);
  assert.ok(ace!.hint.length > 0);
});

test('getAchievement 返回 efficiency-ace 元数据', () => {
  const ace = getAchievement('efficiency-ace');
  assert.equal(ace.id, 'efficiency-ace');
  assert.notEqual(ace.name, '隐藏成就', '应为真实成就而非占位');
});

test('D6 新增后成就总数 = 24 且 id 唯一', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(ACHIEVEMENTS.length, 24, `当前 ${ACHIEVEMENTS.length} 个`);
  assert.equal(new Set(ids).size, ids.length, 'id 仍唯一');
  assert.ok(ids.includes('efficiency-ace'));
});

test('achievementProgress total 反映新增（= 24）', () => {
  store.clear();
  const p = achievementProgress();
  assert.equal(p.total, 24);
  assert.equal(p.unlocked, 0);
});

// ─── resetAchievements 重置进度 ───

test('resetAchievements：清空已解锁成就', () => {
  store.clear();
  checkAchievements(stats({ delivered: 100 }));
  assert.ok(loadAchievements().length > 0, '应有解锁记录');
  const ok = resetAchievements();
  assert.equal(ok, true);
  assert.equal(loadAchievements().length, 0, '重置后应空');
});

test('resetAchievements：空存档调用也成功（幂等）', () => {
  store.clear();
  const ok = resetAchievements();
  assert.equal(ok, true);
  assert.equal(loadAchievements().length, 0);
});

test('resetAchievements 后 achievementProgress 归零', () => {
  store.clear();
  checkAchievements(stats({ delivered: 200 }));
  assert.ok(achievementProgress().unlocked > 0);
  resetAchievements();
  const p = achievementProgress();
  assert.equal(p.unlocked, 0);
  assert.equal(p.total, 24);
});

test('resetAchievements 后可重新解锁（不永久破坏）', () => {
  store.clear();
  checkAchievements(stats({ delivered: 50 }));
  resetAchievements();
  const newly = checkAchievements(stats({ delivered: 50 }));
  assert.ok(newly.includes('deliver-50'), '重置后应能重新解锁');
});

test('resetAchievements 连续调用多次均成功', () => {
  store.clear();
  for (let i = 0; i < 3; i++) {
    checkAchievements(stats({ delivered: 10 }));
    assert.equal(resetAchievements(), true);
  }
  assert.equal(loadAchievements().length, 0);
});

test('resetAchievements 不影响其他 localStorage 键', () => {
  store.clear();
  store.set('other-key', 'keep-me');
  store.set('highscore-v1', '{"easy":100}');
  checkAchievements(stats({ delivered: 10 }));
  resetAchievements();
  assert.equal(store.get('other-key'), 'keep-me', '其他键应保留');
  assert.equal(store.get('highscore-v1'), '{"easy":100}', '高分键应保留');
  assert.ok(!store.has('agenttrain-achievements-v1'), '仅清成就键');
});
