// simulation 深层单测：过载判负的精确帧数、多站点同时过载、恢复后继续、
// overloadTimer 在满载/未满载之间的状态机、不同难度的宽限时间。
//
// 这些用例聚焦 handleOverload 的边界行为，补充 simulation.test.ts 里只验证
// 「最终会 gameover」的粗粒度断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import { step } from '../src/game/simulation.ts';
import type { GameState, Station } from '../src/game/types.ts';

/** 构造一个 running 态、且把无用机制关掉（避免干扰）的最小状态。 */
function bareState(overloadGrace = 6, capacity = 6): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.capacity = capacity;
  s.overloadGrace = overloadGrace;
  // 关掉道具/事件/乘客/站点定时生成，避免它们改变 passenger 数量
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  s.nextStationIn = 1e9;
  return s;
}

/** 把某站塞满到 capacity。 */
function fillStation(st: Station, capacity: number): void {
  st.passengers = Array.from({ length: capacity }, () => ({ target: 'square' }));
  st.overloadTimer = 0;
}

// ---------- 精确帧数 ----------

test('满载站恰好在 overloadGrace 时判负（不到则不判）', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  // 累计 5.9 秒：未到 6 秒宽限，应仍 running
  step(s, 5.9, rng);
  assert.equal(s.phase, 'running', '5.9s < 6s 宽限不应判负');
  // 再走 0.1s 达到 6s 阈值 → gameover
  step(s, 0.1, rng);
  assert.equal(s.phase, 'gameover', '达到 6s 宽限应判负');
});

test('过载计时器随每帧 dt 累积（中间值可观测）', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  step(s, 2, rng);
  assert.ok(
    Math.abs(s.stations[0]!.overloadTimer - 2) < 1e-9,
    '2 秒后 overloadTimer 应 ≈ 2',
  );
  step(s, 1.5, rng);
  assert.ok(
    Math.abs(s.stations[0]!.overloadTimer - 3.5) < 1e-9,
    '再加 1.5 秒应 ≈ 3.5',
  );
});

test('宽限边界：5.99s 不判负、6.0s 判负', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  step(s, 5.99, rng);
  assert.equal(s.phase, 'running');
  assert.ok(s.stations[0]!.overloadTimer < 6);
  step(s, 0.01, rng);
  assert.equal(s.phase, 'gameover');
});

// ---------- 多站点同时过载 ----------

test('多站点同时满载，任一超宽限即判负', () => {
  const s = bareState(6);
  // 三个站同时塞满
  fillStation(s.stations[0]!, 6);
  fillStation(s.stations[1]!, 6);
  fillStation(s.stations[2]!, 6);
  const rng = new Rng(1);
  // 全部累计 5s 都未超
  step(s, 5, rng);
  assert.equal(s.phase, 'running');
  for (let i = 0; i < 3; i++) {
    assert.ok(s.stations[i]!.overloadTimer >= 5);
  }
  // 再走 1s → 三站都到 6s → gameover
  step(s, 1, rng);
  assert.equal(s.phase, 'gameover');
});

test('多个站中只有一个超宽限也会判负（最堵的那个先触发）', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  fillStation(s.stations[1]!, 6);
  const rng = new Rng(1);
  // 先把 0 号站推到 5s（0、1 都满，都会涨）
  step(s, 5, rng);
  // 然后单独给 0 号站预涨 1s，让它先到 6s
  s.stations[0]!.overloadTimer = 6;
  step(s, 0.01, rng);
  assert.equal(s.phase, 'gameover', '0 号站先超宽限应判负');
});

// ---------- 恢复后继续 ----------

test('站点在宽限内被清空 → overloadTimer 归零，可继续游戏', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  step(s, 4, rng); // 累计 4s，未判负
  assert.equal(s.phase, 'running');
  assert.ok(s.stations[0]!.overloadTimer >= 4);
  // 玩家清空该站（模拟列车接走所有乘客）
  s.stations[0]!.passengers = [];
  step(s, 5, rng); // 再走 5s
  assert.equal(s.phase, 'running', '清空后即使再走很久也不应判负');
  assert.equal(
    s.stations[0]!.overloadTimer,
    0,
    '未满载的站 overloadTimer 应归零',
  );
});

test('满载→清空→再满载：计时器重新从 0 累计', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  step(s, 3, rng); // overloadTimer ≈ 3
  // 清空
  s.stations[0]!.passengers = [];
  step(s, 1, rng); // 再走 1s，计时器应已归零
  assert.equal(s.stations[0]!.overloadTimer, 0);
  // 再次塞满
  fillStation(s.stations[0]!, 6);
  step(s, 5.5, rng); // 从 0 重新累计 5.5s，应未判负
  assert.equal(s.phase, 'running');
  assert.ok(s.stations[0]!.overloadTimer >= 5);
  // 再 0.6s → 超过 6s → gameover
  step(s, 0.6, rng);
  assert.equal(s.phase, 'gameover');
});

test('恰好 capacity-1 个乘客不算满载（不累积过载）', () => {
  const s = bareState(6);
  // 放 5 个（capacity-1），不满
  s.stations[0]!.passengers = Array.from({ length: 5 }, () => ({ target: 'square' }));
  const rng = new Rng(1);
  step(s, 100, rng);
  assert.equal(s.phase, 'running');
  assert.equal(s.stations[0]!.overloadTimer, 0, '未满载站计时器始终为 0');
});

// ---------- 难度宽限差异 ----------

test('困难档（宽限 4s）比普通档（6s）更快判负', () => {
  // 普通档：6s 判负
  const normal = bareState(6);
  fillStation(normal.stations[0]!, 6);
  step(normal, 5, new Rng(1));
  assert.equal(normal.phase, 'running');
  step(normal, 1, new Rng(1));
  assert.equal(normal.phase, 'gameover');

  // 困难档：4s 判负
  const hard = bareState(4);
  fillStation(hard.stations[0]!, 6);
  step(hard, 3.5, new Rng(1));
  assert.equal(hard.phase, 'running');
  step(hard, 0.5, new Rng(1));
  assert.equal(hard.phase, 'gameover', '困难档 4s 即判负');
});

// ---------- 容量边界 ----------

test('difficulty capacity 注入决定满载阈值', () => {
  const s = bareState(6, 5); // capacity=5
  // 放 4 个：不满
  s.stations[0]!.passengers = Array.from({ length: 4 }, () => ({ target: 'square' }));
  const rng = new Rng(1);
  step(s, 50, rng);
  assert.equal(s.phase, 'running');
  // 放第 5 个：达到 capacity=5 → 满载
  s.stations[0]!.passengers.push({ target: 'square' });
  step(s, 6, rng);
  assert.equal(s.phase, 'gameover', 'capacity=5 时 5 个即满载、6s 判负');
});

// ---------- 不推进情况 ----------

test('gameover 后即使再 step 也不再推进（停在终局）', () => {
  const s = bareState(6);
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  step(s, 6, rng);
  assert.equal(s.phase, 'gameover');
  const elapsedAtGameOver = s.elapsed;
  step(s, 10, rng); // 再推进不应生效
  assert.equal(s.elapsed, elapsedAtGameOver, 'gameover 后 elapsed 不应再增加');
});

test('step 在 paused 阶段同样不推进过载', () => {
  const s = bareState(6);
  s.phase = 'paused';
  fillStation(s.stations[0]!, 6);
  const rng = new Rng(1);
  const before = s.stations[0]!.overloadTimer;
  step(s, 10, rng);
  assert.equal(s.stations[0]!.overloadTimer, before);
  assert.equal(s.phase, 'paused');
});
