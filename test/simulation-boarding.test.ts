// simulation 乘客上车/可达性/容量深层测试。
// 覆盖 exchangePassengers 的可观察行为：
// - 目标形状在线路可达集才上车；否则留在站台
// - transfer 站忽略可达（任意乘客可上车）
// - magnet 道具生效时忽略可达
// - TRAIN_CAPACITY(6) 满载后不再上车
// - bonus 站送达 ×2
// - strike 事件站点不装卸
// - 站点满载过载计时累积 / 清空后归零
//
// 关键手法：createLine 后列车初始即停靠在线路第 0 站（dwellTimer=TRAIN_DWELL, direction=1），
// 处于「停留中、即将出发」状态。给出 dwell + 极小行进时间后，advanceTrain 会先消耗 dwell，
// 在消耗过程中列车尚未离站，但 exchangePassengers 仅在 arriveAtStation 时触发——
// 因此我们把列车手动设为 direction=-1（模拟「刚到 A 端点换向」），使其在第一帧重新触发
// arriveAtStation(A) 的装卸；再给足够时间让装卸完成。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine, extendLine, step } from '../src/game/simulation.ts';
import { TRAIN_CAPACITY } from '../src/game/config.ts';
import type { GameState, Station } from '../src/game/types.ts';

const SEG_TIME = 1 / 0.45; // 单段行程时间（trainSpeed=0.45 段/秒）

function bareState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.stations = [];
  s.lines = [];
  s.trains = [];
  s.eventQueue = [];
  s.activeEvents = [];
  // 关闭运行期随机乘客/站点生成，保证测试完全确定
  s.nextPassengerIn = Number.MAX_SAFE_INTEGER;
  s.nextStationIn = Number.MAX_SAFE_INTEGER;
  s.scenario = {
    cityName: 'test',
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

const rng = () => new Rng(123);

test('目标形状在线路可达集的乘客上车', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  addStationAt(s, 'triangle', 1000, 0); // B = triangle 可达
  a.passengers = [{ target: 'triangle' }];
  createLine(s, a.id, s.stations[1]!.id);
  const tr = s.trains[0]!;
  // 让列车从 A 出发到 B 再返回 A，触发在 A 的交换
  tr.dwellTimer = 0;
  step(s, SEG_TIME + 0.35 + SEG_TIME + 0.35 + 0.001, rng());
  // 列车往返一次回到 A，A 站乘客（可达 triangle）应上车
  assert.ok(
    tr.passengers.length >= 1 || s.delivered > 0,
    '可达目标乘客应上车（或已被送达）',
  );
});

test('目标形状不在可达集的乘客一直不上车', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  addStationAt(s, 'triangle', 1000, 0);
  a.passengers = [{ target: 'square' }]; // 线路无 square 站
  createLine(s, a.id, s.stations[1]!.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 跑两趟往返，square 乘客应始终留 A 站
  step(s, (SEG_TIME + 0.35) * 4, rng());
  assert.equal(
    a.passengers.filter((p) => p.target === 'square').length,
    1,
    '不可达目标乘客应一直留在 A',
  );
});

test('transfer 站：任意目标乘客可上车（忽略可达）', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0, 'transfer');
  addStationAt(s, 'triangle', 1000, 0);
  a.passengers = [{ target: 'square' }]; // 不可达，但 transfer 忽略
  createLine(s, a.id, s.stations[1]!.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  step(s, SEG_TIME + 0.35 + SEG_TIME + 0.35 + 0.001, rng());
  assert.equal(a.passengers.length, 0, 'transfer 站下不可达乘客也应上车');
});

test('magnet 道具生效时：任意目标乘客可上车', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  addStationAt(s, 'triangle', 1000, 0);
  a.passengers = [{ target: 'square' }]; // 不可达
  createLine(s, a.id, s.stations[1]!.id);
  s.magnetTimer = 30; // 磁铁长效生效
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  step(s, SEG_TIME + 0.35 + SEG_TIME + 0.35 + 0.001, rng());
  assert.equal(a.passengers.length, 0, '磁铁生效时不可达乘客也可上车');
});

