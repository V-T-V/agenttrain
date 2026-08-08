/**
 * R14-D8（agenttrain）：R14 新模块综合集成测试。
 *
 * 把 pathScore + trafficFlow + gameBalance 串起来——
 * 模拟一局完整分析：路径评估 → 流量分析 → 平衡性判定。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreProposedPath, comparePaths } from '../src/game/pathScore.ts';
import { analyzeTrafficFlow, flowBalance } from '../src/game/trafficFlow.ts';
import { evaluateBalance, describeBalance, recommendDifficulty } from '../src/game/gameBalance.ts';
import type { Station } from '../src/game/types.ts';

function station(id: string, shape: 'circle' | 'triangle' | 'square' = 'circle', x = 0, y = 0): Station {
  return { id, pos: { x, y }, shape, passengers: [], capacity: 6, overload: 0 } as Station;
}

describe('R14 综合集成', () => {
  test('完整分析流程产出有效数据', () => {
    // 1. 路径评估
    const path = scoreProposedPath([
      station('a', 'circle', 0, 0),
      station('b', 'triangle', 200, 0),
      station('c', 'square', 400, 0),
    ]);
    assert.ok(path.score > 0);
    assert.equal(path.feasibility, 'valid');

    // 2. 流量分析
    const traffic = analyzeTrafficFlow([
      { lineId: 'red', deliveredPerMin: 5, trainCount: 2 },
      { lineId: 'blue', deliveredPerMin: 3, trainCount: 2 },
    ]);
    assert.equal(traffic.totalFlow, 8);

    // 3. 平衡性
    const balance = evaluateBalance({
      difficulty: 'normal',
      delivered: 10,
      deliverTarget: 10,
      durationSec: 120,
      expectedDurationSec: 120,
      peakCombo: 5,
      overloadCount: 1,
    });
    assert.equal(balance.cleared, true);
    assert.equal(balance.rating, '适中');
  });

  test('多路径对比 + 流量 + 平衡联动', () => {
    const candidates: Station[][] = [
      [station('a', 'circle', 0, 0), station('b', 'circle', 200, 0)],
      [station('c', 'circle', 0, 0), station('d', 'triangle', 200, 0), station('e', 'square', 400, 0)],
    ];
    const { best, scores } = comparePaths(candidates);
    assert.ok(best !== null);
    assert.equal(scores.length, 2);

    // 用最优路径的数据做流量分析
    const traffic = analyzeTrafficFlow([
      { lineId: 'best', deliveredPerMin: best.length * 2, trainCount: best.length },
    ]);
    assert.ok(traffic.totalFlow > 0);

    // 平衡性
    const balance = evaluateBalance({
      difficulty: 'hard',
      delivered: 8,
      deliverTarget: 10,
      durationSec: 150,
      expectedDurationSec: 120,
      peakCombo: 3,
      overloadCount: 2,
    });
    assert.ok(['过易', '适中', '偏难', '过难'].includes(balance.rating));
  });

  test('空数据全模块不崩溃', () => {
    assert.equal(scoreProposedPath([]).feasibility, 'empty');
    assert.equal(analyzeTrafficFlow([]).totalFlow, 0);
    const b = evaluateBalance({
      difficulty: 'easy',
      delivered: 0,
      deliverTarget: 10,
      durationSec: 0,
      expectedDurationSec: 120,
      peakCombo: 0,
      overloadCount: 0,
    });
    assert.equal(b.cleared, false);
  });

  test('描述类函数产出可读字符串', () => {
    const b = evaluateBalance({
      difficulty: 'normal',
      delivered: 10,
      deliverTarget: 10,
      durationSec: 120,
      expectedDurationSec: 120,
      peakCombo: 5,
      overloadCount: 1,
    });
    const s = describeBalance(b);
    assert.ok(s.length > 0);
    assert.match(s, /%/);
  });

  test('难度自适应链路', () => {
    // 连续 3 局过易 → 升档
    const easyGames = Array(3).fill(0).map(() =>
      evaluateBalance({
        difficulty: 'normal',
        delivered: 10,
        deliverTarget: 10,
        durationSec: 50,
        expectedDurationSec: 120,
        peakCombo: 8,
        overloadCount: 0,
      }),
    );
    const rec = recommendDifficulty(easyGames, 'normal' as never, () => 'hard' as never, () => 'easy' as never);
    assert.equal(rec, 'hard');
  });
});
