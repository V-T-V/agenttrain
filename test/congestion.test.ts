// 站点拥堵预测系统单测：历史采样、线性回归估算速率、ETA 预测、分级、全局汇总。
//
// 全部基于纯函数只读分析，构造可控 GameState 与 CongestionHistory 断言精确数值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import {
  SAMPLE_INTERVAL,
  MAX_SAMPLES,
  atRiskStations,
  congestionSnapshotLine,
  createCongestionHistory,
  linearRate,
  predictAll,
  predictStation,
  sample,
  summarizeCongestion,
  type CongestionHistory,
} from '../src/game/congestion.ts';
import type { GameState, Station } from '../src/game/types.ts';

function bareState(capacity = 6): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.capacity = capacity;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  s.nextStationIn = 1e9;
  s.stations = [];
  s.lines = [];
  s.trains = [];
  return s;
}

function makeStation(id: number, passengers = 0): Station {
  return {
    id,
    shape: 'circle',
    pos: { x: id * 100, y: 0 },
    passengers: Array.from({ length: passengers }, () => ({ target: 'square' })),
    overloadTimer: 0,
    kind: 'normal',
  };
}

/** 直接构造一个带指定样本序列的 history（绕过 sample 的 FIFO 逻辑）。 */
function historyWith(map: Record<number, Array<[number, number]>>): CongestionHistory {
  const samples: Record<number, Array<{ t: number; waiting: number }>> = {};
  for (const [id, arr] of Object.entries(map)) {
    samples[Number(id)] = arr.map(([t, waiting]) => ({ t, waiting }));
  }
  return { samples };
}

// ---------- linearRate 回归 ----------

test('linearRate: 空样本返回 0', () => {
  assert.equal(linearRate([]), 0);
});

test('linearRate: 单样本返回 0（不足趋势）', () => {
  assert.equal(linearRate([{ t: 0, waiting: 3 }]), 0);
});

test('linearRate: 稳定不变 → 速率 0', () => {
  const s = [
    { t: 0, waiting: 3 },
    { t: 2, waiting: 3 },
    { t: 4, waiting: 3 },
  ];
  assert.equal(linearRate(s), 0);
});

test('linearRate: 线性增长 +1/s', () => {
  const s = [
    { t: 0, waiting: 0 },
    { t: 2, waiting: 2 },
    { t: 4, waiting: 4 },
  ];
  assert.ok(Math.abs(linearRate(s) - 1) < 1e-9);
});

test('linearRate: 线性疏散 -0.5/s', () => {
  const s = [
    { t: 0, waiting: 4 },
    { t: 4, waiting: 2 },
    { t: 8, waiting: 0 },
  ];
  assert.ok(Math.abs(linearRate(s) - -0.5) < 1e-9);
});

test('linearRate: 含噪声仍近似真实斜率', () => {
  // 真实斜率 ~1/s，加微小波动
  const s = [
    { t: 0, waiting: 0 },
    { t: 1, waiting: 1.1 },
    { t: 2, waiting: 1.9 },
    { t: 3, waiting: 3.2 },
  ];
  const r = linearRate(s);
  assert.ok(r > 0.9 && r < 1.1, `rate=${r}`);
});

test('linearRate: 所有时间相同（den=0）返回 0', () => {
  const s = [
    { t: 5, waiting: 1 },
    { t: 5, waiting: 3 },
  ];
  assert.equal(linearRate(s), 0);
});

// ---------- sample 采样 ----------

test('sample: 空状态 → 空历史', () => {
  const s = bareState();
  const h = sample(s, createCongestionHistory(), 0);
  assert.deepEqual(h.samples, {});
});

test('sample: 首次采样记录当前等待数', () => {
  const s = bareState();
  s.stations.push(makeStation(1, 3));
  const h = sample(s, createCongestionHistory(), 10);
  assert.equal(h.samples[1]!.length, 1);
  assert.equal(h.samples[1]![0]!.waiting, 3);
  assert.equal(h.samples[1]![0]!.t, 10);
});

test('sample: 多次采样追加（FIFO 升序）', () => {
  const s = bareState();
  s.stations.push(makeStation(1, 1));
  let h = createCongestionHistory();
  for (let i = 0; i < 3; i++) {
    s.stations[0]!.passengers = Array.from({ length: i + 1 }, () => ({ target: 'square' }));
    h = sample(s, h, i * SAMPLE_INTERVAL);
  }
  assert.equal(h.samples[1]!.length, 3);
  assert.deepEqual(
    h.samples[1]!.map((x) => x.waiting),
    [1, 2, 3],
  );
});

