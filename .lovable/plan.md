## 问题
工作助手悬浮面板有时整块"透明"，文字与下层表格重叠看不清。

## 根因分析
1. **面板背景不够稳健**：`StaffAiAssistant.tsx` 第 119 行使用 `bg-background`。该变量被 `useCollegeTheme` 在登录后通过 `document.documentElement.style.setProperty("--background", ...)` 动态覆盖，如果某个学院主题里写了带 alpha 或浅色低对比的 HSL，整个面板就会"看不见"。
2. **缺少独立堆叠上下文**：面板没有 `isolate`，如果父级里有 `mix-blend-*` 或半透明遮罩（登录页背景动画、AI 评估卡片等）会污染它。
3. **header 渐变失效**：第 120 行用 `to-primary-glow`，但 `tailwind.config.ts` 的 `colors` 里没有定义 `primary-glow`，这个类不生成 CSS，渐变退化为 `primary → transparent`，所以顶栏色条也会"消失"。

## 改动计划

### 1. `src/components/StaffAiAssistant.tsx`
- 面板根 `<div>`：把 `bg-background` 换成 **`bg-card`** 并新增 `isolate`，再加一层兜底内联色 `style={{ backgroundColor: "hsl(var(--card))" }}`，确保不论主题如何覆盖 `--background` 都不会透明。
- 顶栏 header：把 `bg-gradient-to-r from-primary to-primary-glow` 换成已注册的 token 写法 `style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary-glow)))" }}`，避免依赖未注册的 Tailwind 颜色。

### 2. `tailwind.config.ts`
- 在 `colors` 里补充 `"primary-glow": "hsl(var(--primary-glow))"`，让其它使用 `from-primary-glow / to-primary-glow / bg-primary-glow` 的地方也能正常渲染（顺手修，不破坏现有）。

### 3. 防止重复渲染
- 全项目搜索 `<StaffAiAssistant`，确认只在 `AppLayout` 渲染一次；若存在多处再清理。

## 不改动
- 助手的逻辑、消息存储、调用 edge function 全部保持不变。
- 不动登录页背景与其他页面样式。

## 验收
- 切换不同学院/主题进入 `/admin/credits` 打开工作助手，面板背景始终为不透明卡片色。
- 顶部标题栏显示完整的主色 → 主色亮色 渐变。
- 面板与下层表格不再透视重叠。
