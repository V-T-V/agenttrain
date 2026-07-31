// 新手教程与暂停菜单纯逻辑单测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTORIAL_TOTAL,
  inTutorial,
  nextTutorialStep,
  pauseMenuHitTest,
  pauseMenuLayout,
  shouldShowTutorial,
} from '../src/game/tutorial.ts';

// 内存 localStorage stub
const store = new Map<string, string>();
// @ts-expect-error 注入到 globalThis 供被测模块读取
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

test('inTutorial：step>0 为真', () => {
  assert.equal(inTutorial(0), false);
  assert.equal(inTutorial(1), true);
  assert.equal(inTutorial(4), true);
});

test('nextTutorialStep 逐步前进', () => {
  assert.equal(nextTutorialStep(1), 2);
  assert.equal(nextTutorialStep(2), 3);
  assert.equal(nextTutorialStep(3), 4);
});

test('nextTutorialStep 到最后一步后关闭（返回 0）', () => {
  assert.equal(nextTutorialStep(4), 0);
});

test('nextTutorialStep 从 0 仍为 0', () => {
  assert.equal(nextTutorialStep(0), 0);
});

test('TUTORIAL_TOTAL 是 4', () => {
  assert.equal(TUTORIAL_TOTAL, 4);
});

test('shouldShowTutorial：无标记时为真', () => {
  store.clear();
  assert.equal(shouldShowTutorial(), true);
});

test('shouldShowTutorial：有标记时为假', () => {
  store.clear();
  store.set('agenttrain-tutorial-seen', '1');
  assert.equal(shouldShowTutorial(), false);
});

// ---------- 暂停菜单布局与命中 ----------

test('pauseMenuLayout 返回 5 个按钮', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  assert.equal(items.length, 5);
  assert.deepEqual(
    items.map((i) => i.id),
    ['resume', 'restart', 'difficulty', 'toggle-ai', 'tutorial'],
  );
});

test('pauseMenuLayout 按钮含非空命中矩形', () => {
  const items = pauseMenuLayout(960, 600, 'auto');
  for (const it of items) {
    assert.ok(it.rect.w > 0 && it.rect.h > 0);
    assert.ok(it.rect.x >= 0 && it.rect.y >= 0);
  }
});

test('pauseMenuLayout AI 模式反映在文案', () => {
  const manual = pauseMenuLayout(960, 600, 'manual');
  const auto = pauseMenuLayout(960, 600, 'auto');
  const manualAi = manual.find((i) => i.id === 'toggle-ai')!;
  const autoAi = auto.find((i) => i.id === 'toggle-ai')!;
  assert.ok(manualAi.label.includes('手动'));
  assert.ok(autoAi.label.includes('自动'));
});

test('pauseMenuHitTest 命中按钮中心', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const resume = items.find((i) => i.id === 'resume')!;
  const cx = resume.rect.x + resume.rect.w / 2;
  const cy = resume.rect.y + resume.rect.h / 2;
  assert.equal(pauseMenuHitTest(items, cx, cy), 'resume');
});

test('pauseMenuHitTest 未命中返回 null', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  assert.equal(pauseMenuHitTest(items, 5, 5), null);
  assert.equal(pauseMenuHitTest(items, 960, 600), null);
});

test('pauseMenuHitTest 命中各按钮', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  for (const it of items) {
    const cx = it.rect.x + it.rect.w / 2;
    const cy = it.rect.y + it.rect.h / 2;
    assert.equal(pauseMenuHitTest(items, cx, cy), it.id);
  }
});

test('pauseMenuHitTest 命中矩形边界内', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const r = items[0]!.rect;
  // 左上角
  assert.equal(pauseMenuHitTest(items, r.x, r.y), items[0]!.id);
  // 右下角
  assert.equal(pauseMenuHitTest(items, r.x + r.w, r.y + r.h), items[0]!.id);
  // 紧贴外侧
  assert.equal(pauseMenuHitTest(items, r.x - 1, r.y), null);
});
