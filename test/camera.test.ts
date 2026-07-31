// 摄像机（缩放/平移）单测 —— zoom 为像素缩放因子，与 ctx.scale 一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCamera,
  pan,
  screenToWorld,
  viewHeight,
  viewWidth,
  zoomAt,
} from '../src/game/camera.ts';
import { WORLD_WIDTH } from '../src/game/config.ts';

// 显示窗口尺寸（模拟 canvas CSS 尺寸；宽高比与世界一致 3840:1200=3.2）
const DW = 1280;
const DH = 400;

test('createCamera：fit 到屏幕，看到整个世界', () => {
  const c = createCamera(DW, DH);
  // fit zoom = min(DW/WORLD_W, DH/WORLD_H) = min(1280/3840, 400/1200) = min(0.333,0.333)=0.333
  assert.ok(c.zoom <= 0.34 && c.zoom >= 0.32, `zoom=${c.zoom}`);
  // 视口看到的世界宽 = DW/zoom ≈ 3840
  assert.ok(Math.abs(viewWidth(c, DW) - WORLD_WIDTH) < 1);
});

test('viewWidth：zoom=2 时视口看到半个显示宽的世界', () => {
  const c = { x: 0, y: 0, zoom: 2 };
  assert.equal(viewWidth(c, DW), DW / 2); // 640 世界单位
});

test('viewHeight：zoom=2', () => {
  const c = { x: 0, y: 0, zoom: 2 };
  assert.equal(viewHeight(c, DH), DH / 2);
});

test('screenToWorld：zoom=1 时屏幕坐标=世界坐标偏移', () => {
  const c = { x: 100, y: 50, zoom: 1 };
  const w = screenToWorld(c, 10, 20, DW, DH);
  assert.deepEqual(w, { x: 110, y: 70 }); // 10+100, 20+50
});

test('screenToWorld：zoom=2 时屏幕坐标除以 zoom', () => {
  const c = { x: 0, y: 0, zoom: 2 };
  const w = screenToWorld(c, 100, 60, DW, DH);
  assert.equal(w.x, 50); // 100/2
  assert.equal(w.y, 30); // 60/2
});

test('zoomAt：以锚点为中心放大，锚点世界位置不动', () => {
  const c = createCamera(DW, DH);
  const ax = DW / 2;
  const ay = DH / 2;
  const before = screenToWorld(c, ax, ay, DW, DH);
  const c2 = zoomAt(c, ax, ay, DW, DH, 2);
  const after = screenToWorld(c2, ax, ay, DW, DH);
  assert.ok(Math.abs(before.x - after.x) < 1, `x 漂移 ${Math.abs(before.x - after.x)}`);
  assert.ok(Math.abs(before.y - after.y) < 1, `y 漂移 ${Math.abs(before.y - after.y)}`);
});

test('zoomAt：放大后 zoom 增加', () => {
  const c = createCamera(DW, DH);
  const c2 = zoomAt(c, DW / 2, DH / 2, DW, DH, 2);
  assert.ok(c2.zoom > c.zoom);
});

test('zoomAt：不超过 MAX_ZOOM(6)', () => {
  let c = createCamera(DW, DH);
  for (let i = 0; i < 40; i++) c = zoomAt(c, DW / 2, DH / 2, DW, DH, 2);
  assert.ok(c.zoom <= 6, `zoom=${c.zoom} 超过上限`);
});

test('zoomAt：不低于 MIN_ZOOM(0.25)', () => {
  let c = createCamera(DW, DH);
  for (let i = 0; i < 40; i++) c = zoomAt(c, DW / 2, DH / 2, DW, DH, 0.5);
  assert.ok(c.zoom >= 0.25, `zoom=${c.zoom} 低于下限`);
});

test('pan：向右拖(dx>0)→摄像机左移(cam.x 减小)，地图向右滑（抓地图直觉）', () => {
  const c = zoomAt(createCamera(DW, DH), DW / 2, DH / 2, DW, DH, 3); // 放大让视口<世界
  const c2 = pan(c, 100, 0, DW, DH);
  assert.ok(c2.x < c.x, '向右拖应减小 cam.x');
});

test('pan：不让摄像机越出世界边界', () => {
  const c = zoomAt(createCamera(DW, DH), DW / 2, DH / 2, DW, DH, 3);
  const c3 = pan(c, -100000, 0, DW, DH);
  assert.ok(c3.x >= 0, `x=${c3.x} < 0 越界`);
  assert.ok(c3.x <= WORLD_WIDTH, `x=${c3.x} > ${WORLD_WIDTH} 越界`);
});

test('【集成】screenToWorld 与 render 变换一致：屏幕→世界→屏幕 往返恒等', () => {
  // render 用 ctx.scale(zoom).translate(-cam)：world = screen/zoom + cam
  // screenToWorld 应严格满足其逆运算
  const c = { x: 500, y: 200, zoom: 1.7 };
  const sx = 333;
  const sy = 187;
  const world = screenToWorld(c, sx, sy, DW, DH);
  // 逆变换：screen' = (world - cam) * zoom，应等于原 sx/sy
  const screenBack = (world.x - c.x) * c.zoom;
  const screenBackY = (world.y - c.y) * c.zoom;
  assert.ok(Math.abs(screenBack - sx) < 1e-6);
  assert.ok(Math.abs(screenBackY - sy) < 1e-6);
});
