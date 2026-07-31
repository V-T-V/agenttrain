// 最高分单测：按档记录、取最高、损坏容错。
// 用内存 localStorage stub（node 环境无 localStorage）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestScore, loadHighScores, recordScore } from '../src/game/highscore.ts';

const store = new Map<string, string>();
// @ts-expect-error 注入到 globalThis 供被测模块读取
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

test('空存档时各档最高分都是 0', () => {
  store.clear();
  const s = loadHighScores();
  assert.equal(s.easy, 0);
  assert.equal(s.normal, 0);
  assert.equal(s.hard, 0);
});

test('recordScore 按档分别记录', () => {
  store.clear();
  recordScore('easy', 50);
  recordScore('hard', 30);
  assert.equal(bestScore('easy'), 50);
  assert.equal(bestScore('hard'), 30);
  assert.equal(bestScore('normal'), 0);
});

test('recordScore 只增不减，返回是否破纪录', () => {
  store.clear();
  assert.equal(recordScore('normal', 40), true);
  assert.equal(recordScore('normal', 30), false); // 更低，不破
  assert.equal(bestScore('normal'), 40);
  assert.equal(recordScore('normal', 50), true);
  assert.equal(bestScore('normal'), 50);
});

test('不同难度档互不影响', () => {
  store.clear();
  recordScore('easy', 100);
  recordScore('hard', 20);
  assert.equal(bestScore('easy'), 100);
  assert.equal(bestScore('hard'), 20);
});

test('损坏 JSON 回退 0 不抛错', () => {
  store.clear();
  store.set('agenttrain-highscore-v1', '这不是 json{');
  const s = loadHighScores();
  assert.equal(s.easy, 0);
  assert.equal(s.normal, 0);
});

test('部分字段损坏用 0 补', () => {
  store.clear();
  store.set('agenttrain-highscore-v1', JSON.stringify({ easy: 30 })); // 缺 normal/hard
  const s = loadHighScores();
  assert.equal(s.easy, 30);
  assert.equal(s.normal, 0);
  assert.equal(s.hard, 0);
});
