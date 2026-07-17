# agenttrain 深度优化记录

> 日期：2026-07-17
> 基于对 23 个开源游戏样本的源码研究（见 `../web-game-research/`），针对 agenttrain 的基线审计实施的 4 项优化。
> 全部遵循现有架构（固定步长 + 纯函数 step + 只读 render），零新依赖，零回归。

## 实施的优化

### P0-① 渲染插值（解决高刷新率屏列车抖动）
**借鉴**：OpenFrontIO 的 alpha 插值模式。

**问题**：`frame()` 的 accumulator 只用于决定跑几次 step，渲染用离散 `trainPosition`。120/144Hz 屏 step 每 ~2-3 帧才推进一次，列车阶梯式抖动。

**改动**：
- `src/game/geometry.ts`：新增 `lerpVec2(a, b, t)` 纯函数（带 [0,1] 夹紧）
- `src/render.ts`：`RenderOptions` 加 `alpha?: number`；`drawTrains` 用模块级 `prevTrainPositions` 缓存上一帧位置，当前帧 `lerp(prev, curr, alpha)` 绘制；停靠中（dwellTimer>0）不插值；清理已移除列车的陈旧缓存
- `src/main.ts`：`frame()` 算 `alpha = accumulator / FIXED_STEP` 传入 render

### P0-② 存档系统（刷新续局）
**借鉴**：kids-games 的 `storage.ts`（单 key + 版本号 + 全程 try-catch 容错）。

**问题**：grep localStorage 零命中，刷新即丢全部进度。

**改动**：
- `src/utils/rng.ts`：新增 `getState():number` + 静态 `Rng.fromState(state)`——序列化/恢复 Rng 内部状态，保证续局后随机序列连贯
- `src/game/persist.ts`（**新建**）：`saveGame(state, rngState)` / `loadGame()` / `clearSave()`。key=`agenttrain-save-v1`，信封 `{version, state, rngState, savedAt}`。全程 try-catch 容错（隐私模式/容量满/损坏 JSON/版本不匹配/字段缺失均降级为 null，不抛错）。非浏览器环境（node:test/SSR）自动降级为无操作
- `src/main.ts`：启动时 `loadGame()` 恢复（含 Rng）；running 阶段每 5s debounce 保存；restart/gameover 时 clearSave

### P1-③ 触屏支持（移动端可玩）
**借鉴**：kids-games 的 `bindPointer`（优先 PointerEvent，回退 mouse+touch）。

**问题**：仅 MouseEvent，CSS 已有 `touch-action:none` 但无对应 JS，移动端不可玩。

**改动**：
- `src/input.ts`：新增 `bindPointer(target, handlers)` 统一指针抽象——优先 PointerEvent，回退 mouse+touch（touch 加 `preventDefault` 防页面滚动，`{passive:false}`）。返回解绑函数
- `src/main.ts`：mousedown/move/up 替换为 bindPointer；`toWorld` 签名从 `MouseEvent` 放宽为 `{clientX, clientY}`（兼容 Mouse/Touch/Pointer）。dblclick/contextmenu 保留（桌面专属）

### P1-④ HiDPI 清晰渲染
**问题**：`canvas.width=WORLD_WIDTH` 硬设 960，Retina 屏糊。

**改动**：
- `src/main.ts`：`dpr=devicePixelRatio||1`；backing store 按 dpr 放大；`ctx.scale(dpr,dpr)`。render 全部继续用逻辑坐标 960×600，无需改动

## 验证结果
- `npm run type-check`：✅ 零错误
- `npm test`：✅ **84 测试全绿**（含新增 lerpVec2 ×2、persist ×7）
- `npm run lint`：✅ 零错误零警告
- `npm run format:check`：✅ 全部符合 Prettier

## 触达文件
| 文件 | 改动类型 |
|------|---------|
| `src/game/geometry.ts` | +lerpVec2 |
| `src/game/persist.ts` | **新建** |
| `src/utils/rng.ts` | +getState +fromState |
| `src/render.ts` | RenderOptions+alpha；drawTrains 插值 |
| `src/input.ts` | +bindPointer 统一抽象 |
| `src/main.ts` | alpha/renderOpts；存档装载/保存/clear；bindPointer；HiDPI |
| `test/geometry.test.ts` | +lerpVec2 测试 |
| `test/persist.test.ts` | **新建** |

## 未做的（后续待办，P2/P3）

基线审计发现但本次未实施的项（按优先级）：

- ~~**P2 修复 Math.random 泄漏**~~ → **已完成**（simulation.ts pickColor 改确定性顺序首位；main.ts generateScenario 传 `() => rng.next()`）
- ~~**P2 station id→Station Map 索引**~~ → **已完成**（新增 `stationIndex(state)` 导出，linePoints 站点>4 时用 Map 查找）
- **P2 extendLine 头部插入未调 t**（simulation.ts:348-353）：新段长度不同时列车视觉跳变
- **P3 ResizeObserver 自适应**：当前固定 960×600，无响应式

这些不影响当前功能与体验，留待后续迭代。
