// scenario.normalizeEvent 深层边界测试。
// normalizeEvent 是 scenario.ts 内部函数（未导出），通过 normalizeScenario / parseScenario 间接覆盖。
// 本文件专攻：at 缺省/越界、stationShape 缺省降级、slow 不带 shape、duration 夹紧、
// 多事件 minAt 推进、kind 非法丢弃、stationShape 非法用 rng 兜底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenario, parseScenario } from '../src/ai/scenario.ts';

// 控制性 rng：返回固定值便于断言降级路径
const rngHalf = () => 0.5;

test('normalizeEvent：at 缺省（非数字）→ 用 rng 生成 20-60 区间', () => {
  const obj = { events: [{ kind: 'slow', duration: 10 }] }; // 无 at
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 1);
  const at = s.events[0]!.at;
  // 20 + floor(0.5*40) = 40；再夹到 [minAt+5, 90] = [5,90]
  assert.ok(at >= 20 && at <= 60, `at 应在 20-60 区间，实际 ${at}`);
});

test('normalizeEvent：at 超过 90 被夹到 90', () => {
  const obj = { events: [{ at: 999, kind: 'slow', duration: 10 }] };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events[0]!.at, 90);
});

test('normalizeEvent：at 低于 minAt+5 被抬到 minAt+5（保证递增）', () => {
  // 第二个事件 at=10，但 minAt 是上一事件的 at=50 → 应被抬到 55
  const obj = {
    events: [
      { at: 50, kind: 'slow', duration: 10 },
      { at: 10, kind: 'surge', stationShape: 'circle', duration: 10 },
    ],
  };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 2);
  assert.ok(s.events[1]!.at >= s.events[0]!.at + 5, '第二事件 at 应 >= 第一事件 at + 5');
  assert.equal(s.events[1]!.at, 55);
});

test('normalizeEvent：duration 夹到 [8, 20]', () => {
  const obj = { events: [{ at: 30, kind: 'slow', duration: 999 }] };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events[0]!.duration, 20);
  const obj2 = { events: [{ at: 30, kind: 'slow', duration: 1 }] };
  const s2 = normalizeScenario(obj2, rngHalf);
  assert.equal(s2.events[0]!.duration, 8);
});

test('normalizeEvent：slow 不需要 stationShape（不附加该字段）', () => {
  const obj = { events: [{ at: 30, kind: 'slow', duration: 10 }] };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events[0]!.stationShape, undefined);
});

test('normalizeEvent：strike 缺 stationShape → rng 兜底从 ALL_SHAPES 前 3 选', () => {
  const obj = { events: [{ at: 30, kind: 'strike', duration: 10 }] };
  const s = normalizeScenario(obj, rngHalf);
  // rng()=0.5, floor(0.5*3)=1 → ALL_SHAPES[1] = 'triangle'
  assert.equal(s.events[0]!.stationShape, 'triangle');
});

test('normalizeEvent：surge 非法 stationShape → rng 兜底', () => {
  const obj = {
    events: [{ at: 30, kind: 'surge', stationShape: 'hexagon', duration: 10 }],
  };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events[0]!.stationShape, 'triangle'); // 兜底
});

test('normalizeEvent：strike 合法 stationShape 被保留', () => {
  const obj = { events: [{ at: 30, kind: 'strike', stationShape: 'star', duration: 10 }] };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events[0]!.stationShape, 'star');
});

test('normalizeEvent：kind 非 strike/slow/surge → 整条事件被丢弃', () => {
  const obj = {
    events: [
      { at: 30, kind: 'banana', duration: 10 },
      { at: 40, kind: 'slow', duration: 10 },
    ],
  };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0]!.kind, 'slow');
});

test('normalizeEvent：kind 为 undefined → 丢弃', () => {
  const obj = { events: [{ at: 30, duration: 10 }] };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 0);
});

test('normalizeScenario：events 非数组 → 空 events', () => {
  const obj = { events: 'not-an-array' };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 0);
});

test('normalizeScenario：events 缺省 → 空 events', () => {
  const s = normalizeScenario({}, rngHalf);
  assert.equal(s.events.length, 0);
});

test('normalizeScenario：单个事件对象（非数组元素）→ 跳过', () => {
  const obj = { events: [{ at: 30, kind: 'slow', duration: 10 }, null, 42, 'x'] };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 1); // 只有第一条合法
});

test('normalizeScenario：cityName 非字符串 → fallback「通勤之城」', () => {
  const s = normalizeScenario({ cityName: 123 }, rngHalf);
  assert.equal(s.cityName, '通勤之城');
});

test('normalizeScenario：cityName 空白 → fallback', () => {
  const s = normalizeScenario({ cityName: '   ' }, rngHalf);
  assert.equal(s.cityName, '通勤之城');
});