test('TRAIN_CAPACITY 满载后多余乘客不上车', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  addStationAt(s, 'triangle', 1000, 0);
  // 站台放很多可达乘客；列车往返 A 时应一次性把 capacity 个接走
  a.passengers = Array.from({ length: TRAIN_CAPACITY + 5 }, () => ({ target: 'triangle' }));
  createLine(s, a.id, s.stations[1]!.id);
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  step(s, SEG_TIME + 0.35 + SEG_TIME + 0.35 + 0.001, rng());
  assert.ok(tr.passengers.length <= TRAIN_CAPACITY, `车上不应超过 ${TRAIN_CAPACITY}`);
  assert.ok(
    a.passengers.length >= 5,
    `至少 5 名乘客应留在站台（站台剩 ${a.passengers.length}）`,
  );
});

test('下车：目标=停靠站形状的乘客被送达并加分', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.passengers = [{ target: 'triangle' }, { target: 'triangle' }, { target: 'square' }];
  tr.dwellTimer = 0;
  const before = s.delivered;
  // 走到 B（triangle）触发送达
  step(s, SEG_TIME + 0.001, rng());
  assert.ok(s.delivered >= before + 2, `应送达 2 名 triangle，增量 ${s.delivered - before}`);
  // square 乘客应仍车上
  assert.ok(
    tr.passengers.some((p) => p.target === 'square'),
    'square 乘客不应下车',
  );
});

test('bonus 站送达得分 ×2', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0, 'bonus');
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.passengers = [{ target: 'triangle' }];
  tr.dwellTimer = 0;
  const before = s.delivered;
  step(s, SEG_TIME + 0.001, rng());
  assert.equal(s.delivered - before, 2, 'bonus 站送达应 ×2');
});

test('strike 事件站点不装卸', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  s.activeEvents.push({ kind: 'strike', stationShape: 'triangle', remaining: 999 });
  createLine(s, a.id, b.id);
  const tr = s.trains[0]!;
  tr.passengers = [{ target: 'triangle' }];
  tr.dwellTimer = 0;
  const before = s.delivered;
  step(s, SEG_TIME + 0.35 + SEG_TIME + 0.35, rng());
  assert.equal(s.delivered, before, '罢工 triangle 站不送达');
});

test('多站线路：可达集包含线上所有站点形状', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  const b = addStationAt(s, 'triangle', 1000, 0);
  const c = addStationAt(s, 'square', 2000, 0);
  createLine(s, a.id, b.id);
  extendLine(s, s.lines[0]!.id, c.id, false);
  // A 站乘客想去 square(c) 与 triangle(b)，都可达
  a.passengers = [{ target: 'square' }, { target: 'triangle' }];
  const tr = s.trains[0]!;
  tr.dwellTimer = 0;
  // 需要往返一圈回到 A 才首次装卸（createLine 的初始停留不触发 exchange）
  // 三站线 A→B→C→B→A，约 4 段 + 5 次停留
  step(s, SEG_TIME * 4 + 0.35 * 6, rng());
  assert.ok(
    tr.passengers.length >= 2 || s.delivered >= 2,
    `可达集含 square+triangle，两名乘客都应上车或送达（车上 ${tr.passengers.length}，已送达 ${s.delivered}）`,
  );
});

test('站点满载累积 overloadTimer，清空后归零', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  a.passengers = Array.from({ length: s.capacity }, () => ({ target: 'square' }));
  // 无线路 → 持续满载
  step(s, 1, rng());
  assert.ok(a.overloadTimer > 0, '满载站应累积 overloadTimer');
  a.passengers = []; // 模拟清运
  step(s, 0.1, rng());
  assert.equal(a.overloadTimer, 0, '清空后 overloadTimer 应归零');
});

test('容量边界：capacity-1 不算满载，不累积 overloadTimer', () => {
  const s = bareState();
  const a = addStationAt(s, 'circle', 0, 0);
  a.passengers = Array.from({ length: s.capacity - 1 }, () => ({ target: 'square' }));
  step(s, s.overloadGrace + 1, rng());
  assert.equal(a.overloadTimer, 0, 'capacity-1 不应触发过载计时');
  assert.equal(s.phase, 'running', 'capacity-1 不应 gameover');
});
