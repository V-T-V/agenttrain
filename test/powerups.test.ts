// 道具系统与连击系统单测：生成、拾取、使用、连击倍率。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/utils/rng.ts';
import { createInitialState } from '../src/game/state.ts';
import {
  comboMultiplier,
  maybeSpawnPowerUp,
  pickupPowerUps,
  registerComboHit,
  tickCombo,
  tickSpeedBoost,
  usePowerUp,
  isSpeedBoostActive,
} from '../src/game/powerups.ts';
import { createLine } from '../src/game/simulation.ts';
import { POWERUP_INTERVAL } from '../src/game/config.ts';
import type { GameState } from '../src/game/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  return s;
}

// ---------- 道具生成 ----------

test('maybeSpawnPowerUp 到间隔后生成一个道具', () => {
  const s = runningState();
  const rng = new Rng(7);
  s.nextPowerUpIn = 0.1;
  maybeSpawnPowerUp(s, 1, rng);
  assert.equal(s.powerUps.length, 1);
  assert.ok(['speed', 'clear', 'deliver'].includes(s.powerUps[0]!.type));
});

test('maybeSpawnPowerUp 未到间隔不生成', () => {
  const s = runningState();
  const rng = new Rng(7);
  s.nextPowerUpIn = POWERUP_INTERVAL;
  maybeSpawnPowerUp(s, 1, rng);
  assert.equal(s.powerUps.length, 0);
});

test('maybeSpawnPowerUp 达上限不再生成', () => {
  const s = runningState();
  const rng = new Rng(7);
  s.nextPowerUpIn = 0;
  s.powerUps = [
    { id: 0, type: 'speed', pos: { x: 100, y: 100 } },
    { id: 1, type: 'clear', pos: { x: 200, y: 100 } },
    { id: 2, type: 'deliver', pos: { x: 300, y: 100 } },
  ];
  maybeSpawnPowerUp(s, 1, rng);
  assert.equal(s.powerUps.length, 3);
});

// ---------- 拾取 ----------

test('pickupPowerUps 列车经过道具时收入背包', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  createLine(s, a.id, b.id); // 列车在 (0,0) 附近
  s.powerUps = [{ id: 0, type: 'speed', pos: { x: 5, y: 0 } }];
  pickupPowerUps(s);
  assert.equal(s.powerUps.length, 0);
  assert.equal(s.inventory.speed, 1);
});

test('pickupPowerUps 背包满(3)时丢弃多余', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  a.pos = { x: 0, y: 0 };
  b.pos = { x: 100, y: 0 };
  createLine(s, a.id, b.id);
  s.inventory.speed = 3;
  s.powerUps = [{ id: 0, type: 'speed', pos: { x: 5, y: 0 } }];
  pickupPowerUps(s);
  assert.equal(s.inventory.speed, 3, '已满不应再增加');
});

// ---------- 使用 ----------

test('usePowerUp speed 开启加速计时', () => {
  const s = runningState();
  s.inventory.speed = 1;
  assert.equal(usePowerUp(s, 'speed'), true);
  assert.ok(isSpeedBoostActive(s));
  assert.equal(s.inventory.speed, 0);
});

test('usePowerUp deliver 立即结算车上乘客', () => {
  const s = runningState();
  const [a, b] = s.stations;
  assert.ok(a && b);
  createLine(s, a.id, b.id);
  s.trains[0]!.passengers = [{ target: 'square' }, { target: 'square' }];
  s.inventory.deliver = 1;
  const before = s.delivered;
  usePowerUp(s, 'deliver');
  assert.equal(s.delivered, before + 2);
  assert.equal(s.trains[0]!.passengers.length, 0);
});

test('usePowerUp clear 清空最堵站点', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  s.stations[1]!.passengers = [{ target: 'circle' }, { target: 'circle' }, { target: 'circle' }];
  s.inventory.clear = 1;
  usePowerUp(s, 'clear');
  assert.equal(s.stations[1]!.passengers.length, 0, '最堵的站(1号)应被清空');
  assert.ok(s.stations[0]!.passengers.length > 0, '0号站应保留');
});

test('usePowerUp 无道具时失败', () => {
  const s = runningState();
  assert.equal(usePowerUp(s, 'speed'), false);
});

// ---------- 加速计时衰减 ----------

test('tickSpeedBoost 衰减到 0 后失效', () => {
  const s = runningState();
  s.speedBoostTimer = 1;
  tickSpeedBoost(s, 0.6);
  assert.ok(isSpeedBoostActive(s));
  tickSpeedBoost(s, 0.6);
  assert.equal(isSpeedBoostActive(s), false);
});

// ---------- 连击 ----------

test('comboMultiplier 无连击为 1 倍', () => {
  const s = runningState();
  assert.equal(comboMultiplier(s), 1);
});

test('registerComboHit 累加并刷新窗口', () => {
  const s = runningState();
  registerComboHit(s);
  registerComboHit(s);
  assert.equal(s.combo.count, 2);
  assert.ok(s.combo.timer > 0);
});

test('comboMultiplier 每 5 连 +0.5 倍', () => {
  const s = runningState();
  for (let i = 0; i < 5; i++) registerComboHit(s);
  assert.equal(comboMultiplier(s), 1.5);
  for (let i = 0; i < 5; i++) registerComboHit(s); // 共 10 连
  assert.equal(comboMultiplier(s), 2);
});

test('tickCombo 计时器归零后连击清零', () => {
  const s = runningState();
  registerComboHit(s);
  registerComboHit(s);
  s.combo.timer = 0.1;
  tickCombo(s, 0.5);
  assert.equal(s.combo.count, 0);
});

test('tickCombo 未到时不重置', () => {
  const s = runningState();
  registerComboHit(s);
  s.combo.timer = 2;
  tickCombo(s, 1);
  assert.equal(s.combo.count, 1);
});
