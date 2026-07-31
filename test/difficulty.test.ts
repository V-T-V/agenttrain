// 难度档单测：倍率表差异化、升降档、偏好持久化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_DIFFICULTIES,
  bumpDown,
  bumpUp,
  DIFFICULTY_PARAMS,
  isHigher,
  paramsFor,
} from '../src/game/difficulty.ts';

test('三档参数容量递减', () => {
  assert.ok(DIFFICULTY_PARAMS.easy.capacity > DIFFICULTY_PARAMS.normal.capacity);
  assert.ok(DIFFICULTY_PARAMS.normal.capacity > DIFFICULTY_PARAMS.hard.capacity);
});

test('三档宽限时间递减', () => {
  assert.ok(DIFFICULTY_PARAMS.easy.overloadGrace > DIFFICULTY_PARAMS.hard.overloadGrace);
});

test('三档速度递减（困难最慢）', () => {
  assert.ok(DIFFICULTY_PARAMS.easy.trainSpeed > DIFFICULTY_PARAMS.hard.trainSpeed);
});

test('普通档参数 = config 基准', () => {
  assert.equal(DIFFICULTY_PARAMS.normal.capacity, 6);
  assert.equal(DIFFICULTY_PARAMS.normal.trainSpeed, 0.45);
});

test('paramsFor 返回对应档参数', () => {
  assert.equal(paramsFor('hard').capacity, 5);
  assert.equal(paramsFor('easy').overloadGrace, 9);
});

test('isHigher 比较档位', () => {
  assert.equal(isHigher('hard', 'easy'), true);
  assert.equal(isHigher('easy', 'hard'), false);
  assert.equal(isHigher('normal', 'normal'), false);
});

test('bumpUp 升到顶不再升', () => {
  assert.equal(bumpUp('easy'), 'normal');
  assert.equal(bumpUp('normal'), 'hard');
  assert.equal(bumpUp('hard'), 'hard');
});

test('bumpDown 降到底不再降', () => {
  assert.equal(bumpDown('hard'), 'normal');
  assert.equal(bumpDown('normal'), 'easy');
  assert.equal(bumpDown('easy'), 'easy');
});

test('ALL_DIFFICULTIES 顺序为 easy→normal→hard', () => {
  assert.deepEqual([...ALL_DIFFICULTIES], ['easy', 'normal', 'hard']);
});
