// Rng 单测：同种子可复现、区间合法、pick 不越界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';

test('同种子的两个 Rng 产出相同序列', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('next() 永远落在 [0,1)', () => {
  const r = new Rng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `${v} 超出 [0,1)`);
  }
});

test('range 严格在 [min,max) 内', () => {
  const r = new Rng(42);
  for (let i = 0; i < 500; i++) {
    const v = r.range(10, 20);
    assert.ok(v >= 10 && v < 20, `${v} 越界`);
  }
});

test('int 返回闭区间整数', () => {
  const r = new Rng(99);
  for (let i = 0; i < 500; i++) {
    const v = r.int(1, 5);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 1 && v <= 5);
  }
});

test('pick 能取到每个元素且不越界', () => {
  const r = new Rng(3);
  const arr = ['a', 'b', 'c', 'd'];
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(r.pick(arr));
  assert.equal(seen.size, 4);
});

test('空数组 pick 抛错', () => {
  const r = new Rng(1);
  assert.throws(() => r.pick([]));
});
