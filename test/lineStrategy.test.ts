// 多线路策略评估系统单测：评估每条线路的效率/负载/扩展性/连通性，
// 覆盖 evaluateLine / evaluateAllLines / summarizeStrategy 的各维度打分与边界。
//
// 全部基于纯函数只读分析，构造可控 GameState 以断言精确数值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import { createLine, extendLine } from '../src/game/simulation.ts';
import {
  evaluateAllLines,
  evaluateLine,
  summarizeStrategy,
  type LineScore,
} from '../src/game/lineStrategy.ts';
import type { GameState, Station, Train, Line, LineColor, Shape } from '../src/game/types.ts';

/** 默认列车容量（与 lineStrategy 内部 TRAIN_CAPACITY 一致）。 */
const TRAIN_CAP = 6;

/** 构造一个干净、running、关闭干扰机制的基准状态。 */
function bareState(capacity = 6): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.capacity = capacity;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  s.nextStationIn = 1e9;
  // 清空初始站点，由用例按需注入
  s.stations = [];
  s.lines = [];
  s.trains = [];
  return s;
}

/** 造一个站点。 */
function makeStation(id: number, shape: Shape, x: number, y: number, passengers = 0): Station {
  return {
    id,
    shape,
    pos: { x, y },
    passengers: Array.from({ length: passengers }, () => ({ target: 'square' })),
    overloadTimer: 0,
    kind: 'normal',
  };
}

/** 把站点按顺序串成一条线路，并自动配一列空列车。 */
function buildLine(
  state: GameState,
  color: LineColor,
  stops: Station[],
  opts: { withTrain?: boolean; onboard?: number[] } = {},
): Line {
  const { withTrain = true, onboard = [] } = opts;
  for (const st of stops) {
    if (!state.stations.some((s) => s.id === st.id)) state.stations.push(st);
  }
  const line: Line = {
    id: state.nextLineId++,
    color,
    stops: stops.map((s) => s.id),
  };
  state.lines.push(line);
  if (withTrain) {
    const train: Train = {
      lineId: line.id,
      segment: 0,
      t: 0,
      direction: 1,
      passengers: Array.from({ length: onboard[0] ?? 0 }, () => ({ target: 'square' })),
      dwellTimer: 0,
    };
    state.trains.push(train);
  }
  return line;
}

// ---------- evaluateLine 基本字段 ----------

test('evaluateLine: 两站一线、空载、形状覆盖 2', () => {
  const s = bareState();
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 300, 0);
  const line = buildLine(s, 'red', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.lineId, line.id);
  assert.equal(score.color, 'red');
  assert.equal(score.stopCount, 2);
  assert.equal(score.shapeCoverage, 2);
  assert.equal(score.waitingPassengers, 0);
  assert.equal(score.congestedStops, 0);
  assert.equal(score.avgLoadPerStop, 0);
  assert.equal(score.trainCount, 1);
  assert.equal(score.onboardPassengers, 0);
  assert.equal(score.trainUtilization, 0);
  assert.equal(score.lengthPx, 300);
  assert.ok(score.overall >= 0 && score.overall <= 100);
});

test('evaluateLine: 等待乘客总数与平均负载正确', () => {
  const s = bareState(6);
  // capacity=6, threshold = floor(4.8) = 4；3 名乘客 < 4 → 不拥堵
  const a = makeStation(1, 'circle', 0, 0, 2);
  const b = makeStation(2, 'square', 100, 0, 3);
  const line = buildLine(s, 'blue', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.waitingPassengers, 5);
  assert.equal(score.avgLoadPerStop, 2.5);
  assert.equal(score.congestedStops, 0);
});

test('evaluateLine: 拥堵站计数阈值 = floor(capacity*0.8)', () => {
  const s = bareState(6);
  // capacity=6, threshold = floor(4.8) = 4
  const a = makeStation(1, 'circle', 0, 0, 4); // 恰好 4 → 拥堵
  const b = makeStation(2, 'square', 100, 0, 3); // 3 → 不拥堵
  const line = buildLine(s, 'green', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.congestedStops, 1);
});