test('normalizeScenario：cityName 超长（>12）→ 截断到 12', () => {
  const s = normalizeScenario({ cityName: '雾港雾港雾港雾港雾港雾港雾港' }, rngHalf);
  assert.ok(s.cityName.length <= 12);
});

test('normalizeScenario：description 非字符串 → fallback 默认描述', () => {
  const s = normalizeScenario({ description: null }, rngHalf);
  assert.ok(s.description.length > 0);
});

test('normalizeScenario：trainSpeedMultiplier 非数字 → fallback 1', () => {
  const s = normalizeScenario({ trainSpeedMultiplier: 'fast' }, rngHalf);
  assert.equal(s.trainSpeedMultiplier, 1);
});

test('normalizeScenario：trainSpeedMultiplier NaN → fallback 1', () => {
  const s = normalizeScenario({ trainSpeedMultiplier: NaN }, rngHalf);
  assert.equal(s.trainSpeedMultiplier, 1);
});

test('normalizeScenario：trainSpeedMultiplier 低于 0.7 → 夹到 0.7', () => {
  const s = normalizeScenario({ trainSpeedMultiplier: 0.1 }, rngHalf);
  assert.equal(s.trainSpeedMultiplier, 0.7);
});

test('normalizeScenario：stationIntervalMultiplier 高于 1.2 → 夹到 1.2', () => {
  const s = normalizeScenario({ stationIntervalMultiplier: 5 }, rngHalf);
  assert.equal(s.stationIntervalMultiplier, 1.2);
});

test('normalizeScenario：deliverTarget 非整数 → 取整', () => {
  const s = normalizeScenario({ deliverTarget: 55.7 }, rngHalf);
  assert.equal(s.deliverTarget, 56);
});

test('normalizeScenario：deliverTarget=0 → fallback 60（夹后取整）', () => {
  // clampNum(0, 40, 80, 60) → max(40, min(80, 0)) = 40，round=40
  const s = normalizeScenario({ deliverTarget: 0 }, rngHalf);
  assert.equal(s.deliverTarget, 40);
});

test('normalizeScenario：deliverTarget=200 → 夹到 80', () => {
  const s = normalizeScenario({ deliverTarget: 200 }, rngHalf);
  assert.equal(s.deliverTarget, 80);
});

test('normalizeScenario：obj=null → 全默认', () => {
  const s = normalizeScenario(null, rngHalf);
  assert.equal(s.cityName, '通勤之城');
  assert.equal(s.events.length, 0);
  assert.equal(s.trainSpeedMultiplier, 1);
});

test('normalizeScenario：obj=undefined → 全默认', () => {
  const s = normalizeScenario(undefined, rngHalf);
  assert.equal(s.cityName, '通勤之城');
});

test('normalizeScenario：完全空对象 → 全默认', () => {
  const s = normalizeScenario({}, rngHalf);
  assert.equal(s.cityName, '通勤之城');
  assert.equal(s.description.length > 0, true);
  assert.equal(s.trainSpeedMultiplier, 1);
  assert.equal(s.stationIntervalMultiplier, 1);
  assert.equal(s.events.length, 0);
  assert.equal(s.deliverTarget, 60);
});

test('parseScenario：JSON.parse 抛错（畸形 JSON）→ 默认剧本', () => {
  const s = parseScenario('{ broken json }', rngHalf);
  assert.equal(s.cityName, '通勤之城');
  assert.equal(s.events.length, 0);
});

test('parseScenario：null JSON 体 → 默认剧本（normalize 接住 null）', () => {
  const s = parseScenario('null', rngHalf);
  // extractJson 找不到 {} 配对（"null" 无大括号）→ 返回 null → 默认剧本
  assert.equal(s.cityName, '通勤之城');
});

test('parseScenario：仅大括号空对象 → 全默认', () => {
  const s = parseScenario('{}', rngHalf);
  assert.equal(s.cityName, '通勤之城');
  assert.equal(s.deliverTarget, 60);
});

test('normalizeScenario：5 个事件但只保留前 3 个', () => {
  const obj = {
    events: [
      { at: 20, kind: 'slow', duration: 10 },
      { at: 35, kind: 'slow', duration: 10 },
      { at: 50, kind: 'slow', duration: 10 },
      { at: 65, kind: 'slow', duration: 10 },
      { at: 80, kind: 'slow', duration: 10 },
    ],
  };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.events.length, 3);
});

test('normalizeScenario：事件全部非法（kind 错）→ 空 events 但剧本仍可用', () => {
  const obj = {
    cityName: '雾港',
    events: [
      { at: 20, kind: 'x', duration: 10 },
      { at: 30, kind: 'y', duration: 10 },
    ],
  };
  const s = normalizeScenario(obj, rngHalf);
  assert.equal(s.cityName, '雾港');
  assert.equal(s.events.length, 0);
});
