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

- **游戏核心**（src/game/）：simulation / state / types / config / events / geometry / powerups
- **AI 层**（src/ai/）：advisor（顾问）/ autopilot（自动驾驶）/ client / scenario / tools / types
- **AI 后端**（server/）：index.ts + env.ts + retry.ts，autopilot 推理服务
- **渲染/输入**（src/）：main.ts / render.ts / input.ts
- **测试 17 个文件 / 190 个用例**：simulation / events / geometry / powerups / rng / scenario / advisor / persist / camera / difficulty / highscore / tutorial / specials / world / server / render-smoke / achievements

`simulation.ts` 确认：line 46 `export function step(state, dt, rng): GameState`——纯函数式状态步进，不 import DOM。

## 技术栈与架构

- **语言**：TypeScript，ESM，Node ≥ 20.19
- **依赖**：**无运行时 dependencies**（devDeps：vite / concurrently / eslint / tsx / typescript 等）
- **架构**：游戏层（src/game）+ AI 层（src/ai）+ 渲染输入（src）+ AI 后端（server）

```
src/
├── main.ts, input.ts, render.ts, style.css
├── ai/         advisor.ts, autopilot.ts, client.ts, scenario.ts, tools.ts, types.ts
├── game/       simulation.ts, state.ts, types.ts, config.ts, events.ts, geometry.ts, powerups.ts
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
npm test             # 190 个测试用例
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

## 备注

根目录有一个 0 字节的 `nul` 文件（Windows 误用保留名 `nul` 作输出重定向在 Git Bash 里产生的异常文件），非源码，可考虑清理。
