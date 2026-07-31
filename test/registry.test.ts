// 注册表测试：验证 powerupRegistry 和 eventRegistry 的插件化行为正确。
// 确保重构后 usePowerUp 仍然正确分发到各道具、isEventActive 正确查询各事件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import { usePowerUp } from '../src/game/powerups.ts';
import { createLine } from '../src/game/simulation.ts';
import { POWERUP_REGISTRY, allPowerUpTypes, getPowerUpDef } from '../src/game/powerupRegistry.ts';
import {
  EVENT_TYPE_REGISTRY,
  describeEvents,
  getEventTypeDef,
  isEventActive,
} from '../src/game/eventRegistry.ts';
import type { ActiveEvent } from '../src/game/types.ts';

function runningState() {
  const s = createInitialState(1);
  s.phase = 'running';
  return s;
}

// ---------- powerupRegistry ----------

test('powerupRegistry 注册了 6 种道具', () => {
  assert.equal(POWERUP_REGISTRY.length, 6);
  assert.equal(allPowerUpTypes().length, 6);
});

test('allPowerUpTypes 包含全部 6 种 type', () => {
  const types = allPowerUpTypes();
  assert.ok(types.includes('speed'));
  assert.ok(types.includes('clear'));
  assert.ok(types.includes('deliver'));
  assert.ok(types.includes('magnet'));
  assert.ok(types.includes('shield'));
  assert.ok(types.includes('double'));
});

test('getPowerUpDef 返回正确的定义', () => {
  const def = getPowerUpDef('speed');
  assert.ok(def);
  assert.equal(def!.name, '加速');
  assert.equal(def!.emoji, '⚡');
  assert.ok(def!.duration > 0);
});

test('getPowerUpDef 未注册的 type 返回 undefined', () => {
  assert.equal(getPowerUpDef('nonexistent'), undefined);
});

test('usePowerUp 通过注册表正确分发 speed', () => {
  const s = runningState();
  s.inventory.speed = 1;
  assert.equal(usePowerUp(s, 'speed'), true);
  assert.ok(s.speedBoostTimer > 0);
  assert.equal(s.inventory.speed, 0);
});

test('usePowerUp 通过注册表正确分发 clear（清空最堵站）', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }, { target: 'square' }];
  s.stations[1]!.passengers = [{ target: 'circle' }];
  s.inventory.clear = 1;
  usePowerUp(s, 'clear');
  assert.equal(s.stations[0]!.passengers.length, 0);
});

test('usePowerUp 通过注册表正确分发 deliver', () => {
  const s = runningState();
  const [a, b] = s.stations;
  if (a && b) {
    a.pos = { x: 0, y: 0 };
    b.pos = { x: 100, y: 0 };
    createLine(s, a.id, b.id);
  }
  s.trains[0]!.passengers = [{ target: 'square' }, { target: 'square' }];
  s.inventory.deliver = 1;
  const before = s.delivered;
  usePowerUp(s, 'deliver');
  assert.equal(s.delivered, before + 2);
});

test('usePowerUp 通过注册表正确分发 shield', () => {
  const s = runningState();
  s.stations[0]!.passengers = Array.from({ length: s.capacity }, () => ({
    target: 'square',
  }));
  s.stations[0]!.overloadTimer = 3.5;
  s.inventory.shield = 1;
  usePowerUp(s, 'shield');
  assert.equal(s.stations[0]!.overloadTimer, 0);
});

test('usePowerUp 通过注册表正确分发 double', () => {
  const s = runningState();
  s.inventory.double = 1;
  usePowerUp(s, 'double');
  assert.ok(s.doubleScoreTimer > 0);
});

test('usePowerUp 通过注册表正确分发 magnet', () => {
  const s = runningState();
  s.inventory.magnet = 1;
  usePowerUp(s, 'magnet');
  assert.ok(s.magnetTimer > 0);
});

// ---------- eventRegistry ----------

test('eventRegistry 注册了 3 种事件', () => {
  assert.equal(EVENT_TYPE_REGISTRY.length, 3);
});

test('getEventTypeDef 返回正确的事件定义', () => {
  const def = getEventTypeDef('strike');
  assert.ok(def);
  assert.equal(def!.name, '罢工');
  assert.equal(def!.needsShape, true);
});

test('isEventActive: slow 全局生效', () => {
  const active: ActiveEvent[] = [{ kind: 'slow', remaining: 5 }];
  assert.equal(isEventActive(active, 'slow'), true);
  assert.equal(isEventActive([], 'slow'), false);
});

test('isEventActive: strike 需要匹配 shape', () => {
  const active: ActiveEvent[] = [{ kind: 'strike', stationShape: 'circle', remaining: 5 }];
  assert.equal(isEventActive(active, 'strike', 'circle'), true);
  assert.equal(isEventActive(active, 'strike', 'triangle'), false);
});

test('isEventActive: surge 需要匹配 shape', () => {
  const active: ActiveEvent[] = [{ kind: 'surge', stationShape: 'square', remaining: 5 }];
  assert.equal(isEventActive(active, 'surge', 'square'), true);
  assert.equal(isEventActive(active, 'surge', 'circle'), false);
});

test('isEventActive: 未注册的 kind 返回 false', () => {
  assert.equal(isEventActive([], 'nonexistent'), false);
});

test('describeEvents: 空 active 返回空串', () => {
  assert.equal(describeEvents([]), '');
});

test('describeEvents: 正确描述多事件', () => {
  const active: ActiveEvent[] = [
    { kind: 'strike', stationShape: 'circle', remaining: 5 },
    { kind: 'slow', remaining: 5 },
  ];
  const desc = describeEvents(active);
  assert.ok(desc.includes('罢工'));
  assert.ok(desc.includes('减速'));
});