test('sample: 超过 MAX_SAMPLES 截断 FIFO', () => {
  const s = bareState();
  s.stations.push(makeStation(1, 0));
  let h = createCongestionHistory();
  for (let i = 0; i < MAX_SAMPLES + 3; i++) {
    s.stations[0]!.passengers = Array.from({ length: i }, () => ({ target: 'square' }));
    h = sample(s, h, i * SAMPLE_INTERVAL);
  }
  assert.equal(h.samples[1]!.length, MAX_SAMPLES);
  // 最早样本被丢弃，保留最近 MAX_SAMPLES 个
  assert.deepEqual(
    h.samples[1]!.map((x) => x.waiting),
    [3, 4, 5, 6, 7, 8, 9, 10].slice(-MAX_SAMPLES),
  );
});

test('sample: 纯函数不修改入参 history', () => {
  const s = bareState();
  s.stations.push(makeStation(1, 5));
  const orig = createCongestionHistory();
  const h = sample(s, orig, 1);
  assert.deepEqual(orig.samples, {}); // 原对象不变
  assert.equal(h.samples[1]![0]!.waiting, 5);
});

test('sample: 站点消失后不再出现在新历史中', () => {
  const s = bareState();
  s.stations.push(makeStation(1, 2));
  const h1 = sample(s, createCongestionHistory(), 0);
  assert.ok(h1.samples[1]);
  // 移除站点
  s.stations = [];
  const h2 = sample(s, h1, 2);
  assert.equal(h2.samples[1], undefined);
});

// ---------- predictStation ----------

test('predictStation: 样本不足 → rate=0、eta=Infinity、severity 取决于 loadRatio', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 2));
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.current, 2);
  assert.equal(p!.capacity, 6);
  assert.equal(p!.rate, 0);
  assert.equal(p!.eta, Infinity);
  // loadRatio 2/6 ≈ 0.33 → safe
  assert.equal(p!.severity, 'safe');
});

test('predictStation: 已满载（current>=capacity）→ eta=0、overloaded', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 6));
  const h = historyWith({ 1: [[0, 6]] });
  const p = predictStation(s, h, 1);
  assert.equal(p!.current, 6);
  assert.equal(p!.eta, 0);
  assert.equal(p!.severity, 'overloaded');
});

test('predictStation: 增长中 → eta = (cap-cur)/rate', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 2)); // 当前 2
  // 速率 +1/s → 从 2 到 6 需 4 秒
  const h = historyWith({ 1: [[0, 0], [2, 2], [4, 4]] });
  const p = predictStation(s, h, 1);
  assert.ok(Math.abs(p!.rate - 1) < 1e-9);
  assert.ok(Math.abs(p!.eta - 4) < 1e-9);
});

test('predictStation: 疏散中（rate<0）→ eta=Infinity', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 3));
  const h = historyWith({ 1: [[0, 5], [2, 4], [4, 3]] }); // -0.5/s
  const p = predictStation(s, h, 1);
  assert.ok(p!.rate < 0);
  assert.equal(p!.eta, Infinity);
});

test('predictStation: loadRatio 计算正确', () => {
  const s = bareState(8);
  s.stations.push(makeStation(1, 4));
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.loadRatio, 0.5);
});

test('predictStation: 不存在的站点 → null', () => {
  const s = bareState(6);
  assert.equal(predictStation(s, createCongestionHistory(), 999), null);
});

test('predictStation: capacity=0 边界 loadRatio 处理', () => {
  const s = bareState(0);
  s.stations.push(makeStation(1, 0));
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.loadRatio, 0);
});

// ---------- severity 分级 ----------

test('severity: loadRatio>=1 → overloaded', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 7)); // > cap
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.severity, 'overloaded');
});

test('severity: loadRatio>=0.8 → critical', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 8)); // 0.8
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.severity, 'critical');
});

test('severity: eta<=10 → warning（即使 loadRatio 中等）', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 1)); // 当前 1
  // 速率很高 +1/s → eta=5s
  const h = historyWith({ 1: [[0, 0], [1, 1]] });
  const p = predictStation(s, h, 1);
  assert.ok(Math.abs(p!.eta - 5) < 1e-9);
  assert.equal(p!.severity, 'warning');
});

test('severity: loadRatio>=0.5 → watch', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 5));
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.severity, 'watch');
});

test('severity: 低负载远期 → safe', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 1));
  const p = predictStation(s, createCongestionHistory(), 1);
  assert.equal(p!.severity, 'safe');
});

// ---------- predictAll 排序 ----------

test('predictAll: 按 eta 升序（最急在前），Infinity 在后', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 2), makeStation(2, 5), makeStation(3, 9));
  // 站1 速率高很快满；站2 中等；站3 已接近满
  const h = historyWith({
    1: [[0, 0], [1, 2]], // rate 2/s, eta=(10-2)/2=4
    2: [[0, 4], [2, 5]], // rate 0.5/s, eta=(10-5)/0.5=10
    3: [[0, 8], [1, 9]], // rate 1/s, eta=(10-9)/1=1
  });
  const preds = predictAll(s, h);
  assert.equal(preds[0]!.stationId, 3); // eta=1 最急
  assert.equal(preds[1]!.stationId, 1); // eta=4
  assert.equal(preds[2]!.stationId, 2); // eta=10
});

