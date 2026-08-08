/**
 * R14-D3（agenttrain）：stats.ts 统计汇总深层测试。
 *
 * 覆盖纯函数 formatDuration/formatEfficiency/formatCompletion
 * + computeRunStats 的核心派生逻辑（用 mock GameState）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRunStats,
  formatDuration,
  formatEfficiency,
  formatCompletion,
} from '../src/game/stats.ts';
import type { GameState, Line, Station, Train, Scenario } from '../src/game/types.ts';

// ———— 纯函数 ————

describe('formatDuration', () => {
  test('0 秒 → 0:00', () => {
    assert.equal(formatDuration(0), '0:00');
  });

  test('不足 1 分钟', () => {
    assert.equal(formatDuration(45), '0:45');
    assert.equal(formatDuration(9), '0:09');
  });

  test('整分钟', () => {
    assert.equal(formatDuration(60), '1:00');
    assert.equal(formatDuration(120), '2:00');
  });

  test('分秒混合', () => {
    assert.equal(formatDuration(90), '1:30');
    assert.equal(formatDuration(125), '2:05');
  });

  test('负数 → 钳制到 0', () => {
    assert.equal(formatDuration(-10), '0:00');
  });

  test('小数 → 向下取整', () => {
    assert.equal(formatDuration(59.9), '0:59');
    assert.equal(formatDuration(60.9), '1:00');
  });

  test('大数（>1小时）', () => {
    assert.equal(formatDuration(3661), '61:01');
  });
});

describe('formatEfficiency', () => {
  test('一位小数', () => {
    assert.equal(formatEfficiency(3), '3.0');
    assert.equal(formatEfficiency(3.14), '3.1');
    assert.equal(formatEfficiency(0), '0.0');
  });

  test('大数', () => {
    // toFixed 用银行家舍入：100.55 → 100.5
    assert.equal(formatEfficiency(100.55), '100.5');
    assert.equal(formatEfficiency(100.65), '100.7');
  });

  test('负数照常格式化', () => {
    assert.equal(formatEfficiency(-1.5), '-1.5');
  });
});

describe('formatCompletion', () => {
  test('0% → 0%', () => {
    assert.equal(formatCompletion(0), '0%');
  });

  test('100%', () => {
    assert.equal(formatCompletion(1), '100%');
  });

  test('50%', () => {
    assert.equal(formatCompletion(0.5), '50%');
  });

  test('超 100%（超额完成）', () => {
    assert.equal(formatCompletion(1.5), '150%');
    assert.equal(formatCompletion(2), '200%');
  });

  test('小数四舍五入', () => {
    assert.equal(formatCompletion(0.333), '33%');
    assert.equal(formatCompletion(0.666), '67%');
  });
});

// ———— computeRunStats ————

function mockScenario(over: Partial<Scenario> = {}): Scenario {
  return { name: 'test', durationSec: 120, deliverTarget: 10, ...over } as Scenario;
}

function mockStation(shape: 'circle' | 'triangle' | 'square' = 'circle'): Station {
  return {
    id: `s${Math.random().toString(36).slice(2, 6)}`,
    pos: { x: Math.random() * 100, y: Math.random() * 100 },
    shape,
    passengers: [],
    capacity: 6,
    overload: 0,
  } as Station;
}

function mockLine(stops: Station[]): Line {
  return {
    id: `l${Math.random().toString(36).slice(2, 6)}`,
    color: 'red',
    stops,
    trains: [],
  } as Line;
}

function mockState(over: Partial<GameState> = {}): GameState {
  return {
    stations: [mockStation()],
    lines: [],
    trains: [],
    delivered: 0,
    elapsed: 60,
    maxCombo: 0,
    combo: 0,
    scenario: mockScenario(),
    ...over,
  } as GameState;
}

describe('computeRunStats', () => {
  test('基本字段透传', () => {
    const state = mockState({ delivered: 5, elapsed: 120 });
    const r = computeRunStats(state, 3, 2);
    assert.equal(r.delivered, 5);
    assert.equal(r.durationSec, 120);
    assert.equal(r.linesBuilt, 3);
    assert.equal(r.powerUpsUsed, 2);
  });

  test('efficiency = delivered / minutes', () => {
    const state = mockState({ delivered: 10, elapsed: 120 }); // 2 分钟
    const r = computeRunStats(state, 0, 0);
    assert.equal(r.efficiency, 5); // 10/2=5
  });

  test('elapsed=0 → efficiency=0（不除零）', () => {
    const state = mockState({ delivered: 5, elapsed: 0 });
    const r = computeRunStats(state, 0, 0);
    assert.equal(r.efficiency, 0);
  });

  test('reachedTarget 判定', () => {
    const state = mockState({ delivered: 10, scenario: mockScenario({ deliverTarget: 10 }) });
    assert.ok(computeRunStats(state, 0, 0).reachedTarget);

    const state2 = mockState({ delivered: 9, scenario: mockScenario({ deliverTarget: 10 }) });
    assert.ok(!computeRunStats(state2, 0, 0).reachedTarget);
  });

  test('completion = delivered / target', () => {
    const state = mockState({ delivered: 5, scenario: mockScenario({ deliverTarget: 10 }) });
    assert.equal(computeRunStats(state, 0, 0).completion, 0.5);
  });

  test('completion 可超 1', () => {
    const state = mockState({ delivered: 15, scenario: mockScenario({ deliverTarget: 10 }) });
    assert.equal(computeRunStats(state, 0, 0).completion, 1.5);
  });

  test('target=0 → completion=0（不除零）', () => {
    const state = mockState({ delivered: 5, scenario: mockScenario({ deliverTarget: 0 }) });
    assert.equal(computeRunStats(state, 0, 0).completion, 0);
  });

  test('peakComboMultiplier 随 maxCombo 递增', () => {
    const state0 = mockState({ maxCombo: 0 });
    const state5 = mockState({ maxCombo: 5 });
    const state10 = mockState({ maxCombo: 10 });
    assert.ok(computeRunStats(state0, 0, 0).peakComboMultiplier === 1);
    assert.ok(computeRunStats(state5, 0, 0).peakComboMultiplier > 1);
    assert.ok(computeRunStats(state10, 0, 0).peakComboMultiplier >= computeRunStats(state5, 0, 0).peakComboMultiplier);
  });

  test('无线路 → longestLineStops=0', () => {
    const state = mockState({ lines: [] });
    assert.equal(computeRunStats(state, 0, 0).longestLineStops, 0);
  });

  test('activeLines/trainsCount 反映 state', () => {
    const line = mockLine([mockStation(), mockStation()]);
    const state = mockState({ lines: [line], trains: [{}] as Train[] });
    const r = computeRunStats(state, 1, 0);
    assert.equal(r.activeLines, 1);
    assert.equal(r.trainCount, 1);
  });

  test('输出结构完整', () => {
    const r = computeRunStats(mockState(), 0, 0);
    assert.ok(typeof r.delivered === 'number');
    assert.ok(typeof r.durationSec === 'number');
    assert.ok(typeof r.efficiency === 'number');
    assert.ok(typeof r.longestLineStops === 'number');
    assert.ok(typeof r.reachedTarget === 'boolean');
    assert.ok(typeof r.completion === 'number');
  });
});
