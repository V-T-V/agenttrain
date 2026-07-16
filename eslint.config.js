// ESLint 9 flat config —— 适用于浏览器端 TypeScript + Vite 项目（Canvas 小游戏）。
// 仅启用类型无关的推荐规则，避免引入 typescript-eslint 的类型检查开销（交给 tsc）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // 忽略目录
  {
    ignores: ['node_modules/', 'dist/', '.git/', '*.log'],
  },
  // JS/TS 基础推荐规则
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 关闭与 Prettier 冲突的格式化规则
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // 浏览器全局变量（Canvas / DOM / 游戏循环）
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        addEventListener: 'readonly',
        removeEventListener: 'readonly',
      },
    },
    rules: {
      // 项目偏好：允许未使用函数参数（回调签名常见）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // 游戏状态 / DOM 事件对象结构多变，允许 any
      '@typescript-eslint/no-explicit-any': 'off',
      // 控制台输出用于调试
      'no-console': 'off',
    },
  },
);
