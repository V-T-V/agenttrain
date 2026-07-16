// 剧本解析单测：extractJson / parseScenario / normalizeScenario / mockScenario 的健壮性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, mockScenario, normalizeScenario, parseScenario } from '../src/ai/scenario.ts';

const rng = () => 0.5;

test('extractJson 直接对象', () => {
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});

test('extractJson 处理 ```json 围栏', () => {
  const text = '好的：\n```json\n{"cityName":"雾港"}\n```\n结束';
  assert.equal(extractJson(text), '{"cityName":"雾港"}');
});

test('extractJson 抠出前后带解释文字的 JSON', () => {
  const text = '这是结果 {"x":2,"y":3} 希望你喜欢';
  assert.equal(extractJson(text), '{"x":2,"y":3}');
});

test('extractJson 没有大括号返回 null', () => {
  assert.equal(extractJson('没有 json'), null);
});

test('parseScenario 合法 JSON 正常解析', () => {
  const text = JSON.stringify({
    cityName: '雾港',
    description: '一场大雾笼罩了线路。',
    trainSpeedMultiplier: 0.8,
    stationIntervalMultiplier: 1,
    events: [{ at: 30, kind: 'strike', stationShape: 'circle', duration: 12 }],
    deliverTarget: 55,
  });
  const s = parseScenario(text, rng);
  assert.equal(s.cityName, '雾港');
  assert.equal(s.events.length, 1);
  assert.equal(s.deliverTarget, 55);
});

test('parseScenario 速度倍率被夹到合理区间', () => {
  const text = JSON.stringify({ trainSpeedMultiplier: 0.1, deliverTarget: 999 });
  const s = parseScenario(text, rng);
  assert.ok(s.trainSpeedMultiplier >= 0.7);
  assert.ok(s.deliverTarget <= 80);
});

test('parseScenario 非法 JSON 回退默认剧本', () => {
  const s = parseScenario('完全不是 json', rng);
  assert.equal(s.cityName, '通勤之城');
  assert.equal(s.events.length, 0);
});

test('normalizeScenario 丢弃非法事件 kind', () => {
  const obj = {
    events: [
      { at: 10, kind: 'banana', duration: 10 },
      { at: 20, kind: 'slow', duration: 10 },
    ],
  };
  const s = normalizeScenario(obj, rng);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0]!.kind, 'slow');
});

test('normalizeScenario 事件最多保留 3 个且 at 递增', () => {
  const obj = {
    events: [
      { at: 10, kind: 'slow', duration: 10 },
      { at: 20, kind: 'slow', duration: 10 },
      { at: 30, kind: 'slow', duration: 10 },
      { at: 40, kind: 'slow', duration: 10 },
    ],
  };
  const s = normalizeScenario(obj, rng);
  assert.equal(s.events.length, 3);
  for (let i = 1; i < s.events.length; i++) {
    assert.ok(s.events[i]!.at > s.events[i - 1]!.at);
  }
});

test('normalizeScenario strike/surge 必须带合法 stationShape', () => {
  const obj = {
    events: [{ at: 10, kind: 'strike', duration: 10 }],
  };
  const s = normalizeScenario(obj, rng);
  assert.equal(s.events.length, 1);
  assert.ok(s.events[0]!.stationShape !== undefined);
});

test('mockScenario 产出合法结构', () => {
  const r = Math.random;
  const s = mockScenario(r);
  assert.ok(s.cityName.length > 0);
  assert.ok(s.trainSpeedMultiplier >= 0.7 && s.trainSpeedMultiplier <= 1);
  assert.ok(s.events.length >= 1);
  assert.ok(s.deliverTarget >= 40 && s.deliverTarget <= 80);
});