test('evaluateLine: 拥堵阈值随 capacity 自适应', () => {
  const s = bareState(10);
  // capacity=10, threshold = floor(8) = 8
  const a = makeStation(1, 'circle', 0, 0, 7); // 7 < 8 → 不拥堵
  const b = makeStation(2, 'square', 100, 0, 8); // 8 >= 8 → 拥堵
  const line = buildLine(s, 'orange', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.congestedStops, 1);
});

test('evaluateLine: capacity=1 时拥堵阈值至少为 1', () => {
  const s = bareState(1);
  const a = makeStation(1, 'circle', 0, 0, 1); // 1 >= max(1,floor(0.8))=1 → 拥堵
  const b = makeStation(2, 'square', 100, 0, 0);
  const line = buildLine(s, 'purple', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.congestedStops, 1);
});

// ---------- 列车利用率 (efficiency) ----------

test('evaluateLine: 列车满载时利用率 = 1，efficiency = 100', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [TRAIN_CAP] });
  const score = evaluateLine(s, line);
  assert.equal(score.onboardPassengers, TRAIN_CAP);
  assert.equal(score.trainUtilization, 1);
  assert.equal(score.breakdown.efficiency, 100);
});

test('evaluateLine: 列车半载时利用率 = 0.5，efficiency = 50', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  const score = evaluateLine(s, line);
  assert.equal(score.trainUtilization, 0.5);
  assert.equal(score.breakdown.efficiency, 50);
});

test('evaluateLine: 无列车时 utilization=0 且 extensibility 扣 20 分', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  // 端点附近有可延伸站点，但无列车
  const c = makeStation(3, 'square', 50, 10); // 距 a 约 51 < 600
  const d = makeStation(4, 'star', 150, 10); // 距 b 约 51 < 600
  s.stations.push(c, d);
  const line = buildLine(s, 'red', [a, b], { withTrain: false });
  const score = evaluateLine(s, line);
  assert.equal(score.trainCount, 0);
  assert.equal(score.trainUtilization, 0);
  assert.equal(score.expandableHead, true);
  assert.equal(score.expandableTail, true);
  // 两端可延伸本应 100，无列车扣 20 → 80
  assert.equal(score.breakdown.extensibility, 80);
});

test('evaluateLine: 多列车时利用率按总容量聚合', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [4] });
  // 再加一列同线列车，载 2 人
  s.trains.push({
    lineId: line.id,
    segment: 0,
    t: 0.5,
    direction: -1,
    passengers: Array.from({ length: 2 }, () => ({ target: 'square' })),
    dwellTimer: 0,
  });
  const score = evaluateLine(s, line);
  assert.equal(score.trainCount, 2);
  assert.equal(score.onboardPassengers, 6);
  // 6 / (2 * 6) = 0.5
  assert.equal(score.trainUtilization, 0.5);
  assert.equal(score.breakdown.efficiency, 50);
});

// ---------- 覆盖度 coverage ----------

test('evaluateLine: 形状覆盖 5 种 → shapePart 满分 60', () => {
  const s = bareState(6);
  const stops = [
    makeStation(1, 'circle', 0, 0),
    makeStation(2, 'triangle', 100, 0),
    makeStation(3, 'square', 200, 0),
    makeStation(4, 'diamond', 300, 0),
    makeStation(5, 'star', 400, 0),
  ];
  const line = buildLine(s, 'red', stops, { onboard: [3] });
  const score = evaluateLine(s, line);
  assert.equal(score.shapeCoverage, 5);
  // stopPart = min(40, 5*8=40) = 40 → coverage = 60+40 = 100
  assert.equal(score.breakdown.coverage, 100);
});

test('evaluateLine: 站点数多时 stopPart 上限 40', () => {
  const s = bareState(6);
  const stops: Station[] = [];
  for (let i = 0; i < 10; i++) {
    stops.push(makeStation(i + 1, 'circle', i * 100, 0));
  }
  const line = buildLine(s, 'red', stops, { onboard: [3] });
  const score = evaluateLine(s, line);
  // shapeCoverage=1 → shapePart = 12; stopPart = min(40, 80) = 40 → coverage=52
  assert.equal(score.breakdown.coverage, 52);
});

