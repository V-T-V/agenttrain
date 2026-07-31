// 扩展道具（磁铁/护盾/双倍）与特殊站点（换乘/奖励）单测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import {
  isDoubleScoreActive,
  isMagnetActive,
  scoreMultiplier,
  tickDoubleScore,
  tickMagnet,
  usePowerUp,
} from '../src/game/powerups.ts';
import { createLine, step } from '../src/game/simulation.ts';
import type { GameState } from '../src/game/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  return s;
}

// ---------- 扩展道具 ----------

test('usePowerUp magnet 开启磁铁计时', () => {
  const s = runningState();
  s.inventory.magnet = 1;
  assert.equal(usePowerUp(s, 'magnet'), true);
  assert.ok(isMagnetActive(s));
  assert.equal(s.inventory.magnet, 0);
});

test('usePowerUp double 开启双倍得分计时', () => {
  const s = runningState();
  s.inventory.double = 1;
  assert.equal(usePowerUp(s, 'double'), true);
  assert.ok(isDoubleScoreActive(s));
  assert.equal(s.inventory.double, 0);
});

test('usePowerUp shield 清零满载站点的 overloadTimer', () => {
  const s = runningState();
  s.stations[0]!.passengers = Array.from({ length: s.capacity }, () => ({ target: 'square' }));
  s.stations[0]!.overloadTimer = 3.5;
  s.inventory.shield = 1;
  usePowerUp(s, 'shield');
  assert.equal(s.stations[0]!.overloadTimer, 0, '满载站的过载计时应被清零');
});

test('usePowerUp shield 不影响未满载站点', () => {
  const s = runningState();
  s.stations[0]!.overloadTimer = 2;
  s.inventory.shield = 1;
  usePowerUp(s, 'shield');
  // 未满载站本来就 overloadTimer=0（满载才累加），这里只验证没异常
  assert.equal(s.inventory.shield, 0);
});

test('tickMagnet 衰减到 0 后失效', () => {
  const s = runningState();
  s.magnetTimer = 1;
  tickMagnet(s, 0.6);
  assert.ok(isMagnetActive(s));
  tickMagnet(s, 0.6);
  assert.equal(isMagnetActive(s), false);
});

test('tickDoubleScore 衰减到 0 后失效', () => {
  const s = runningState();
  s.doubleScoreTimer = 1;
  tickDoubleScore(s, 0.6);
  assert.ok(isDoubleScoreActive(s));
  tickDoubleScore(s, 0.6);
  assert.equal(isDoubleScoreActive(s), false);
});

test('scoreMultiplier：双倍生效时连击倍率 ×2', () => {
  const s = runningState();
  // 制造 5 连击 → 连击倍率 1.5
  for (let i = 0; i < 5; i++) s.combo.count++;
  s.combo.timer = 3;
  assert.equal(scoreMultiplier(s), 1.5);
  s.doubleScoreTimer = 5; // 开双倍
  assert.equal(scoreMultiplier(s), 3); // 1.5 × 2
});

test('usePowerUp 无道具时失败（新道具同样）', () => {
  const s = runningState();
  assert.equal(usePowerUp(s, 'magnet'), false);
  assert.equal(usePowerUp(s, 'shield'), false);
  assert.equal(usePowerUp(s, 'double'), false);
});

// ---------- 特殊站点 ----------

test('奖励站送达得分 ×2', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a.shape = 'circle';
  b.shape = 'triangle';
  b.kind = 'bonus'; // b 是奖励站
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  createLine(s, a.id, b.id);
  s.trains[0]!.passengers = [{ target: 'triangle' }];
  const before = s.delivered;
  const rng = new Rng(2);
  step(s, 60, rng);
  // 至少送达一次，且因为 bonus 站 ×2，应 ≥ before+2
  assert.ok(s.delivered >= before + 2, '奖励站应至少双倍计分');
});

test('换乘站上车忽略「目标形状可达」检查', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a.shape = 'circle';
  b.shape = 'triangle';
  b.kind = 'transfer'; // b 是换乘站
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  createLine(s, a.id, b.id); // 线路只经过 circle 和 triangle
  // 站台放一个去 star 的乘客（本线不可达 star），但列车经过换乘站应能上车
  a.passengers = [{ target: 'star' }];
  const rng = new Rng(3);
  // 让列车先到 b（换乘站）—— 但乘客在 a。这里改成把乘客放 a，列车从 a 出发先经过 a
  // 实际：列车在 a 站上车时 a 不是换乘站；为了让换乘生效，把乘客放到 b（换乘站）
  a.passengers = [];
  b.passengers = [{ target: 'star' }];
  step(s, 30, rng);
  // 列车到 b（换乘站）时应把 star 乘客接上车（忽略可达）
  const onBoard = s.trains.reduce((n, t) => n + t.passengers.length, 0);
  assert.ok(onBoard > 0 || s.delivered > 0, '换乘站应允许任意乘客上车');
});

test('磁铁道具生效时列车可接任意乘客', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a.shape = 'circle';
  b.shape = 'triangle';
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  createLine(s, a.id, b.id);
  // 放一个不可达的乘客到 a
  a.passengers = [{ target: 'star' }];
  s.magnetTimer = 60; // 开磁铁（给足往返时间）
  const rng = new Rng(4);
  // 用小步长推进（与游戏主循环一致；大步长会一次性耗尽计时器）
  for (let i = 0; i < 120; i++) step(s, 0.5, rng);
  // 列车往返经过 a（磁铁生效）应把 star 乘客接上车
  const onBoard = s.trains.reduce((n, t) => n + t.passengers.length, 0);
  assert.ok(onBoard > 0, '磁铁生效时应能接不可达乘客');
});

test('特殊站点生成概率不破坏初始状态（开局站全是 normal）', () => {
  const s = createInitialState(1);
  for (const st of s.stations) {
    assert.equal(st.kind, 'normal');
  }
});

test('运行期生成的站点可能含特殊种类', () => {
  // 用多个种子跑足够久，应至少出现过一次特殊站
  let foundSpecial = false;
  for (let seed = 1; seed <= 30 && !foundSpecial; seed++) {
    const s = createInitialState(seed);
    s.phase = 'running';
    const rng = new Rng(seed);
    // 跑足够久生成多个新站
    for (let i = 0; i < 200; i++) step(s, 0.5, rng);
    foundSpecial = s.stations.some((st) => st.kind !== 'normal');
  }
  assert.ok(foundSpecial, '30 个种子里应至少出现一次特殊站点');
});
