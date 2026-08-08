/**
 * R14-D2（agenttrain）：difficulty.ts 难度系统深层测试。
 *
 * 覆盖 paramsFor/isHigher/bumpUp/bumpDown/DIFFICULTY_PARAMS 单调性。
 * loadPreferredDifficulty/savePreferredDifficulty 涉及 localStorage，由 difficulty.test.ts 覆盖。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTY_NAME,
  ALL_DIFFICULTIES,
  DIFFICULTY_PARAMS,
  paramsFor,
  isHigher,
  bumpUp,
  bumpDown,
} from '../src/game/difficulty.ts';
import type { Difficulty } from '../src/game/types.ts';

describe('DIFFICULTY_NAME', () => {
  test('四档各有中文名', () => {
    assert.equal(DIFFICULTY_NAME.easy, '简单');
    assert.equal(DIFFICULTY_NAME.normal, '普通');
    assert.equal(DIFFICULTY_NAME.hard, '困难');
    assert.equal(DIFFICULTY_NAME.expert, '专家');
  });

  test('ALL_DIFFICULTIES 与 DIFFICULTY_NAME 键一致', () => {
    for (const d of ALL_DIFFICULTIES) {
      assert.ok(d in DIFFICULTY_NAME);
    }
  });
});

describe('ALL_DIFFICULTIES', () => {
  test('4 个难度档（由易到难）', () => {
    assert.equal(ALL_DIFFICULTIES.length, 4);
    assert.deepEqual([...ALL_DIFFICULTIES], ['easy', 'normal', 'hard', 'expert']);
  });
});

describe('DIFFICULTY_PARAMS 单调性', () => {
  test('难度越高 → 站点容量越小', () => {
    const caps = ALL_DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].capacity);
    for (let i = 1; i < caps.length; i++) {
      assert.ok(caps[i]! <= caps[i - 1]!, `${ALL_DIFFICULTIES[i]} 容量应 ≤ ${ALL_DIFFICULTIES[i - 1]}`);
    }
  });

  test('难度越高 → overloadGrace 越短', () => {
    const graces = ALL_DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].overloadGrace);
    for (let i = 1; i < graces.length; i++) {
      assert.ok(graces[i]! <= graces[i - 1]!);
    }
  });

  test('难度越高 → 乘客生成越快（interval 越小）', () => {
    const intervals = ALL_DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].passengerInterval);
    for (let i = 1; i < intervals.length; i++) {
      assert.ok(intervals[i]! <= intervals[i - 1]!);
    }
  });

  test('难度越高 → 列车越慢（speed 越小）', () => {
    const speeds = ALL_DIFFICULTIES.map((d) => DIFFICULTY_PARAMS[d].trainSpeed);
    for (let i = 1; i < speeds.length; i++) {
      assert.ok(speeds[i]! <= speeds[i - 1]!);
    }
  });

  test('所有参数为正数', () => {
    for (const d of ALL_DIFFICULTIES) {
      const p = DIFFICULTY_PARAMS[d];
      assert.ok(p.capacity > 0);
      assert.ok(p.overloadGrace > 0);
      assert.ok(p.passengerInterval > 0);
      assert.ok(p.trainSpeed > 0);
    }
  });
});

describe('paramsFor', () => {
  test('返回对应档参数', () => {
    assert.equal(paramsFor('easy').capacity, 8);
    assert.equal(paramsFor('expert').capacity, 4);
  });

  test('返回值与 DIFFICULTY_PARAMS 一致', () => {
    for (const d of ALL_DIFFICULTIES) {
      assert.deepEqual(paramsFor(d), DIFFICULTY_PARAMS[d]);
    }
  });
});

describe('isHigher', () => {
  test('easy < normal < hard < expert', () => {
    assert.ok(!isHigher('easy', 'normal'));
    assert.ok(isHigher('normal', 'easy'));
    assert.ok(isHigher('expert', 'easy'));
    assert.ok(!isHigher('easy', 'expert'));
  });

  test('同级 → false', () => {
    for (const d of ALL_DIFFICULTIES) {
      assert.ok(!isHigher(d, d));
    }
  });
});

describe('bumpUp', () => {
  test('easy → normal → hard → expert', () => {
    assert.equal(bumpUp('easy'), 'normal');
    assert.equal(bumpUp('normal'), 'hard');
    assert.equal(bumpUp('hard'), 'expert');
  });

  test('expert（最高）→ 不变', () => {
    assert.equal(bumpUp('expert'), 'expert');
  });

  test('连续 bump 最多到 expert', () => {
    let d: Difficulty = 'easy';
    for (let i = 0; i < 10; i++) d = bumpUp(d);
    assert.equal(d, 'expert');
  });
});

describe('bumpDown', () => {
  test('expert → hard → normal → easy', () => {
    assert.equal(bumpDown('expert'), 'hard');
    assert.equal(bumpDown('hard'), 'normal');
    assert.equal(bumpDown('normal'), 'easy');
  });

  test('easy（最低）→ 不变', () => {
    assert.equal(bumpDown('easy'), 'easy');
  });

  test('连续 bump 最多到 easy', () => {
    let d: Difficulty = 'expert';
    for (let i = 0; i < 10; i++) d = bumpDown(d);
    assert.equal(d, 'easy');
  });
});

describe('bumpUp/bumpDown 互逆', () => {
  test('bumpUp 后 bumpDown 回到原档（非边界）', () => {
    assert.equal(bumpDown(bumpUp('easy')), 'easy');
    assert.equal(bumpDown(bumpUp('normal')), 'normal');
    assert.equal(bumpDown(bumpUp('hard')), 'hard');
  });

  test('bumpDown 后 bumpUp 回到原档（非边界）', () => {
    assert.equal(bumpUp(bumpDown('normal')), 'normal');
    assert.equal(bumpUp(bumpDown('hard')), 'hard');
    assert.equal(bumpUp(bumpDown('expert')), 'expert');
  });
});