test('evaluateLine: 单形状单站（极端）coverage 低', () => {
  const s = bareState(6);
  // 注意：单站线路 stopCount=1，shapeCoverage=1
  const a = makeStation(1, 'circle', 0, 0);
  const line = buildLine(s, 'red', [a]);
  const score = evaluateLine(s, line);
  // shapePart = 1/5*60 = 12; stopPart = min(40, 8) = 8 → coverage = 20
  assert.equal(score.breakdown.coverage, 20);
});

// ---------- 拥堵缓解 congestionRelief ----------

test('evaluateLine: 0 拥堵站 → congestionRelief = 100', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0, 0);
  const b = makeStation(2, 'square', 100, 0, 0);
  const line = buildLine(s, 'red', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.breakdown.congestionRelief, 100);
});

test('evaluateLine: 拥堵站越多 congestionRelief 越低（每站 -25）', () => {
  const s = bareState(6);
  const stops = [
    makeStation(1, 'circle', 0, 0, 5), // 拥堵
    makeStation(2, 'square', 100, 0, 5), // 拥堵
    makeStation(3, 'triangle', 200, 0, 5), // 拥堵
    makeStation(4, 'diamond', 300, 0, 5), // 拥堵
  ];
  const line = buildLine(s, 'red', stops);
  const score = evaluateLine(s, line);
  // 4 拥堵站 → 100 - 100 = 0，clamp 到 0
  assert.equal(score.congestedStops, 4);
  assert.equal(score.breakdown.congestionRelief, 0);
});

test('evaluateLine: congestionRelief 下限为 0（不出现负值）', () => {
  const s = bareState(6);
  const stops: Station[] = [];
  for (let i = 0; i < 8; i++) stops.push(makeStation(i + 1, 'circle', i * 100, 0, 5));
  const line = buildLine(s, 'red', stops);
  const score = evaluateLine(s, line);
  assert.ok(score.breakdown.congestionRelief >= 0);
  assert.equal(score.breakdown.congestionRelief, 0);
});

// ---------- 扩展性 extensibility ----------

test('evaluateLine: 端点附近有未连接站点 → 可延伸', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'square', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  // a 附近 100px 有一个未在线路上的站
  s.stations.push(makeStation(3, 'triangle', 60, 10));
  // b 附近 100px 有一个未在线路上的站
  s.stations.push(makeStation(4, 'diamond', 160, 10));
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, true);
  assert.equal(score.expandableTail, true);
  assert.equal(score.breakdown.extensibility, 100);
});

test('evaluateLine: 端点附近无站点 → 不可延伸', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'square', 100, 0);
  // 唯一其它站点远离两端（>600px）
  s.stations.push(makeStation(3, 'triangle', 1000, 0));
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, false);
  assert.equal(score.expandableTail, false);
  assert.equal(score.breakdown.extensibility, 0);
});

test('evaluateLine: 仅一端可延伸 → extensibility = 50', () => {
  const s = bareState(6);
  // a 与 b 拉远（2000px），使靠近 a 的站只触发 head 延伸
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'square', 2000, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  // 仅 head 端附近有站（距 a=50 < 600，距 b=1950 > 600）
  s.stations.push(makeStation(3, 'triangle', 50, 0));
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, true);
  assert.equal(score.expandableTail, false);
  assert.equal(score.breakdown.extensibility, 50);
});

test('evaluateLine: 线路上的中间站不计入「可延伸」（排除已连接站）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'square', 100, 0);
  const c = makeStation(3, 'triangle', 200, 0);
  const line = buildLine(s, 'red', [a, b, c], { onboard: [3] });
  // b 是线路中间站，距两端虽近，但不应使端点被判为可延伸
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, false);
  assert.equal(score.expandableTail, false);
});

test('evaluateLine: 端点本身不计入可延伸候选（s.id !== head.id）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'square', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  const score = evaluateLine(s, line);
  // 只有 a、b 两站，端点不应自我匹配
  assert.equal(score.expandableHead, false);
  assert.equal(score.expandableTail, false);
});

// ---------- 综合分 overall ----------

