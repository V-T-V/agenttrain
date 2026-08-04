# agenttrain · AGENTS.md

> 注：package.json 名为 `agent-train`（带连字符），目录名为 `agenttrain`。

## 项目内容（What）

Mini Metro 风的**火车调度小游戏**。画线连接站点，让列车把形状各异的乘客送到对应终点站，别让站点堵爆。用 TypeScript + HTML5 Canvas + Vite 实现，**且带 AI 顾问/自动驾驶层**（README 未充分体现）。

不做：不做 3D、不做真实地图、不做多人。

## 目标（Goal）

- 完整还原 Mini Metro 核心玩法（画线/延伸/删除、过载判负、难度递增、稀有站点解锁）。
- **逻辑/渲染分离**：`simulation.ts` 是纯函数式状态步进，不碰 DOM，可单测。
- 固定步长主循环（累加器模式），保证高/低刷新率屏幕速度一致。
- 可复现随机（mulberry32 带种子）。
- 提供 AI 顾问：能给调度建议、可自动驾驶。

## 当前情况（Status）

**较完整的可玩原型。** 游戏核心 + AI 层都落地。

- **游戏核心**（src/game/，18 个文件）：simulation / state / types / config / events / eventRegistry / geometry / powerups / powerupRegistry / difficulty / highscore / achievements / stats / shapes / camera / audio / persist / tutorial
- **AI 层**（src/ai/）：advisor（顾问）/ autopilot（自动驾驶）/ client / scenario / tools / types
- **AI 后端**（server/）：index.ts + env.ts + retry.ts，autopilot 推理服务
- **渲染/输入**（src/）：main.ts / render.ts / input.ts
- **测试 33 个文件 / 563 个用例**（全绿）：simulation(+overload+boarding+edge+train-motion+helpers) / events(+deep+sequence) / geometry / powerups(+deep+effects) / rng / scenario / advisor / ai-advisor-autopilot-edge / persist / camera / difficulty / highscore / tutorial / specials / world / server(+http) / render-smoke / achievements / stats / registry / congestion / error-hardening / lineStrategy / simulation-train-motion

### 深度推进记录（deep-r1 ~ deep-r8）
- **r1**: 基线确认 461 用例 + 读 AGENTS.md
- **r2**: simulation 乘客上车/可达性/容量 11 用例
- **r3**: simulation 公共辅助 + 成就精确边界 23 用例
- **r4**: simulation 公共辅助 + 成就边界 23 用例
- **r5**: 道具效果端到端 + 计分倍率叠加 13 用例
- **r6**: 修 AI 顾问 modeTarget 建议 + 4 用例 + type-check 清理
- **r7**: 新增 minimalist/sprawl 网络结构型成就 + 10 用例
- **r8**: server/index.ts 条件 listen（可 import 不阻塞）+ readBody/sendJson 9 用例 + error-hardening 275 行加固测试

`simulation.ts` 确认：line 47 `export function step(state, dt, rng): GameState`——纯函数式状态步进，不 import DOM。

### 模块完成度

| 模块 | 状态 | 测试 |
| ---- | ---- | ---- |
| simulation（核心步进/装卸/过载/线路结构） | ✅ 完成 | simulation + simulation-overload（精确帧数/多站/恢复） |
| powerups（6 道具 + 连击） | ✅ 完成 | powerups + powerups-deep（时长/刷新/冲突） |
| events（剧本调度） | ✅ 完成（已修 pumpEvents 漏触发 bug） | events + events-deep（同时刻/surge 翻倍/形状解锁） |
| difficulty（四档） | ✅ 完成（新增 Expert） | difficulty（四档差异化） |
| achievements（22 个） | ✅ 完成（新增 expert 成就） | achievements（边界 + 注册表完整性） |
| stats（本局统计） | ✅ 完成（新增模块） | stats（效率/完成度/格式化） |
| highscore（按档最高分） | ✅ 完成（四档 + 向后兼容） | highscore |
| AI 层（advisor/autopilot/scenario） | ✅ 完成 | advisor + ai-advisor-autopilot-edge + scenario + server |
| 渲染/输入 | ✅ 完成 | render-smoke |
| persist / camera / tutorial / audio | ✅ 完成 | persist / camera / tutorial |

## 技术栈与架构

- **语言**：TypeScript，ESM，Node ≥ 20.19
- **依赖**：**无运行时 dependencies**（devDeps：vite / concurrently / eslint / tsx / typescript 等）
- **架构**：游戏层（src/game）+ AI 层（src/ai）+ 渲染输入（src）+ AI 后端（server）

