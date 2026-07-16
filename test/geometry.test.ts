// geometry 单测：距离、沿线定位、点段距离。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closestPointOnSegment,
  dist,
  distToSegment,
  nearestSegmentIndex,
  positionAlong,
  segmentLength,
  totalLength,
} from '../src/game/geometry.ts';

test('dist 基本运算', () => {
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(dist({ x: 1, y: 1 }, { x: 1, y: 1 }), 0);
});

test('totalLength 累加各段', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: 3, y: 9 },
  ];
  // 5 + 5 = 10
  assert.equal(totalLength(pts), 10);
});

test('segmentLength 越界返回 0', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  assert.equal(segmentLength(pts, 0), 10);
  assert.equal(segmentLength(pts, 5), 0);
});

test('positionAlong 段内插值', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  assert.deepEqual(positionAlong(pts, 0, 0.0), { x: 0, y: 0 });
  assert.deepEqual(positionAlong(pts, 0, 0.5), { x: 5, y: 0 });
  assert.deepEqual(positionAlong(pts, 1, 0.5), { x: 10, y: 5 });
});

test('positionAlong 段索引被夹紧', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  // segment 超界被夹到 0
  assert.deepEqual(positionAlong(pts, 99, 0.0), { x: 0, y: 0 });
});

test('closestPointOnSegment 端点与中点', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.deepEqual(closestPointOnSegment({ x: -5, y: 5 }, a, b), { x: 0, y: 0 });
  assert.deepEqual(closestPointOnSegment({ x: 5, y: 5 }, a, b), { x: 5, y: 0 });
  assert.deepEqual(closestPointOnSegment({ x: 15, y: 5 }, a, b), { x: 10, y: 0 });
});

test('distToSegment 垂线距离', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(distToSegment({ x: 5, y: 3 }, a, b), 3);
});

test('nearestSegmentIndex 选最近段', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  // 点 (9,1) 离第 0 段近（水平段），点 (10,8) 离第 1 段近（竖直段）
  assert.equal(nearestSegmentIndex(pts, { x: 9, y: 1 }), 0);
  assert.equal(nearestSegmentIndex(pts, { x: 10, y: 8 }), 1);
});