test('predictAll: eta 相同时 loadRatio 高的在前', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 3), makeStation(2, 5));
  // 两站 eta 都是 4s（站1: rate 1.75, 站2: rate 1.25）
  const h = historyWith({
    1: [[0, 1], [2, 4.5]], // rate ~1.75
    2: [[0, 3], [2, 5.5]], // rate ~1.25
  });
  const preds = predictAll(s, h);
  // 站1 eta=(10-3)/1.75=4, 站2 eta=(10-5)/1.25=4 → 相同，loadRatio 站2高
  assert.ok(Math.abs(preds[0]!.eta - preds[1]!.eta) < 0.5);
  assert.equal(preds[0]!.stationId, 2);
});

test('predictAll: 空状态返回空数组', () => {
  const s = bareState();
  assert.deepEqual(predictAll(s, createCongestionHistory()), []);
});

test('predictAll: 返回数量 = 站点数', () => {
  const s = bareState(6);
  for (let i = 1; i <= 5; i++) s.stations.push(makeStation(i, i));
  const preds = predictAll(s, createCongestionHistory());
  assert.equal(preds.length, 5);
});

// ---------- atRiskStations ----------

test('atRiskStations: 返回 horizon 内即将满载的站（不含已满载）', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 1), makeStation(2, 9), makeStation(3, 5));
  const h = historyWith({
    1: [[0, 0], [1, 1]], // rate 1, eta=9 → in horizon(10)
    2: [[0, 8], [1, 9]], // rate 1, eta=1 → in horizon
    3: [[0, 0], [1, 0.1]], // rate 0.1, eta=50 → out
  });
  const risk = atRiskStations(s, h, 10);
  assert.equal(risk.length, 2);
  assert.deepEqual(
    risk.map((r) => r.stationId).sort(),
    [1, 2],
  );
});

test('atRiskStations: 已满载站（eta=0）不计入', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 6)); // 已满载
  const h = historyWith({ 1: [[0, 6]] });
  const risk = atRiskStations(s, h, 10);
  assert.equal(risk.length, 0);
});

test('atRiskStations: horizon=0 时不返回任何站（eta>0 且 <=0 不存在）', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 9));
  const h = historyWith({ 1: [[0, 8], [1, 9]] }); // eta=1
  const risk = atRiskStations(s, h, 0);
  assert.equal(risk.length, 0);
});

// ---------- summarizeCongestion ----------

test('summarizeCongestion: 无站点 → 平稳建议', () => {
  const s = bareState();
  const sum = summarizeCongestion(s, createCongestionHistory());
  assert.equal(sum.stationCount, 0);
  assert.equal(sum.overloadedCount, 0);
  assert.equal(sum.upcomingCount, 0);
  assert.equal(sum.mostUrgentId, null);
  assert.equal(sum.mostUrgentEta, Infinity);
  assert.equal(sum.advice, '全局负荷平稳，暂无拥堵风险。');
});

test('summarizeCongestion: 已满载 → 立即疏散建议', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 6));
  const h = historyWith({ 1: [[0, 6]] });
  const sum = summarizeCongestion(s, h);
  assert.equal(sum.overloadedCount, 1);
  assert.ok(sum.advice.includes('已满载'));
  assert.ok(sum.advice.includes('立即疏散'));
});

test('summarizeCongestion: 2 站即将满载 → 多站分流建议', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 8), makeStation(2, 9));
  const h = historyWith({
    1: [[0, 7], [1, 8]], // rate 1, eta=2
    2: [[0, 8], [1, 9]], // rate 1, eta=1
  });
  const sum = summarizeCongestion(s, h, 10);
  assert.equal(sum.upcomingCount, 2);
  assert.ok(sum.advice.includes('分流'));
});

test('summarizeCongestion: 仅 1 站即将满载 → 单站提前布线建议', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 5), makeStation(2, 1));
  const h = historyWith({
    1: [[0, 4], [1, 5]], // rate 1, eta=5
    2: [[0, 0.9], [1, 1]], // rate 0.1, eta=90
  });
  const sum = summarizeCongestion(s, h, 10);
  assert.equal(sum.upcomingCount, 1);
  assert.equal(sum.mostUrgentId, 1);
  assert.ok(Math.abs(sum.mostUrgentEta - 5) < 1e-9);
  assert.ok(sum.advice.includes('提前布线'));
  assert.ok(sum.advice.includes('5'));
});

