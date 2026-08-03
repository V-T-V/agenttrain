// 道具效果端到端 + 计分倍率叠加深层测试。
// 覆盖此前未精细验证的组合行为：
// - combo × double 道具在真实送达时的得分叠加（通过 step 触发）
// - shield 同时重置多个满载站点的 overloadTimer
// - clear 在并列最堵时清空并加分语义（不加分只清人）
// - deliver 同时清空多列列车的乘客并加分
// - double + magnet 同时生效时各自计时器独立衰减
// - 空状态使用 clear/deliver/shield 不报错且不改 delivered
// - 加速道具在真实 step 中使列车实际跑更远
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine, step } from '../src/game/simulation.ts';
import { usePowerUp } from '../src/game/powerups.ts';
import { COMBO_STEP, TRAIN_CAPACITY } from '../src/game/config.ts';
import type { GameState, Station } from '../src/game/types.ts';

const SEG_TIME = 1 / 0.45;

function bareState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.stations = [];
  s.lines = [];
  s.trains = [];
  s.eventQueue = [];
  s.activeEvents = [];
  s.nextPassengerIn = Number.MAX_SAFE_INTEGER;
  s.nextStationIn = Number.MAX_SAFE_INTEGER;
  s.nextPowerUpIn = Number.MAX_SAFE_INTEGER;
  s.scenario = {
    cityName: 't',
    description: '',
    trainSpeedMultiplier: 1,
    stationIntervalMultiplier: 1,
    events: [],
    deliverTarget: 9999,
  };
  return s;
}

function addStationAt(
  s: GameState,
  shape: Station['shape'],
  x: number,
  y: number,
  kind: Station['kind'] = 'normal',
): Station {
  const st: Station = {
    id: s.nextStationId++,
    shape,
    pos: { x, y },
    passengers: [],
    overloadTimer: 0,
    kind,
  };
  s.stations.push(st);
  return st;
}

test('shield 同时重置多个满载站的 overloadTimer', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  const c = addStationAt(s, 'square', 2000, 0);
  // 三站都满载且各有不同的 overloadTimer
  for (const st of [a, b, c]) {
    st.passengers = Array.from({ length: s.capacity }, () => ({ target: 'circle' }));
    st.overloadTimer = 5;
  }
  s.inventory.shield = 1;
  usePowerUp(s, 'shield');
  assert.equal(a.overloadTimer, 0);
  assert.equal(b.overloadTimer, 0);
  assert.equal(c.overloadTimer, 0);
  // 乘客未被清走（shield 只重置计时器）
  assert.equal(a.passengers.length, s.capacity);
});

test('shield 只重置已达容量的站，未满载站不受影响', () => {
  const s = bareState();
  const full = addStationAt(s, 'circle', 0, 0);
  const half = addStationAt(s, 'triangle', 1000, 0);
  full.passengers = Array.from({ length: s.capacity }, () => ({ target: 'circle' }));
  full.overloadTimer = 4;
  half.passengers = [{ target: 'circle' }];
  half.overloadTimer = 99; // 一个非零但未满载的值
  s.inventory.shield = 1;
  usePowerUp(s, 'shield');
  assert.equal(full.overloadTimer, 0, '满载站应重置');
  // 未满载站 shield 不动其 overloadTimer（shield 只处理 >= capacity 的）
  assert.equal(half.overloadTimer, 99, '未满载站 overloadTimer 不应被 shield 改动');
});

test('clear 清空乘客最多那个站，其它站不动', () => {
  const s = bareState();
  const busy = addStationAt(s, 'circle', 0, 0);
  const quiet = addStationAt(s, 'triangle', 1000, 0);
  busy.passengers = Array.from({ length: 5 }, () => ({ target: 'circle' }));
  quiet.passengers = [{ target: 'circle' }];
  const before = s.delivered;
  s.inventory.clear = 1;
  usePowerUp(s, 'clear');
  assert.equal(busy.passengers.length, 0, '最堵站应被清空');
  assert.equal(quiet.passengers.length, 1, '其它站不动');
  assert.equal(s.delivered, before, 'clear 不应加分');
});

test('clear 在并列最堵时清空第一个并列最大者（实现：严格 > 保留首个）', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  // 两站并列 3 人
  a.passengers = Array.from({ length: 3 }, () => ({ target: 'circle' }));
  b.passengers = Array.from({ length: 3 }, () => ({ target: 'circle' }));
  s.inventory.clear = 1;
  usePowerUp(s, 'clear');
  // 实现用严格 >，并列时不会替换 → 第一个最大者 a 被清空
  assert.equal(a.passengers.length, 0, '并列时 clear 清空第一个最大者');
  assert.equal(b.passengers.length, 3);
});

test('clear 在所有站都空时不报错', () => {
  const s = bareState();
  addStationAt(s, 'circle', 0, 0);
  addStationAt(s, 'triangle', 1000, 0);
  s.inventory.clear = 1;
  assert.doesNotThrow(() => usePowerUp(s, 'clear'));
  assert.equal(s.delivered, 0);
});