```
src/
├── main.ts, input.ts, render.ts, style.css
├── ai/         advisor.ts, autopilot.ts, client.ts, scenario.ts, tools.ts, types.ts
├── game/       simulation.ts, state.ts, types.ts, config.ts, events.ts, eventRegistry.ts,
│               geometry.ts, powerups.ts, powerupRegistry.ts, difficulty.ts, highscore.ts,
│               achievements.ts, stats.ts, shapes.ts, camera.ts, audio.ts, persist.ts, tutorial.ts
└── utils/rng.ts
server/
├── index.ts, env.ts, retry.ts    # AI autopilot 后端
```

## 如何运行

```bash
npm install
npm run dev          # 仅 vite（游戏前端）
npm run dev:all      # concurrently：vite + server（启用 AI 顾问/自动驾驶）
npm run server       # 仅 AI 后端
npm run build        # 生产构建
npm test             # 316 个测试用例
npm run type-check / lint / format
```

## 关键约定

- **simulation.ts 纯函数式**：不 import DOM、不直接操作渲染。状态步进是 `step(state, dt, rng) → newState`，保证可测与确定性。
- 渲染层（render.ts）只读 state，不改状态。
- 随机用 mulberry32 带种子，保证测试可复现。
- 固定步长（FIXED_STEP）累加器模式：逻辑与帧率解耦。
- server/ 是 AI 顾问的后端，前端通过 src/ai/client.ts 调用。

## 与其他项目的关系

独立项目。属游戏系。虽然名为 "agent-train"，AI 顾问是其特色，但不依赖工作区其他 Agent 项目（agentloop/agentresearch）的代码。

## 已知修复（近期）

- **events.pumpEvents 连续触发漏事件**：splice 后误 `i++`，导致多个事件按序到点时每隔一个被跳过。已修（splice 后不递增 i）。
- **surge 事件从不触发额外乘客**：simulation 调 `isEventActive('surge')` 未传 shape，而 surge 的 isActive 需要 shape 才返回 true。已改为直接检查 active 列表是否存在 surge。

## 深度推进测试缺口分析（D1 基线）

基线 `npm test`：461/461 全绿。基于 src/ 源码扫描，识别出以下**纯函数核心尚未被精细覆盖**的子域（确定性 + 边界）：

- **列车运动**（simulation.ts 内部 `advanceTrain`/`arriveAtStation`）：换向、停留计时 `dwellTimer` 累积、大 dt 单帧多次到站、退化段（同坐标站）、方向交替往返的确定性位置序列。现有 simulation.test 只断言「最终 delivered>0」，未逐帧验证位置。
- **乘客路径与上车决策**（内部 `reachableShapeSet`/`exchangePassengers`）：transfer 站忽略可达、magnet 忽略可达、TRAIN_CAPACITY(6) 满载边界、目标形状不在可达集则拒上车、bonus 站 ×2、连击 × 双倍 × 奖励三重叠加。
- **simulation 公共辅助**：`stationIndex` Map 一致性、`linePoints` 在 ≤4 站与 >4 站两个分支、`trainPosition` 退化线路、`lineEndpoints` 空线路、`pickColor` 7 色用尽后复用首色、`LINE_COLOR_ORDER` 顺序。
- **连击/倍率数学**（powerups.ts）：`comboMultiplier` 精确阶梯（COMBO_STEP=5/COMBO_MULTIPLIER_STEP=0.5）、`scoreMultiplier` = 连击 × 双倍、连击窗口超时归零、`maxCombo` 单调上升。
- **成就触发**（achievements.ts `checkAchievements`）：幂等（同条件不重复解锁）、`speedrun` ≤180s 严格边界、`no-power-clear` 不用道具、`line-master` ≥10 线、四档通关互不串扰、`all-difficulty` 需四难度全通。

D2-D5 将按上述五个子域逐项补 8-12 用例的确定性测试。

## 下一步（Next Steps）

- **平衡性**：专家档（capacity 4 / grace 3s）与稀有形状解锁节奏需实机调参。
- **更多成就**：可加「单线运 200 人」「全程无满载」「全站点解锁」等长线目标成就。
- **AI 顾问**：把 stats 模块的效率/最长线路喂给 advisor，让建议更数据驱动。
- **存档兼容**：难度/成就键名带版本号（`-v1`），未来调参需考虑迁移。
- **可视化**：GameOver 面板可展示最长线路长度、完成度进度条等更多 stats 字段。

## 备注

根目录有一个 0 字节的 `nul` 文件（Windows 误用保留名 `nul` 作输出重定向在 Git Bash 里产生的异常文件），非源码，可考虑清理。