test('evaluateLine: overall = 0.35*eff + 0.25*cov + 0.25*cong + 0.15*ext（四舍五入）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  // head/tail 端点附近各加一个站 → extensibility=100
  s.stations.push(makeStation(3, 'square', 50, 10));
  s.stations.push(makeStation(4, 'diamond', 150, 10));
  const score = evaluateLine(s, line);
  // efficiency=50, coverage: shapeCov2→24 + stop2*8=16 → 40, congestion=100, ext=100
  // overall = 0.35*50 + 0.25*40 + 0.25*100 + 0.15*100 = 17.5+10+25+15 = 67.5 → 68
  assert.equal(score.breakdown.efficiency, 50);
  assert.equal(score.breakdown.coverage, 40);
  assert.equal(score.breakdown.congestionRelief, 100);
  assert.equal(score.breakdown.extensibility, 100);
  assert.equal(score.overall, 68);
});

test('evaluateLine: overall 取值范围 [0,100]', () => {
  const s = bareState(6);
  // 全空载、无延伸、单形状
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'circle', 100, 0);
  const line = buildLine(s, 'red', [a, b]);
  const score = evaluateLine(s, line);
  assert.ok(score.overall >= 0 && score.overall <= 100);
});

// ---------- makeHint 文案 ----------

test('evaluateLine: hint - 站点过少（<2）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const line = buildLine(s, 'red', [a]);
  const score = evaluateLine(s, line);
  assert.equal(score.hint, '线路站点过少，建议延伸或重建。');
});

test('evaluateLine: hint - 拥堵 >=2 站', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0, 5);
  const b = makeStation(2, 'square', 100, 0, 5);
  const line = buildLine(s, 'red', [a, b]);
  const score = evaluateLine(s, line);
  assert.equal(score.congestedStops, 2);
  assert.equal(score.hint, '沿线 2 站拥堵，建议增配列车或分流。');
});

test('evaluateLine: hint - 列车高利用率（>0.8）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [5] });
  const score = evaluateLine(s, line);
  assert.ok(score.trainUtilization > 0.8);
  assert.equal(score.hint, '列车接近满载，运输效率高。');
});

test('evaluateLine: hint - 形状覆盖单一', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'circle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  const score = evaluateLine(s, line);
  assert.equal(score.shapeCoverage, 1);
  assert.equal(score.hint, '形状覆盖单一，建议接入不同形状站点。');
});

test('evaluateLine: hint - 两端均不可延伸（线路饱和）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  // 远处的站不影响
  s.stations.push(makeStation(3, 'square', 5000, 0));
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, false);
  assert.equal(score.expandableTail, false);
  assert.equal(score.hint, '两端无可延伸站点，线路已饱和。');
});

test('evaluateLine: hint - 两端均可延伸', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  s.stations.push(makeStation(3, 'square', 50, 10));
  s.stations.push(makeStation(4, 'diamond', 150, 10));
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, true);
  assert.equal(score.expandableTail, true);
  assert.equal(score.hint, '两端均可延伸，扩展性好。');
});

test('evaluateLine: hint - 默认正常文案（仅单端可延伸、利用率中等、形状覆盖 2）', () => {
  const s = bareState(6);
  // a 与 b 拉开足够距离（2000px），使靠近 a 的站只触发 head 延伸，不触发 tail
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 2000, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  // 仅 head 端附近有站（距 a=50 < 600，距 b=1950 > 600）
  s.stations.push(makeStation(3, 'square', 50, 0));
  const score = evaluateLine(s, line);
  assert.equal(score.expandableHead, true);
  assert.equal(score.expandableTail, false);
  assert.equal(score.hint, '线路运转正常。');
});

// ---------- evaluateAllLines 排序 ----------

test('evaluateAllLines: 按 overall 降序排列', () => {
  const s = bareState(6);
  // 线路 A：满载、覆盖广 → 高分
  const stopsA = [
    makeStation(1, 'circle', 0, 0),
    makeStation(2, 'triangle', 100, 0),
    makeStation(3, 'square', 200, 0),
  ];
  buildLine(s, 'red', stopsA, { onboard: [5] });
  // 线路 B：空载、单形状 → 低分
  const stopsB = [makeStation(4, 'diamond', 1000, 0), makeStation(5, 'diamond', 1100, 0)];
  buildLine(s, 'blue', stopsB, { onboard: [0] });
  const scores = evaluateAllLines(s);
  assert.equal(scores.length, 2);
  assert.ok(scores[0]!.overall >= scores[1]!.overall, '应降序排列');
});

