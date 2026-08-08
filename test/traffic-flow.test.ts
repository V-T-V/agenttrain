/**
 * R14-D6（agenttrain）：交通流量分析器测试。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLineFlow,
  analyzeTrafficFlow,
  identifyBottlenecks,
  flowBalance,
} from '../src/game/trafficFlow.ts';

describe('computeLineFlow', () => {
  test('基本计算', () => {
    const f = computeLineFlow('red', 10, 2);
    assert.equal(f.lineId, 'red');
    assert.equal(f.flowPerMin, 10);
    assert.equal(f.loadPerTrain, 5);
    assert.ok(f.isBottleneck); // 5 > 2.0 默认阈值 → 瓶颈
  });

  test('高负载 → 瓶颈', () => {
    const f = computeLineFlow('red', 10, 2, 2.0);
    assert.ok(f.isBottleneck); // 10/2=5 > 2
  });

  test('低负载 → 非瓶颈', () => {
    const f = computeLineFlow('red', 2, 2, 2.0);
    assert.ok(!f.isBottleneck); // 2/2=1 < 2
  });

  test('无列车 → loadPerTrain=flow，非瓶颈（trainCount=0）', () => {
    const f = computeLineFlow('red', 10, 0);
    assert.equal(f.loadPerTrain, 10);
    assert.ok(!f.isBottleneck); // trainCount=0 不判瓶颈
  });

  test('负流量 → 钳制到 0', () => {
    const f = computeLineFlow('red', -5, 2);
    assert.equal(f.flowPerMin, 0);
  });

  test('自定义阈值', () => {
    assert.ok(!computeLineFlow('r', 5, 1, 10).isBottleneck); // 5 < 10 → 非瓶颈
    assert.ok(computeLineFlow('r', 15, 1, 10).isBottleneck); // 15 > 10 → 瓶颈
  });
});

describe('analyzeTrafficFlow', () => {
  test('空 → 全零', () => {
    const r = analyzeTrafficFlow([]);
    assert.equal(r.lines.length, 0);
    assert.equal(r.totalFlow, 0);
    assert.equal(r.bottleneckCount, 0);
  });

  test('单线路', () => {
    const r = analyzeTrafficFlow([{ lineId: 'red', deliveredPerMin: 5, trainCount: 2 }]);
    assert.equal(r.totalFlow, 5);
    assert.equal(r.avgFlow, 5);
  });

  test('多线路总流量累加', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'a', deliveredPerMin: 3, trainCount: 1 },
      { lineId: 'b', deliveredPerMin: 7, trainCount: 2 },
    ]);
    assert.equal(r.totalFlow, 10);
    assert.equal(r.avgFlow, 5);
  });

  test('瓶颈计数', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'ok', deliveredPerMin: 2, trainCount: 2 }, // 1 < 2
      { lineId: 'bad', deliveredPerMin: 10, trainCount: 1 }, // 10 > 2
    ]);
    assert.equal(r.bottleneckCount, 1);
  });

  test('balanceCV 单线路 = 0（无变异）', () => {
    const r = analyzeTrafficFlow([{ lineId: 'a', deliveredPerMin: 5, trainCount: 1 }]);
    assert.equal(r.balanceCV, 0);
  });

  test('balanceCV 非负', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'a', deliveredPerMin: 1, trainCount: 1 },
      { lineId: 'b', deliveredPerMin: 10, trainCount: 1 },
    ]);
    assert.ok(r.balanceCV >= 0);
  });

  test('advice 含瓶颈提示', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'overload', deliveredPerMin: 20, trainCount: 1 },
    ]);
    assert.match(r.advice, /过载|增配/);
  });

  test('advice 低流量提示', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'a', deliveredPerMin: 0.5, trainCount: 1 },
    ]);
    assert.match(r.advice, /偏低|优化/);
  });
});

describe('identifyBottlenecks', () => {
  test('返回瓶颈列表', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'ok', deliveredPerMin: 1, trainCount: 1 },
      { lineId: 'bad', deliveredPerMin: 10, trainCount: 1 },
    ]);
    const b = identifyBottlenecks(r);
    assert.equal(b.length, 1);
    assert.equal(b[0]!.lineId, 'bad');
  });

  test('无瓶颈 → 空', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'a', deliveredPerMin: 1, trainCount: 1 },
    ]);
    assert.equal(identifyBottlenecks(r).length, 0);
  });
});

describe('flowBalance', () => {
  test('空 → 均衡', () => {
    const r = analyzeTrafficFlow([]);
    assert.equal(flowBalance(r), '均衡');
  });

  test('单线路 → 均衡', () => {
    const r = analyzeTrafficFlow([{ lineId: 'a', deliveredPerMin: 5, trainCount: 1 }]);
    assert.equal(flowBalance(r), '均衡');
  });

  test('差异大 → 不均', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'a', deliveredPerMin: 1, trainCount: 1 },
      { lineId: 'b', deliveredPerMin: 100, trainCount: 1 },
    ]);
    assert.equal(flowBalance(r), '不均');
  });

  test('相近流量 → 均衡', () => {
    const r = analyzeTrafficFlow([
      { lineId: 'a', deliveredPerMin: 5, trainCount: 1 },
      { lineId: 'b', deliveredPerMin: 5.1, trainCount: 1 },
    ]);
    assert.equal(flowBalance(r), '均衡');
  });
});
