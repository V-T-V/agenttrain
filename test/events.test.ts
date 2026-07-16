// 剧本事件调度单测：纯函数 buildEventQueue / pumpEvents / tickActiveEvents / 查询。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventQueue,
  describeActive,
  isSlowActive,
  isStrikeActive,
  isSurgeActive,
  pumpEvents,
  tickActiveEvents,
} from '../src/game/events.ts';
import { defaultScenario } from '../src/game/state.ts';
import type { ActiveEvent, Scenario, ScriptedEvent } from '../src/game/types.ts';

function scenarioWith(events: ScriptedEvent[]): Scenario {
  const s = defaultScenario();
  s.events = events;
  return s;
}

test('buildEventQueue 按 at 升序排序', () => {
  const s = scenarioWith([
    { at: 40, kind: 'slow', duration: 10 },
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 10 },
    { at: 25, kind: 'surge', stationShape: 'square', duration: 10 },
  ]);
  const q = buildEventQueue(s);
  assert.deepEqual(
    q.map((e) => e.at),
    [10, 25, 40],
  );
});

test('pumpEvents 把到点的事件移入 active 并移出队列', () => {
  const s = scenarioWith([
    { at: 10, kind: 'strike', stationShape: 'circle', duration: 12 },
    { at: 30, kind: 'slow', duration: 10 },
  ]);
  const q = buildEventQueue(s);
  const active: ActiveEvent[] = [];
  pumpEvents(15, q, active);
  assert.equal(active.length, 1);
  assert.equal(active[0]!.kind, 'strike');
  assert.equal(q.length, 1, '未到点的事件应留在队列');
});

test('pumpEvents 不重复触发（已触发的从队列移除）', () => {
  const s = scenarioWith([{ at: 10, kind: 'slow', duration: 10 }]);
  const q = buildEventQueue(s);
  const active: ActiveEvent[] = [];
  pumpEvents(10, q, active);
  pumpEvents(20, q, active);
  assert.equal(active.length, 1);
  assert.equal(q.length, 0);
});

test('tickActiveEvents 衰减并移除归零事件', () => {
  const active: ActiveEvent[] = [
    { kind: 'slow', remaining: 5 },
    { kind: 'strike', stationShape: 'circle', remaining: 0.3 },
  ];
  tickActiveEvents(active, 1);
  assert.equal(active.length, 1);
  assert.equal(active[0]!.kind, 'slow');
  assert.ok(active[0]!.remaining < 5);
});

test('查询函数正确反映 active 状态', () => {
  const active: ActiveEvent[] = [
    { kind: 'strike', stationShape: 'triangle', remaining: 5 },
    { kind: 'surge', stationShape: 'square', remaining: 5 },
  ];
  assert.equal(isStrikeActive(active, 'triangle'), true);
  assert.equal(isStrikeActive(active, 'circle'), false);
  assert.equal(isSurgeActive(active, 'square'), true);
  assert.equal(isSlowActive(active), false);
});

test('describeActive 输出中文描述', () => {
  const active: ActiveEvent[] = [
    { kind: 'strike', stationShape: 'circle', remaining: 5 },
    { kind: 'slow', remaining: 5 },
  ];
  const desc = describeActive(active);
  assert.ok(desc.includes('罢工'));
  assert.ok(desc.includes('减速'));
});

test('describeActive 空数组返回空串', () => {
  assert.equal(describeActive([]), '');
});