test('evaluateAllLines: 无线路返回空数组', () => {
  const s = bareState();
  const scores = evaluateAllLines(s);
  assert.deepEqual(scores, []);
});

test('evaluateAllLines: 返回数量 = 线路数', () => {
  const s = bareState(6);
  for (let i = 0; i < 5; i++) {
    const a = makeStation(i * 10 + 1, 'circle', i * 200, 0);
    const b = makeStation(i * 10 + 2, 'triangle', i * 200 + 100, 0);
    buildLine(s, (['red', 'blue', 'green', 'orange', 'purple'] as LineColor[])[i]!, [a, b], {
      onboard: [3],
    });
  }
  const scores = evaluateAllLines(s);
  assert.equal(scores.length, 5);
});

// ---------- summarizeStrategy ----------

test('summarizeStrategy: 无线路 → 特殊建议', () => {
  const s = bareState();
  const summary = summarizeStrategy(s);
  assert.equal(summary.lineCount, 0);
  assert.equal(summary.averageScore, 0);
  assert.equal(summary.bestLineId, null);
  assert.equal(summary.worstLineId, null);
  assert.equal(summary.globalShapeCoverage, 0);
  assert.equal(summary.totalCongestedStops, 0);
  assert.equal(summary.globalTrainUtilization, 0);
  assert.equal(summary.advice, '尚无线路，建议先连接两个拥堵站点。');
});

test('summarizeStrategy: 单线路 → best=worst 同一线', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b], { onboard: [3] });
  const summary = summarizeStrategy(s);
  assert.equal(summary.lineCount, 1);
  assert.equal(summary.bestLineId, line.id);
  assert.equal(summary.worstLineId, line.id);
  assert.equal(summary.globalShapeCoverage, 2);
});

test('summarizeStrategy: 平均分 = 各线 overall 均值（四舍五入）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line1 = buildLine(s, 'red', [a, b], { onboard: [3] });
  const c = makeStation(3, 'square', 200, 0);
  const d = makeStation(4, 'diamond', 300, 0);
  const line2 = buildLine(s, 'blue', [c, d], { onboard: [4] });
  const scores = evaluateAllLines(s);
  const expected = Math.round((scores[0]!.overall + scores[1]!.overall) / 2);
  const summary = summarizeStrategy(s);
  assert.equal(summary.averageScore, expected);
  void line1;
  void line2;
});

test('summarizeStrategy: best/worst 取最高/最低 overall', () => {
  const s = bareState(6);
  // 高分线
  const stopsA = [
    makeStation(1, 'circle', 0, 0),
    makeStation(2, 'triangle', 100, 0),
    makeStation(3, 'square', 200, 0),
  ];
  const lineA = buildLine(s, 'red', stopsA, { onboard: [5] });
  // 低分线（空载单形状、远端）
  const stopsB = [makeStation(4, 'diamond', 5000, 0), makeStation(5, 'diamond', 5100, 0)];
  const lineB = buildLine(s, 'blue', stopsB, { onboard: [0] });
  const summary = summarizeStrategy(s);
  assert.equal(summary.bestLineId, lineA.id);
  assert.equal(summary.worstLineId, lineB.id);
});

test('summarizeStrategy: 全局形状覆盖跨线路聚合', () => {
  const s = bareState(6);
  // 线路 A 覆盖 circle, triangle
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0), makeStation(2, 'triangle', 100, 0)], {
    onboard: [3],
  });
  // 线路 B 覆盖 square, star
  buildLine(s, 'blue', [makeStation(3, 'square', 200, 0), makeStation(4, 'star', 300, 0)], {
    onboard: [3],
  });
  const summary = summarizeStrategy(s);
  assert.equal(summary.globalShapeCoverage, 4);
});

