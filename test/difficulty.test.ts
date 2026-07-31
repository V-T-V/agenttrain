// 难度档单测：四档差异化参数、升降档、偏好持久化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_DIFFICULTIES,
  bumpDown,
  bumpUp,
  DIFFICULTY_NAME,
  DIFFICULTY_PARAMS,
  isHigher,
  paramsFor,
} from '../src/game/difficulty.ts';

test('四档参数容量递减', () => {
  assert.ok(DIFFICULTY_PARAMS.easy.capacity > DIFFICULTY_PARAMS.normal.capacity);
  assert.ok(DIFFICULTY_PARAMS.normal.capacity > DIFFICULTY_PARAMS.hard.capacity);
  assert.ok(DIFFICULTY_PARAMS.hard.capacity > DIFFICULTY_PARAMS.expert.capacity);
});

test('四档宽限时间递减', () => {
  assert.ok(DIFFICULTY_PARAMS.easy.overloadGrace > DIFFICULTY_PARAMS.normal.overloadGrace);
  assert.ok(DIFFICULTY_PARAMS.normal.overloadGrace > DIFFICULTY_PARAMS.hard.overloadGrace);
  assert.ok(DIFFICULTY_PARAMS.hard.overloadGrace > DIFFICULTY_PARAMS.expert.overloadGrace);
});

test('四档速度递减（专家最慢）', () => {
  assert.ok(DIFFICULTY_PARAMS.easy.trainSpeed > DIFFICULTY_PARAMS.hard.trainSpeed);
  assert.ok(DIFFICULTY_PARAMS.hard.trainSpeed > DIFFICULTY_PARAMS.expert.trainSpeed);
});

test('专家档乘客生成最快', () => {
  assert.ok(DIFFICULTY_PARAMS.hard.passengerInterval > DIFFICULTY_PARAMS.expert.passengerInterval);
});

test('普通档参数 = config 基准', () => {
  assert.equal(DIFFICULTY_PARAMS.normal.capacity, 6);
  assert.equal(DIFFICULTY_PARAMS.normal.trainSpeed, 0.45);
});

test('paramsFor 返回对应档参数', () => {
  assert.equal(paramsFor('hard').capacity, 5);
  assert.equal(paramsFor('easy').overloadGrace, 9);
  assert.equal(paramsFor('expert').capacity, 4);
  assert.equal(paramsFor('expert').overloadGrace, 3);
  assert.equal(paramsFor('expert').passengerInterval, 3.2);
});

test('isHigher 比较档位', () => {
  assert.equal(isHigher('hard', 'easy'), true);
  assert.equal(isHigher('expert', 'hard'), true);
  assert.equal(isHigher('easy', 'hard'), false);
  assert.equal(isHigher('hard', 'expert'), false);
  assert.equal(isHigher('normal', 'normal'), false);
  assert.equal(isHigher('expert', 'easy'), true);
});

test('bumpUp 升到顶不再升', () => {
  assert.equal(bumpUp('easy'), 'normal');
  assert.equal(bumpUp('normal'), 'hard');
  assert.equal(bumpUp('hard'), 'expert');
  assert.equal(bumpUp('expert'), 'expert');
});

test('bumpDown 降到底不再降', () => {
  assert.equal(bumpDown('expert'), 'hard');
  assert.equal(bumpDown('hard'), 'normal');
  assert.equal(bumpDown('normal'), 'easy');
  assert.equal(bumpDown('easy'), 'easy');
});

test('ALL_DIFFICULTIES 顺序为 easy→normal→hard→expert', () => {
  assert.deepEqual([...ALL_DIFFICULTIES], ['easy', 'normal', 'hard', 'expert']);
  assert.equal(ALL_DIFFICULTIES.length, 4);
});

test('DIFFICULTY_NAME 四档中文名齐全', () => {
  assert.equal(DIFFICULTY_NAME.easy, '简单');
  assert.equal(DIFFICULTY_NAME.normal, '普通');
  assert.equal(DIFFICULTY_NAME.hard, '困难');
  assert.equal(DIFFICULTY_NAME.expert, '专家');
  // 每档都有名字
  for (const d of ALL_DIFFICULTIES) {
    assert.ok(DIFFICULTY_NAME[d].length > 0);
  }
});

test('专家档是全局最难（所有维度都不优于困难）', () => {
  const e = DIFFICULTY_PARAMS.expert;
  const h = DIFFICULTY_PARAMS.hard;
  assert.ok(e.capacity <= h.capacity, '专家容量 ≤ 困难');
  assert.ok(e.overloadGrace <= h.overloadGrace, '专家宽限 ≤ 困难');
  assert.ok(e.passengerInterval <= h.passengerInterval, '专家乘客间隔 ≤ 困难');
  assert.ok(e.trainSpeed <= h.trainSpeed, '专家速度 ≤ 困难');
});
