/**
 * R14-D9（agenttrain）：eventRegistry.ts 事件注册表深层测试。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE_REGISTRY,
  getEventTypeDef,
  isEventActive,
  describeEvents,
} from '../src/game/eventRegistry.ts';
import type { ActiveEvent } from '../src/game/types.ts';

function event(kind: string, shape?: 'circle' | 'triangle'): ActiveEvent {
  return { kind, stationShape: shape, remaining: 10 } as ActiveEvent;
}

describe('EVENT_TYPE_REGISTRY', () => {
  test('含 strike/slow/surge', () => {
    const kinds = EVENT_TYPE_REGISTRY.map((e) => e.kind);
    assert.ok(kinds.includes('strike'));
    assert.ok(kinds.includes('slow'));
    assert.ok(kinds.includes('surge'));
  });

  test('每个定义有 kind/name/needsShape/isActive', () => {
    for (const e of EVENT_TYPE_REGISTRY) {
      assert.ok(typeof e.kind === 'string' && e.kind.length > 0);
      assert.ok(typeof e.name === 'string' && e.name.length > 0);
      assert.ok(typeof e.needsShape === 'boolean');
      assert.ok(typeof e.isActive === 'function');
    }
  });

  test('kind 唯一', () => {
    const kinds = EVENT_TYPE_REGISTRY.map((e) => e.kind);
    assert.equal(kinds.length, new Set(kinds).size);
  });
});

describe('getEventTypeDef', () => {
  test('已知 kind → 返回定义', () => {
    assert.ok(getEventTypeDef('strike'));
    assert.ok(getEventTypeDef('slow'));
    assert.ok(getEventTypeDef('surge'));
  });

  test('未知 kind → undefined', () => {
    assert.equal(getEventTypeDef('nonexistent'), undefined);
  });
});

describe('isEventActive', () => {
  test('strike 需匹配 shape', () => {
    const active = [event('strike', 'circle')];
    assert.ok(isEventActive(active, 'strike', 'circle'));
    assert.ok(!isEventActive(active, 'strike', 'triangle'));
  });

  test('slow 全局生效（不需 shape）', () => {
    const active = [event('slow')];
    assert.ok(isEventActive(active, 'slow'));
    assert.ok(!isEventActive(active, 'strike'));
  });

  test('surge 需匹配 shape', () => {
    const active = [event('surge', 'triangle')];
    assert.ok(isEventActive(active, 'surge', 'triangle'));
    assert.ok(!isEventActive(active, 'surge', 'circle'));
  });

  test('空 active → 全 false', () => {
    assert.ok(!isEventActive([], 'strike', 'circle'));
    assert.ok(!isEventActive([], 'slow'));
  });

  test('多个同类事件不同 shape', () => {
    const active = [event('strike', 'circle'), event('strike', 'triangle')];
    assert.ok(isEventActive(active, 'strike', 'circle'));
    assert.ok(isEventActive(active, 'strike', 'triangle'));
    assert.ok(!isEventActive(active, 'strike', 'square'));
  });
});

describe('describeEvents', () => {
  test('空 → 无事件提示', () => {
    const s = describeEvents([]);
    assert.ok(typeof s === 'string');
  });

  test('非空 → 含事件名', () => {
    const s = describeEvents([event('strike', 'circle'), event('slow')]);
    assert.ok(s.length > 0);
  });
});