test('summarizeCongestion: 全局增速快但无即将满载 → 留意运力建议', () => {
  const s = bareState(100); // 大容量，没人快满
  s.stations.push(makeStation(1, 2), makeStation(2, 3));
  const h = historyWith({
    1: [[0, 0], [1, 2]], // rate 2/s
    2: [[0, 1], [1, 3]], // rate 2/s
  });
  const sum = summarizeCongestion(s, h, 10);
  // globalRate = 4 > 0.5，且无 upcoming（eta 都 >>10）
  assert.ok(sum.globalRate > 0.5);
  assert.equal(sum.upcomingCount, 0);
  assert.ok(sum.advice.includes('留意运力'));
});

test('summarizeCongestion: mostUrgentEta 为 Infinity 时建议平稳', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 1));
  const h = historyWith({ 1: [[0, 1], [2, 1]] }); // rate 0
  const sum = summarizeCongestion(s, h, 10);
  assert.equal(sum.mostUrgentEta, Infinity);
  assert.equal(sum.advice, '全局负荷平稳，暂无拥堵风险。');
});

test('summarizeCongestion: globalRate = 所有站 rate 之和', () => {
  const s = bareState(20);
  s.stations.push(makeStation(1, 5), makeStation(2, 5), makeStation(3, 5));
  const h = historyWith({
    1: [[0, 4], [1, 5]], // 1
    2: [[0, 3], [1, 5]], // 2
    3: [[0, 5], [1, 5]], // 0
  });
  const sum = summarizeCongestion(s, h);
  assert.ok(Math.abs(sum.globalRate - 3) < 1e-9);
});

// ---------- congestionSnapshotLine ----------

test('congestionSnapshotLine: 无站点 → 特殊文本', () => {
  const s = bareState();
  const line = congestionSnapshotLine(s, createCongestionHistory());
  assert.equal(line, '  预测: (无站点)');
});

test('congestionSnapshotLine: 含已满载/即将满载计数', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 6), makeStation(2, 4));
  const h = historyWith({
    1: [[0, 6]], // 已满载
    2: [[0, 3], [1, 4]], // rate 1, eta=2 即将满载
  });
  const line = congestionSnapshotLine(s, h, 10);
  assert.ok(line.includes('预测:'));
  assert.ok(line.includes('已满载1'));
  assert.ok(line.includes('即将满载1'));
});

test('congestionSnapshotLine: 含最急 ETA 数字', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 8));
  const h = historyWith({ 1: [[0, 7], [1, 8]] }); // eta=2
  const line = congestionSnapshotLine(s, h, 10);
  assert.ok(line.includes('最急2s'));
});

test('congestionSnapshotLine: 无最急时 ETA 显示 —', () => {
  const s = bareState(10);
  s.stations.push(makeStation(1, 1));
  const h = historyWith({ 1: [[0, 1], [1, 1]] }); // rate 0
  const line = congestionSnapshotLine(s, h, 10);
  assert.ok(line.includes('最急—'));
});

// ---------- 端到端：采样后预测 ----------

test('端到端: 连续采样后预测 ETA 与手算一致', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 0));
  let h = createCongestionHistory();
  // 每 2 秒采样一次，乘客 +2 每次 → 速率 1/s
  for (let i = 0; i < 4; i++) {
    s.stations[0]!.passengers = Array.from({ length: i * 2 }, () => ({ target: 'square' }));
    h = sample(s, h, i * 2);
  }
  // 此时 current = 6 (最后一次 i=3 → 6)，已满载 → eta=0
  // 改为在满载前停止：i=2 → current=4
  s.stations[0]!.passengers = Array.from({ length: 4 }, () => ({ target: 'square' }));
  const p = predictStation(s, h, 1);
  assert.ok(Math.abs(p!.rate - 1) < 1e-9, `rate=${p!.rate}`);
  // current=4, cap=6, rate=1 → eta=2
  assert.ok(Math.abs(p!.eta - 2) < 1e-9, `eta=${p!.eta}`);
});

test('端到端: FIFO 截断后只用最近样本回归', () => {
  const s = bareState(20);
  s.stations.push(makeStation(1, 10));
  let h = createCongestionHistory();
  // 前 5 个样本缓慢增长，后 MAX_SAMPLES 个快速增长
  for (let i = 0; i < MAX_SAMPLES + 5; i++) {
    const waiting = i < 5 ? i : 5 + (i - 5) * 3; // 后段 +3/s
    s.stations[0]!.passengers = Array.from({ length: waiting }, () => ({ target: 'square' }));
    h = sample(s, h, i * 2);
  }
  // 只保留最近 MAX_SAMPLES 个样本（后段），速率应接近 3/2=1.5/s
  const p = predictStation(s, h, 1);
  assert.ok(p!.rate > 1 && p!.rate < 2, `rate=${p!.rate} 应接近 1.5`);
});