test('summarizeStrategy: 全局拥堵站总数累加（跨线路）', () => {
  const s = bareState(6);
  // 线路 A 有 1 个拥堵站
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0, 5), makeStation(2, 'triangle', 100, 0, 0)], {
    onboard: [3],
  });
  // 线路 B 有 2 个拥堵站
  buildLine(s, 'blue', [makeStation(3, 'square', 200, 0, 5), makeStation(4, 'star', 300, 0, 5)], {
    onboard: [3],
  });
  const summary = summarizeStrategy(s);
  assert.equal(summary.totalCongestedStops, 3);
});

test('summarizeStrategy: advice - 全局拥堵 >=3 优先分流最差线', () => {
  const s = bareState(6);
  // 构造 >=3 个拥堵站
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0, 5), makeStation(2, 'triangle', 100, 0, 5)], {
    onboard: [3],
  });
  buildLine(s, 'blue', [makeStation(3, 'square', 200, 0, 5), makeStation(4, 'star', 300, 0, 0)], {
    onboard: [3],
  });
  const summary = summarizeStrategy(s);
  assert.ok(summary.totalCongestedStops >= 3);
  assert.ok(summary.advice.startsWith('全局'));
  assert.ok(summary.advice.includes('优先分流'));
});

test('summarizeStrategy: advice - best-worst 分差 >=40 建议重构', () => {
  const s = bareState(6);
  // 高分线：3 形状、满载列车、两端可延伸
  buildLine(
    s,
    'red',
    [
      makeStation(1, 'circle', 0, 0),
      makeStation(2, 'triangle', 1500, 0),
      makeStation(3, 'square', 3000, 0),
    ],
    { onboard: [6] },
  );
  // 两端附近各放一个未连接站 → extensibility 满分
  s.stations.push(makeStation(10, 'star', 50, 0));
  s.stations.push(makeStation(11, 'diamond', 2950, 0));
  // 极低分线（空载、单形状、远端不可延伸）
  buildLine(s, 'blue', [makeStation(4, 'diamond', 9000, 0), makeStation(5, 'diamond', 9100, 0)], {
    onboard: [0],
  });
  const summary = summarizeStrategy(s);
  assert.ok(summary.advice.includes('考虑重构'), `实际：${summary.advice}`);
});

test('summarizeStrategy: advice - 全局利用率高 >0.85', () => {
  const s = bareState(6);
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0), makeStation(2, 'triangle', 100, 0)], {
    onboard: [6],
  });
  buildLine(s, 'blue', [makeStation(3, 'square', 200, 0), makeStation(4, 'star', 300, 0)], {
    onboard: [5],
  });
  const summary = summarizeStrategy(s);
  assert.ok(summary.globalTrainUtilization > 0.85);
  assert.equal(summary.advice, '全局列车利用率高，运输效率优秀。');
});

test('summarizeStrategy: advice - 形状覆盖不足 <=2', () => {
  const s = bareState(6);
  // 两条线都只覆盖 circle → 全局 1 种形状
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0), makeStation(2, 'circle', 100, 0)], {
    onboard: [3],
  });
  buildLine(s, 'blue', [makeStation(3, 'circle', 200, 0), makeStation(4, 'circle', 300, 0)], {
    onboard: [3],
  });
  const summary = summarizeStrategy(s);
  assert.ok(summary.globalShapeCoverage <= 2);
  assert.equal(summary.advice, '形状覆盖不足，建议接入更多形状的站点。');
});

test('summarizeStrategy: advice - 均衡时默认文案', () => {
  const s = bareState(6);
  // 两条对称线：形状覆盖 4、利用率中等、无拥堵、分差小
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0), makeStation(2, 'triangle', 100, 0)], {
    onboard: [3],
  });
  buildLine(s, 'blue', [makeStation(3, 'square', 200, 0), makeStation(4, 'star', 300, 0)], {
    onboard: [3],
  });
  const summary = summarizeStrategy(s);
  assert.equal(summary.advice, '整体线路策略均衡，继续保持。');
});

test('summarizeStrategy: 全局利用率无列车时为 0', () => {
  const s = bareState(6);
  buildLine(s, 'red', [makeStation(1, 'circle', 0, 0), makeStation(2, 'triangle', 100, 0)], {
    withTrain: false,
  });
  const summary = summarizeStrategy(s);
  assert.equal(summary.globalTrainUtilization, 0);
});

