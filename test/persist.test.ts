// persist 单测：存档往返、损坏降级、版本不匹配、无存储环境。
// node:test 环境无 localStorage，用内存 Map 模拟一个最小 Storage。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveGame, loadGame, clearSave } from '../src/game/persist.ts';
import { createInitialState } from '../src/game/state.ts';
import { Rng } from '../src/utils/rng.ts';
import type { GameState } from '../src/game/types.ts';

/** 内存版 Storage（满足 Storage 接口的最小子集），用于测试。 */
class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  getItem(key: string): string | null {
    return this.m.has(key) ? (this.m.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.m.set(key, String(value));
  }
  removeItem(key: string): void {
    this.m.delete(key);
  }
  clear(): void {
    this.m.clear();
  }
}

/** 安装/卸载全局 localStorage mock，返回清理函数。 */
function withStorage(): () => void {
  const prev = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  return () => {
    if (prev === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = prev;
    }
  };
}

test('saveGame→loadGame 往返：state 与 rngState 完整恢复', () => {
  const cleanup = withStorage();
  try {
    const state = createInitialState(12345);
    // 人为改动 state，验证往返后保留
    state.delivered = 42;
    state.elapsed = 99.5;
    const rng = new Rng(12345);
    rng.next();
    rng.next();
    const rngState = rng.getState();

    saveGame(state, rngState);
    const loaded = loadGame();
    assert.ok(loaded, '应成功加载');
    assert.equal(loaded!.state.delivered, 42, 'delivered 应保留');
    assert.equal(loaded!.state.elapsed, 99.5, 'elapsed 应保留');
    assert.equal(loaded!.rngState, rngState, 'rngState 应保留');

    // 用 fromState 重建 Rng，序列应连贯
    const restored = Rng.fromState(loaded!.rngState);
    const expected = rng.next();
    assert.equal(restored.next(), expected, 'Rng 续局后序列应连贯');
  } finally {
    cleanup();
  }
});

test('loadGame 无存档返回 null', () => {
  const cleanup = withStorage();
  try {
    assert.equal(loadGame(), null);
  } finally {
    cleanup();
  }
});

test('loadGame 损坏 JSON 返回 null（不抛错）', () => {
  const cleanup = withStorage();
  try {
    localStorage.setItem('agenttrain-save-v1', '{这不是合法json');
    assert.equal(loadGame(), null, '损坏 JSON 应降级为 null');
  } finally {
    cleanup();
  }
});

test('loadGame 版本不匹配返回 null', () => {
  const cleanup = withStorage();
  try {
    const fake = JSON.stringify({ version: 999, state: {}, rngState: 1, savedAt: 0 });
    localStorage.setItem('agenttrain-save-v1', fake);
    assert.equal(loadGame(), null, '未来版本应拒绝加载');
  } finally {
    cleanup();
  }
});

test('loadGame 字段缺失/类型错乱返回 null', () => {
  const cleanup = withStorage();
  try {
    // 版本对但 state 缺核心字段（stations 不是数组）
    const fake = JSON.stringify({
      version: 1,
      state: { delivered: 5 },
      rngState: 1,
      savedAt: 0,
    });
    localStorage.setItem('agenttrain-save-v1', fake);
    assert.equal(loadGame(), null, '不完整 state 应拒绝加载');
  } finally {
    cleanup();
  }
});

test('clearSave 移除存档', () => {
  const cleanup = withStorage();
  try {
    const state: GameState = createInitialState(1);
    saveGame(state, 1);
    assert.ok(loadGame(), '存档应存在');
    clearSave();
    assert.equal(loadGame(), null, '清除后应无存档');
  } finally {
    cleanup();
  }
});

test('saveGame 无 localStorage 环境静默降级（不抛错）', () => {
  // node 环境默认无 localStorage（前面的 withStorage 已 cleanup）
  const state = createInitialState(1);
  // 不应抛错
  saveGame(state, 1);
  assert.equal(loadGame(), null, '无存储环境加载应返回 null');
  clearSave();
});
