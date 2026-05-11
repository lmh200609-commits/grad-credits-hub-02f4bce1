## 目标

让不同学院的界面"一眼就能区分开"。当前问题是院徽颜色只影响主按钮，整体页面块面仍然是中性灰白。

## 实施方案

### 1. 提取算法升级（`src/lib/extractPalette.ts`）

让取出的颜色更具辨识度：

- **饱和度优先**：候选色排序时不仅按"出现次数"，还乘上饱和度权重，避免暗灰/暗蓝总是赢。
- **拒绝低饱和**：若 top1 颜色饱和度 < 25%，自动回退到候选列表里第一个 ≥ 35% 饱和度的颜色；找不到再退回原值。
- **辅色用互补色**：辅色不再取"第二常见色"，而是基于主色色相 + 偏移（约 30°–180°），保证两个学院主辅色组合差异明显。
- **辅色亮度**：从原来的 94%（几乎白）改为 ~88%，仍是浅色块但能看出色相。
- **背景色**：保持很浅，但带主色微染（亮度 97%、饱和度 30% 左右），不再是纯灰白。
- **新增 `headerTint`/`sidebarTint`**：返回额外的两个 token（主色亮度 30%/45%，用于 header 描边和侧栏强调）。

### 2. 主题应用面扩展（`src/hooks/useCollegeTheme.ts`）

在原有的 `--primary / --accent / --background` 基础上，再写入：

- `--sidebar-background`：用主色低饱和深色调（亮度 ~94% 浅版），让侧栏块面有学院色。
- `--sidebar-foreground / --sidebar-accent-foreground`：保持高对比可读。
- `--header-tint`：header 的主色描边/底纹色。
- `--brand-strong`：饱和主色，用于 banner、tab 高亮。

并保留原有"非法值校验"和退出预览时清理逻辑。

### 3. AppLayout 顶部 Banner（`src/components/AppLayout.tsx`）

把 header 从纯灰白改成带学院色的条带：

- header 背景使用 `bg-[hsl(var(--header-tint))]` 或主色 8% 不透明叠层。
- 学院名/系统标题字色改用主色 deep 版本，权重提升。
- 院徽放大到 h-9，加圆形主色描边（`ring-2 ring-primary/40`）。
- header 底部加一条 2px 的主色细线（`border-b-2 border-primary/30`）。
- 侧栏顶部（导航 label 区域）加一个学院主色小色块 + 学院 short_name/name 缩写徽标。

### 4. 主内容区微调

- `<main>` 的 `bg-muted/30` 改为带主色微染的渐变背景（极淡），让两个学院的整体页面颜色基调就不一样。
- 表格表头、Tab 当前项、链接、focus ring 全部沿用 `--primary`，已经默认生效，不用改。

### 5. 兼容与回退

- 学院未上传院徽：所有变量回退到系统默认（现有行为已支持，不动）。
- 取色失败：回退到原 fallback 调色板。
- 实时同步：依赖现有的 supabase realtime channel，无需改动，新颜色保存后所有用户立即看到。

## 改动文件

- `src/lib/extractPalette.ts`：升级取色算法。
- `src/hooks/useCollegeTheme.ts`：写入更多 CSS 变量。
- `src/components/AppLayout.tsx`：header 与侧栏样式增强。
- `src/index.css`（如需要）：新增 `--header-tint`、`--brand-strong` 默认值。

## 验证

- 给两个不同学院上传不同色调的院徽（例如蓝色 vs 红色），并排打开两个浏览器窗口，确认 header / 侧栏 / 主按钮 / 表头 都能直接区分。
- 上传一张近似纯灰的图片，确认会回退到次优彩色而不是变成灰主题。
- 未上传院徽的学院仍是系统默认外观。