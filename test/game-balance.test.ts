/**
 * R14-D7（agenttrain）：游戏平衡性评估器测试。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBalance,
  describeBalance,
  recommendDifficulty,
  type BalanceInput,
} from '../src/game/gameBalance.ts';

function input(over: Partial<BalanceInput> = {}): BalanceInput {
  return {
    difficulty: 'normal',
    delivered: 10,
    deliverTarget: 10,
    durationSec: 120,
    expectedDurationSec: 120,
    peakCombo: 5,
    overloadCount: 1,
    ...over,
  };
}

describe('evaluateBalance', () => {
  test('正常通关 → 适中', () => {
    const r = evaluateBalance(input({ delivered: 10, deliverTarget: 10, durationSec: 120, expectedDurationSec: 120 }));
    assert.equal(r.cleared, true);
    assert.equal(r.rating, '适中');
    assert.equal(r.difficultyAdvice, '保持');
  });

  test('快速通关 → 过易', () => {
    const r = evaluateBalance(input({ durationSec: 60, expectedDurationSec: 120 })); // 0.5x
    assert.equal(r.rating, '过易');
    assert.equal(r.difficultyAdvice, '升档');
  });

  test('差一点通关 → 偏难', () => {
    const r = evaluateBalance(input({ delivered: 7, deliverTarget: 10 }));
    assert.equal(r.cleared, false);
    assert.equal(r.rating, '偏难');
  });

  test('远未通关 → 过难', () => {
    const r = evaluateBalance(input({ delivered: 3, deliverTarget: 10 }));
    assert.equal(r.cleared, false);
    assert.equal(r.rating, '过难');
    assert.equal(r.difficultyAdvice, '降档');
  });

  test('completion 计算', () => {
    const r = evaluateBalance(input({ delivered: 5, deliverTarget: 10 }));
    assert.ok(Math.abs(r.completion - 0.5) < 1e-9);
  });

  test('timeRatio 计算', () => {
    const r = evaluateBalance(input({ durationSec: 180, expectedDurationSec: 120 }));
    assert.ok(Math.abs(r.timeRatio - 1.5) < 1e-9);
  });

  test('overloadDensity = overloadCount / minutes', () => {
    const r = evaluateBalance(input({ overloadCount: 6, durationSec: 120 })); // 2 min
    assert.equal(r.overloadDensity, 3);
  });

  test('expectedDuration=0 → timeRatio=1', () => {
    const r = evaluateBalance(input({ expectedDurationSec: 0 }));
    assert.equal(r.timeRatio, 1);
  });

  test('analysis 非空', () => {
    const r = evaluateBalance(input());
    assert.ok(r.analysis.length > 0);
  });

  test('输出结构完整', () => {
    const r = evaluateBalance(input());
    assert.ok(typeof r.completion === 'number');
    assert.ok(typeof r.cleared === 'boolean');
    assert.ok(['过易', '适中', '偏难', '过难'].includes(r.rating));
    assert.ok(['升档', '降档', '保持'].includes(r.difficultyAdvice));
  });
});

describe('describeBalance', () => {
  test('通关 → ✅', () => {
    const r = evaluateBalance(input());
    assert.match(describeBalance(r), /✅/);
  });

  test('未通关 → ❌', () => {
    const r = evaluateBalance(input({ delivered: 3, deliverTarget: 10 }));
    assert.match(describeBalance(r), /❌/);
  });

  test('含百分比', () => {
    const r = evaluateBalance(input());
    assert.match(describeBalance(r), /%/);
  });

  test('建议升档时含提示', () => {
    const r = evaluateBalance(input({ durationSec: 50, expectedDurationSec: 120 }));
    assert.match(describeBalance(r), /升档/);
  });
});

describe('recommendDifficulty', () => {
  const up = () => 'hard' as never;
  const down = () => 'easy' as never;

  test('样本不足 → 保持当前', () => {
    const history = [evaluateBalance(input())];
    assert.equal(recommendDifficulty(history, 'normal' as never, up, down), 'normal');
  });

  test('连续 2 次过易 → 升档', () => {
    const easy = evaluateBalance(input({ durationSec: 50, expectedDurationSec: 120 }));
    const history = [easy, easy, easy];
    assert.equal(recommendDifficulty(history, 'normal' as never, up, down), 'hard');
  });

  test('连续 2 次过难 → 降档', () => {
    const hard = evaluateBalance(input({ delivered: 2, deliverTarget: 10 }));
    const history = [hard, hard, hard];
    assert.equal(recommendDifficulty(history, 'normal' as never, up, down), 'easy');
  });

  test('适中为主 → 保持', () => {
    const ok = evaluateBalance(input());
    const history = [ok, ok, ok];
    assert.equal(recommendDifficulty(history, 'normal' as never, up, down), 'normal');
  });
});