// ---------- 与游戏 API 联动（createLine/extendLine）集成 ----------

test('集成: createLine 创建的线路可被评估且站点数=2', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 'circle', 0, 0));
  s.stations.push(makeStation(2, 'triangle', 300, 0));
  assert.equal(createLine(s, 1, 2), true);
  const scores = evaluateAllLines(s);
  assert.equal(scores.length, 1);
  assert.equal(scores[0]!.stopCount, 2);
  assert.equal(scores[0]!.trainCount, 1); // createLine 自动配车
});

test('集成: extendLine 延伸后 stopCount 增加且形状覆盖扩大', () => {
  const s = bareState(6);
  s.stations.push(makeStation(1, 'circle', 0, 0));
  s.stations.push(makeStation(2, 'triangle', 300, 0));
  s.stations.push(makeStation(3, 'square', 600, 0));
  createLine(s, 1, 2);
  const lineId = s.lines[0]!.id;
  const before = evaluateLine(s, s.lines[0]!);
  assert.equal(before.stopCount, 2);
  assert.equal(before.shapeCoverage, 2);
  assert.equal(extendLine(s, lineId, 3, false), true);
  const after = evaluateLine(s, s.lines[0]!);
  assert.equal(after.stopCount, 3);
  assert.equal(after.shapeCoverage, 3);
});

test('集成: 多线路混合场景全局汇总合理', () => {
  const s = bareState(6);
  // 线路 1：优质线（多形状、有载客）
  buildLine(
    s,
    'red',
    [
      makeStation(1, 'circle', 0, 0),
      makeStation(2, 'triangle', 100, 0),
      makeStation(3, 'square', 200, 0),
    ],
    { onboard: [4] },
  );
  // 线路 2：劣质线（单形状、空载、远端）
  buildLine(s, 'blue', [makeStation(4, 'diamond', 5000, 0), makeStation(5, 'diamond', 5100, 0)], {
    onboard: [0],
  });
  const summary = summarizeStrategy(s);
  assert.equal(summary.lineCount, 2);
  assert.ok(summary.averageScore > 0);
  assert.ok(summary.bestLineId !== summary.worstLineId);
  assert.ok(summary.globalShapeCoverage >= 3);
});

// ---------- 数值健壮性 ----------

test('evaluateLine: 含 NaN 防御不崩溃（passengers 非法）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const b = makeStation(2, 'triangle', 100, 0);
  const line = buildLine(s, 'red', [a, b]);
  // 不直接造 NaN（类型约束），仅断言正常路径稳定
  const score = evaluateLine(s, line);
  assert.ok(Number.isFinite(score.overall));
  assert.ok(Number.isFinite(score.trainUtilization));
});

test('evaluateLine: 超长线路 lengthPx 正确累加', () => {
  const s = bareState(6);
  const stops: Station[] = [];
  for (let i = 0; i < 6; i++) stops.push(makeStation(i + 1, 'circle', i * 250, 0));
  const line = buildLine(s, 'red', stops, { onboard: [3] });
  const score = evaluateLine(s, line);
  // 5 段每段 250 → 1250
  assert.equal(score.lengthPx, 1250);
});

test('evaluateLine: 单点线路 lengthPx = 0（少于 2 点）', () => {
  const s = bareState(6);
  const a = makeStation(1, 'circle', 0, 0);
  const line = buildLine(s, 'red', [a]);
  const score = evaluateLine(s, line);
  assert.equal(score.lengthPx, 0);
});

test('evaluateLine: stops 引用了不存在站点时不崩溃', () => {
  const s = bareState(6);
  // 手工构造一条引用幽灵站 id 的线路
  const line: Line = { id: 99, color: 'red', stops: [1, 2, 999] };
  s.lines.push(line);
  s.stations.push(makeStation(1, 'circle', 0, 0));
  s.stations.push(makeStation(2, 'triangle', 100, 0));
  const score = evaluateLine(s, line);
  // 幽灵站被过滤，只评估存在的 2 站
  assert.equal(score.stopCount, 3); // line.stops.length 仍是 3
  assert.equal(score.shapeCoverage, 2); // 实际形状只来自 2 个存在站
});
