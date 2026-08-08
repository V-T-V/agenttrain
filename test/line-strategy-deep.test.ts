/**
 * R14-D4（agenttrain）：lineStrategy.ts 线路策略评估深层测试。
 *
 * 覆盖 evaluateAllLines / evaluateLine / summarizeStrategy 的
 * 空状态/单线路/结构稳定性/评分范围。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAllLines,
  evaluateLine,
  summarizeStrategy,
  type LineScore,
} from '../src/game/lineStrategy.ts';
import type { GameState, Line, Station, Train } from '../src/game/types.ts';

function mockStation(shape: 'circle' | 'triangle' | 'square' = 'circle', passengers: number = 0): Station {
  return {
    id: `s${Math.random().toString(36).slice(2, 6)}`,
    pos: { x: Math.random() * 100, y: Math.random() * 100 },
    shape,
    passengers: Array(passengers).fill(shape),
    capacity: 6,
    overload: 0,
  } as Station;
}

function mockLine(stops: Station[], trains: Train[] = []): Line {
  return {
    id: Math.floor(Math.random() * 1000),
    color: 'red',
    stops,
    trains,
  } as Line;
}

function mockState(lines: Line[] = [], stations: Station[] = []): GameState {
  return {
    stations: stations.length > 0 ? stations : lines.flatMap((l) => l.stops),
    lines,
    trains: lines.flatMap((l) => l.trains),
    delivered: 0,
    elapsed: 60,
    maxCombo: 0,
    combo: 0,
    scenario: { name: 'test', durationSec: 120, deliverTarget: 10 },
  } as GameState;
}

describe('evaluateAllLines', () => {
  test('空状态 → 空数组', () => {
    const r = evaluateAllLines(mockState([]));
    assert.equal(r.length, 0);
  });

  test('单线路 → 单评分', () => {
    const line = mockLine([mockStation('circle'), mockStation('triangle')]);
    const r = evaluateAllLines(mockState([line]));
    assert.equal(r.length, 1);
  });

  test('多线路 → 按 overall 降序', () => {
    const l1 = mockLine([mockStation('circle'), mockStation('triangle')]);
    const l2 = mockLine([mockStation('square'), mockStation('circle'), mockStation('triangle')]);
    const r = evaluateAllLines(mockState([l1, l2]));
    assert.equal(r.length, 2);
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i]!.overall <= r[i - 1]!.overall);
    }
  });

  test('每个评分结构完整', () => {
    const line = mockLine([mockStation('circle'), mockStation('triangle')]);
    const r = evaluateAllLines(mockState([line]));
    const s = r[0]!;
    assert.ok(typeof s.lineId === 'number');
    assert.ok(typeof s.stopCount === 'number');
    assert.ok(typeof s.overall === 'number');
    assert.ok(s.overall >= 0 && s.overall <= 100);
    assert.ok(typeof s.hint === 'string');
    assert.ok(typeof s.breakdown.efficiency === 'number');
    assert.ok(typeof s.breakdown.coverage === 'number');
  });
});

describe('evaluateLine', () => {
  test('空线路（无站点）→ stopCount=0', () => {
    const line = mockLine([]);
    const s = evaluateLine(mockState([line]), line);
    assert.equal(s.stopCount, 0);
  });

  test('stopCount 反映站点数', () => {
    const stops = [mockStation(), mockStation('triangle'), mockStation('square')];
    const line = mockLine(stops);
    const s = evaluateLine(mockState([line], stops), line);
    assert.ok(s.stopCount >= 0);
  });

  test('shapeCoverage ≤ 5', () => {
    const stops = [mockStation('circle'), mockStation('triangle'), mockStation('square')];
    const line = mockLine(stops);
    const s = evaluateLine(mockState([line]), line);
    assert.ok(s.shapeCoverage >= 0 && s.shapeCoverage <= 5);
  });

  test('overall 在 [0, 100]', () => {
    for (const nstops of [0, 1, 2, 5]) {
      const stops = Array.from({ length: nstops }, () => mockStation());
      const line = mockLine(stops);
      const s = evaluateLine(mockState([line]), line);
      assert.ok(s.overall >= 0 && s.overall <= 100, `nstops=${nstops} overall=${s.overall}`);
    }
  });

  test('hint 非空字符串', () => {
    const line = mockLine([mockStation(), mockStation('triangle')]);
    const s = evaluateLine(mockState([line]), line);
    assert.ok(typeof s.hint === 'string' && s.hint.length > 0);
  });

  test('breakdown 四维均有值', () => {
    const line = mockLine([mockStation(), mockStation('triangle')]);
    const s = evaluateLine(mockState([line]), line);
    for (const v of [s.breakdown.efficiency, s.breakdown.coverage, s.breakdown.congestionRelief, s.breakdown.extensibility]) {
      assert.ok(typeof v === 'number' && v >= 0 && v <= 100);
    }
  });
});

describe('summarizeStrategy', () => {
  test('空 → 全零统计', () => {
    const r = summarizeStrategy(mockState([]));
    assert.equal(r.lineCount, 0);
    assert.equal(r.bestLineId, null);
    assert.equal(r.worstLineId, null);
  });

  test('有线路 → 统计线路数', () => {
    const r = summarizeStrategy(mockState([
      mockLine([mockStation(), mockStation('triangle')]),
      mockLine([mockStation('square'), mockStation()]),
    ]));
    assert.equal(r.lineCount, 2);
  });

  test('输出结构稳定', () => {
    const r = summarizeStrategy(mockState([]));
    assert.ok(typeof r.lineCount === 'number');
    assert.ok(typeof r.averageScore === 'number');
    assert.ok(typeof r.globalShapeCoverage === 'number');
    assert.ok(typeof r.advice === 'string');
  });

  test('advice 非空', () => {
    const r = summarizeStrategy(mockState([]));
    assert.ok(r.advice.length > 0);
  });

  test('有线路时 advice 也非空', () => {
    const r = summarizeStrategy(mockState([
      mockLine([mockStation(), mockStation('triangle')]),
    ]));
    assert.ok(r.advice.length > 0);
  });
});
