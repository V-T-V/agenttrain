/**
 * R14-D1（agenttrain）：geometry.ts 纯函数深层测试。
 *
 * 覆盖 dist/lerpVec2/positionAlong/totalLength/segmentLength/
 * nearestSegmentIndex/distToSegment/closestPointOnSegment 全分支与边界。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  dist,
  lerpVec2,
  positionAlong,
  totalLength,
  segmentLength,
  nearestSegmentIndex,
  distToSegment,
  closestPointOnSegment,
} from '../src/game/geometry.ts';
import type { Vec2 } from '../src/game/types.ts';

const P = (x: number, y: number): Vec2 => ({ x, y });

describe('dist', () => {
  test('同一点 → 0', () => {
    assert.equal(dist(P(1, 1), P(1, 1)), 0);
  });

  test('水平距离', () => {
    assert.equal(dist(P(0, 0), P(3, 0)), 3);
  });

  test('垂直距离', () => {
    assert.equal(dist(P(0, 0), P(0, 4)), 4);
  });

  test('对角线（3-4-5）', () => {
    assert.equal(dist(P(0, 0), P(3, 4)), 5);
  });

  test('负坐标', () => {
    assert.equal(dist(P(-1, -1), P(2, 3)), 5);
  });
});

describe('lerpVec2', () => {
  test('t=0 → a', () => {
    assert.deepEqual(lerpVec2(P(10, 20), P(30, 40), 0), P(10, 20));
  });

  test('t=1 → b', () => {
    assert.deepEqual(lerpVec2(P(10, 20), P(30, 40), 1), P(30, 40));
  });

  test('t=0.5 → 中点', () => {
    assert.deepEqual(lerpVec2(P(0, 0), P(10, 20), 0.5), P(5, 10));
  });

  test('t>1 钳制到 1', () => {
    assert.deepEqual(lerpVec2(P(0, 0), P(10, 0), 2), P(10, 0));
  });

  test('t<0 钳制到 0', () => {
    assert.deepEqual(lerpVec2(P(0, 0), P(10, 0), -1), P(0, 0));
  });
});

describe('positionAlong', () => {
  const pts = [P(0, 0), P(10, 0), P(10, 10)];

  test('段内 t=0 → 段起点', () => {
    assert.deepEqual(positionAlong(pts, 0, 0), P(0, 0));
  });

  test('段内 t=1 → 段终点', () => {
    assert.deepEqual(positionAlong(pts, 0, 1), P(10, 0));
  });

  test('第二段', () => {
    assert.deepEqual(positionAlong(pts, 1, 0.5), P(10, 5));
  });

  test('segment 超出范围 → 钳制到末段', () => {
    assert.deepEqual(positionAlong(pts, 99, 0), P(10, 0));
  });

  test('segment 负数 → 钳制到 0', () => {
    assert.deepEqual(positionAlong(pts, -1, 0), P(0, 0));
  });

  test('t 超出 [0,1] → 钳制', () => {
    assert.deepEqual(positionAlong(pts, 0, 2), P(10, 0));
    assert.deepEqual(positionAlong(pts, 0, -1), P(0, 0));
  });

  test('单点线路 → 返回该点', () => {
    assert.deepEqual(positionAlong([P(5, 5)], 0, 0), P(5, 5));
  });

  test('空线路 → {0,0}', () => {
    assert.deepEqual(positionAlong([], 0, 0), P(0, 0));
  });
});

describe('totalLength', () => {
  test('空 → 0', () => {
    assert.equal(totalLength([]), 0);
  });

  test('单点 → 0', () => {
    assert.equal(totalLength([P(1, 1)]), 0);
  });

  test('两点半长', () => {
    assert.equal(totalLength([P(0, 0), P(3, 4)]), 5);
  });

  test('多段累加', () => {
    // (0,0)→(3,0)→(3,4) = 3+4=7
    assert.equal(totalLength([P(0, 0), P(3, 0), P(3, 4)]), 7);
  });
});

describe('segmentLength', () => {
  const pts = [P(0, 0), P(3, 0), P(3, 4)];

  test('第一段', () => {
    assert.equal(segmentLength(pts, 0), 3);
  });

  test('第二段', () => {
    assert.equal(segmentLength(pts, 1), 4);
  });

  test('越界 → 0', () => {
    assert.equal(segmentLength(pts, -1), 0);
    assert.equal(segmentLength(pts, 99), 0);
  });
});

describe('distToSegment', () => {
  test('点在线段上方', () => {
    const d = distToSegment(P(5, 3), P(0, 0), P(10, 0));
    assert.equal(d, 3);
  });

  test('点在线段延长线外 → 到端点', () => {
    const d = distToSegment(P(-5, 0), P(0, 0), P(10, 0));
    assert.equal(d, 5);
  });

  test('点在线段中点', () => {
    const d = distToSegment(P(5, 0), P(0, 0), P(10, 0));
    assert.equal(d, 0);
  });

  test('零长度线段 → 到退化点', () => {
    const d = distToSegment(P(3, 4), P(0, 0), P(0, 0));
    assert.equal(d, 5);
  });
});

describe('closestPointOnSegment', () => {
  test('投影在线段内', () => {
    assert.deepEqual(closestPointOnSegment(P(5, 3), P(0, 0), P(10, 0)), P(5, 0));
  });

  test('投影在线段外（左侧）→ 端点 a', () => {
    assert.deepEqual(closestPointOnSegment(P(-5, 0), P(0, 0), P(10, 0)), P(0, 0));
  });

  test('投影在线段外（右侧）→ 端点 b', () => {
    assert.deepEqual(closestPointOnSegment(P(15, 0), P(0, 0), P(10, 0)), P(10, 0));
  });

  test('零长度线段 → 退化点', () => {
    assert.deepEqual(closestPointOnSegment(P(5, 5), P(3, 3), P(3, 3)), P(3, 3));
  });
});

describe('nearestSegmentIndex', () => {
  const pts = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];

  test('靠近第一段', () => {
    assert.equal(nearestSegmentIndex(pts, P(5, 1)), 0);
  });

  test('靠近第二段', () => {
    assert.equal(nearestSegmentIndex(pts, P(9, 5)), 1);
  });

  test('靠近第三段', () => {
    assert.equal(nearestSegmentIndex(pts, P(5, 9)), 2);
  });

  test('单段线路 → 0', () => {
    assert.equal(nearestSegmentIndex([P(0, 0), P(10, 0)], P(5, 1)), 0);
  });

  test('空/单点 → -1', () => {
    assert.equal(nearestSegmentIndex([], P(0, 0)), -1);
    assert.equal(nearestSegmentIndex([P(0, 0)], P(0, 0)), -1);
  });
});
