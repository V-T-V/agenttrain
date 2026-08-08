/**
 * R14-D5（agenttrain）：路径规划评分器测试。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreProposedPath,
  comparePaths,
  pathFeasibility,
} from '../src/game/pathScore.ts';
import type { Station } from '../src/game/types.ts';

function station(id: string, shape: 'circle' | 'triangle' | 'square' = 'circle', x = 0, y = 0): Station {
  return { id, pos: { x, y }, shape, passengers: [], capacity: 6, overload: 0 } as Station;
}

describe('scoreProposedPath', () => {
  test('空 → feasibility=empty, score=0', () => {
    const r = scoreProposedPath([]);
    assert.equal(r.feasibility, 'empty');
    assert.equal(r.score, 0);
  });

  test('单站点 → too_short', () => {
    const r = scoreProposedPath([station('a')]);
    assert.equal(r.feasibility, 'too_short');
    assert.equal(r.stopCount, 1);
  });

  test('两站点不同形状 → valid', () => {
    const r = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('b', 'triangle', 200, 0),
    ]);
    assert.equal(r.feasibility, 'valid');
    assert.equal(r.stopCount, 2);
    assert.equal(r.shapeCoverage, 2);
    assert.ok(r.score > 0);
  });

  test('重复站点 → duplicate', () => {
    const r = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('a', 'circle', 100, 0), // 同 id
    ]);
    assert.equal(r.feasibility, 'duplicate');
    assert.ok(r.hasDuplicate);
    assert.equal(r.score, 0);
  });

  test('路径长度正确', () => {
    const r = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('b', 'triangle', 100, 0),
      station('c', 'square', 100, 100),
    ]);
    assert.equal(r.totalLength, 200); // 100 + 100
    assert.equal(r.avgSegmentLength, 100); // 200/2
  });

  test('形状覆盖（3 种形状）', () => {
    const r = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('b', 'triangle', 200, 0),
      station('c', 'square', 400, 0),
    ]);
    assert.equal(r.shapeCoverage, 3);
  });

  test('score 在 [0, 100]', () => {
    for (const n of [0, 1, 2, 3, 5, 10]) {
      const sts = Array.from({ length: n }, (_, i) =>
        station(`s${i}`, (['circle', 'triangle', 'square'][i % 3] as never), i * 200, 0),
      );
      const r = scoreProposedPath(sts);
      assert.ok(r.score >= 0 && r.score <= 100, `n=${n} score=${r.score}`);
    }
  });

  test('hint 非空', () => {
    const r = scoreProposedPath([station('a'), station('b', 'triangle', 200)]);
    assert.ok(r.hint.length > 0);
  });

  test('段长适中（100~300）→ 高分', () => {
    const r = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('b', 'triangle', 200, 0),
      station('c', 'square', 400, 0),
    ]);
    // 3 站(15) + 3 形状(30) + 段长适中(20) = 65
    assert.ok(r.score >= 60, `适中段长 score=${r.score} 应 ≥60`);
  });

  test('段长过长 → hint 提示偏长', () => {
    const r = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('b', 'triangle', 500, 0),
    ]);
    assert.match(r.hint, /偏长/);
  });
});

describe('comparePaths', () => {
  test('空候选 → best=null', () => {
    const r = comparePaths([]);
    assert.equal(r.best, null);
  });

  test('含不可行路径 → 选最优可行', () => {
    const r = comparePaths([
      [station('a')], // too_short
      [station('a', 'circle', 0, 0), station('b', 'triangle', 200, 0)], // valid
    ]);
    assert.ok(r.best !== null);
    assert.equal(r.best!.length, 2);
  });

  test('多条可行 → 选最高分', () => {
    const r = comparePaths([
      [station('a', 'circle', 0, 0), station('b', 'circle', 200, 0)], // 1 形状
      [station('c', 'circle', 0, 0), station('d', 'triangle', 200, 0), station('e', 'square', 400, 0)], // 3 形状
    ]);
    assert.ok(r.best !== null);
    assert.equal(r.best!.length, 3); // 3 站的更高分
  });

  test('全不可行 → best=null', () => {
    const r = comparePaths([
      [station('a')], // too_short
      [], // empty
    ]);
    assert.equal(r.best, null);
  });

  test('scores 长度 = 候选数', () => {
    const r = comparePaths([[station('a')], [station('a'), station('b', 'triangle', 200)]]);
    assert.equal(r.scores.length, 2);
  });
});

describe('pathFeasibility', () => {
  test('空 → empty', () => {
    assert.equal(pathFeasibility([]), 'empty');
  });

  test('单站 → too_short', () => {
    assert.equal(pathFeasibility([station('a')]), 'too_short');
  });

  test('重复 → duplicate', () => {
    assert.equal(pathFeasibility([station('a'), station('a', 'circle', 100)]), 'duplicate');
  });

  test('正常 → valid', () => {
    assert.equal(
      pathFeasibility([station('a', 'circle', 0, 0), station('b', 'triangle', 200)]),
      'valid',
    );
  });
});