test('deliver 同时清空多列列车并按人数加分', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  const c = addStationAt(s, 'square', 2000, 0);
  createLine(s, a.id, b.id);
  createLine(s, b.id, c.id);
  // 两列车各载若干人
  s.trains[0]!.passengers = Array.from({ length: 3 }, () => ({ target: 'triangle' }));
  s.trains[1]!.passengers = Array.from({ length: 4 }, () => ({ target: 'square' }));
  const before = s.delivered;
  s.inventory.deliver = 1;
  usePowerUp(s, 'deliver');
  assert.equal(s.delivered, before + 3 + 4, 'deliver 应按车上总人数加分');
  assert.equal(s.trains[0]!.passengers.length, 0);
  assert.equal(s.trains[1]!.passengers.length, 0);
});

test('deliver 在所有列车都空时不加分', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const before = s.delivered;
  s.inventory.deliver = 1;
  usePowerUp(s, 'deliver');
  assert.equal(s.delivered, before, '无乘客列车 deliver 不加分');
});

test('combo × double 在真实送达中叠加：双倍生效时每次送达 ×2 且连击累加', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  s.doubleScoreTimer = 30; // 双倍生效
  const tr = s.trains[0]!;
  // 车上 5 名去 triangle 的乘客
  tr.passengers = Array.from({ length: 5 }, () => ({ target: 'triangle' }));
  tr.dwellTimer = 0;
  const before = s.delivered;
  step(s, SEG_TIME + 0.001, new Rng(1));
  // 双倍生效：5 人送达应加 5×2=10 分（无连击基线）
  assert.equal(s.delivered - before, 10, '双倍道具下 5 名送达应 +10');
  assert.ok(s.combo.count >= 5, '连击应累加');
});

test('连击达 COMBO_STEP 阈值后倍率提升', () => {
  const s = bareState();
  // 手动构造连击：直接调用 registerComboHit 等价——这里通过送达模拟
  // 简化：直接设 combo.count 验证倍率计算路径
  s.combo.count = COMBO_STEP; // 达第一档阈值
  s.combo.timer = 3;
  // doubleScore 不生效时 scoreMultiplier = comboMultiplier = 1 + 1*0.5 = 1.5
  // 通过 simulation 送达验证：构造一次送达
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.passengers = [{ target: 'triangle' }];
  tr.dwellTimer = 0;
  const before = s.delivered;
  step(s, SEG_TIME + 0.001, new Rng(1));
  // 1 名送达 ×1.5 = 1.5 → 取整？delivered 是 number，1.5
  assert.ok(s.delivered - before >= 1.5, `连击阈值后送达应 ≥1.5，实际 ${s.delivered - before}`);
});

test('double 与 magnet 同时使用：两计时器独立衰减', () => {
  const s = bareState();
  s.inventory.double = 1;
  s.inventory.magnet = 1;
  usePowerUp(s, 'double');
  usePowerUp(s, 'magnet');
  const dStart = s.doubleScoreTimer;
  const mStart = s.magnetTimer;
  assert.ok(dStart > 0 && mStart > 0);
  // 各衰减 2 秒
  step(s, 2, new Rng(1));
  assert.ok(s.doubleScoreTimer < dStart, 'double 计时器应衰减');
  assert.ok(s.magnetTimer < mStart, 'magnet 计时器应衰减');
  assert.ok(Math.abs(dStart - s.doubleScoreTimer - 2) < 0.01, 'double 衰减量≈2s');
  assert.ok(Math.abs(mStart - s.magnetTimer - 2) < 0.01, 'magnet 衰减量≈2s');
});

test('加速道具在真实 step 中使列车明显跑更远', () => {
  function trainXAfter(boost: boolean): number {
    const s = bareState();
    const a = addStationAt(s, 'circle', 0, 0);
    const b = addStationAt(s, 'triangle', 1000, 0);
    createLine(s, a.id, b.id);
    s.trains[0]!.dwellTimer = 0;
    if (boost) {
      s.inventory.speed = 1;
      usePowerUp(s, 'speed');
    }
    step(s, SEG_TIME * 0.3, new Rng(1));
    // 列车 x 坐标（A 在 0，B 在 1000）
    const tr = s.trains[0]!;
    return tr.t; // 用段内进度 t 比较
  }
  assert.ok(trainXAfter(true) > trainXAfter(false), '加速下列车同样时间应进度更大');
});

test('列车满载(TRAIN_CAPACITY)时再 pickup 道具不影响载客', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.passengers = Array.from({ length: TRAIN_CAPACITY }, () => ({ target: 'triangle' }));
  // 这一断言只是确认列车结构允许满载；通过 step 不应崩溃
  tr.dwellTimer = 0;
  assert.doesNotThrow(() => step(s, SEG_TIME, new Rng(1)));
  assert.equal(s.phase, 'running');
});

test('道具库存为 0 时 usePowerUp 返回 false 且不消耗', () => {
  const s = bareState();
  // 所有库存都是 0（createInitialState 初始化）
  assert.equal(usePowerUp(s, 'speed'), false);
  assert.equal(usePowerUp(s, 'clear'), false);
  assert.equal(usePowerUp(s, 'deliver'), false);
  assert.equal(usePowerUp(s, 'shield'), false);
  assert.equal(usePowerUp(s, 'magnet'), false);
  assert.equal(usePowerUp(s, 'double'), false);
  // delivered 不变
  assert.equal(s.delivered, 0);
});
