

# 学分认证系统 — 工作台 & 设计体系重构

围绕「数据感、流程感、操作效率」对学生/教师/管理员三种工作台进行统一重构，并落地一套可复用的 B 端设计令牌。

## 1. 设计体系（基础层，所有页面受益）

**色彩令牌（src/index.css，HSL）**
- `--primary`: 222 76% 38%（深靛蓝，科技感主色）+ `--primary-glow` 渐变副值
- 状态语义色（新增）：`--success` 152 60% 40%、`--warning` 32 95% 50%、`--danger` 0 78% 56%、`--info` 210 90% 50%；并配 `*/15` 软底变体用于 Badge
- `--background`: 220 20% 98%（浅灰冷调，去纯白刺眼）、`--surface`: 0 0% 100%（卡片）
- `--sidebar-active`: 主色 + 左侧 3px 色条
- 暗色模式同步更新

**Tailwind 扩展（tailwind.config.ts）**
- `colors.success / warning / danger / info`（含 `.foreground` 与 `.soft`）
- `boxShadow.card`（轻）、`boxShadow.cardHover`（提升）
- `backgroundImage.gradient-primary`、`gradient-surface`
- `keyframes`：`fade-in-up`、`pulse-soft`；`animation` 同步注册

**通用组件（新增）**
- `src/components/StatCard.tsx`：图标 + 数值 + 标签 + 趋势/小字描述，支持 `tone: primary|success|warning|danger`，hover `-translate-y-0.5 shadow-cardHover`
- `src/components/ProcessSteps.tsx`：横向步骤条（提交→AI 审核→教师复核→结果），支持 `currentStep` 与 `skipReview`
- `src/components/PageHeader.tsx`：标题 + 副标题 + 右侧 actions 槽位
- `StatusBadge.tsx`：改用新语义色 token（绿/黄/红/灰）

## 2. 学生工作台（src/pages/Index.tsx，学生分支）

**布局**
```text
┌──────────── PageHeader（问候 + 「申请学分」主按钮）────────────┐
├── StatCard × 4：已提交 / 审核中 / 已通过 / 已拒绝 ─────────────┤
├── ProcessSteps（当前进度高亮，根据最近一条申请推断）─────────────┤
├──────── 60% 快捷操作 ────────┬──── 40% 最近申请 ────┐
│ 申请学分（主按钮卡，渐变）   │ 表格：项目/状态Badge/  │
│ 我的申请                     │ 时间/查看              │
│ 上传材料 (跳转 /apply)       │ 空态 → 引导按钮        │
└──────────────────────────────┴────────────────────────┘
```
- 数据：聚合查询 `applications` 按 `status` 分组计数（取代当前 mine 单值）
- 最近申请：`limit(5)` 按 `submitted_at desc`，复用 StatusBadge
- Loading：StatCard 骨架；空态用 `EmptyState` 提示「立即提交第一份申请」

## 3. 教师 & 管理员工作台

**教师工作台**（同 Index 路由，按角色切换）
- StatCard：待我审核 / 今日已审 / 本周通过率 / 学生总数
- 中部：左 = 「去审核」主按钮卡 + 学生管理快捷入口；右 = 待审核队列前 5 条
- ProcessSteps 改为「教师审核工作流」说明

**管理员**：保留独立 `/admin/dashboard`（已存在），但根路径 `/` 统一重定向到 `/admin/dashboard`，避免空白工作台。

## 4. 导航优化（AppLayout.tsx）

- NavLink active：`bg-primary/10 text-primary font-medium` + `before:` 左侧 3px 色条
- 图标统一 `h-4 w-4 stroke-[1.75]`
- Header 增加面包屑占位 + 用户头像下拉（退出移入）
- 折叠按钮保留；折叠时图标居中、tooltip 显示标题

## 5. 交互与微动效

- 所有 Card：`transition-all hover:-translate-y-0.5 hover:shadow-cardHover`
- 主按钮使用渐变 + `active:scale-[0.98]`
- 列表行 hover 高亮（已具备）；StatCard 数字使用 `animate-fade-in-up`
- Loading 用现有 `TableSkeleton` + 新 `StatCardSkeleton`
- Toast 统一走 sonner（成功/错误已就绪）

## 6. 响应式

- StatCard：`grid-cols-2 lg:grid-cols-4`
- 中部双栏：`grid-cols-1 lg:grid-cols-5`（3 + 2）
- ProcessSteps：移动端转为竖向

## 7. 文件改动清单

**新增**
- `src/components/StatCard.tsx`
- `src/components/ProcessSteps.tsx`
- `src/components/PageHeader.tsx`

**修改**
- `src/index.css`（设计令牌、状态色、阴影、渐变）
- `tailwind.config.ts`（颜色/阴影/动画扩展）
- `src/pages/Index.tsx`（按角色三种工作台布局，聚合查询）
- `src/components/AppLayout.tsx`（active 样式、折叠 tooltip、header 调整）
- `src/components/StatusBadge.tsx`（迁移到新语义色 token）

**不动**
- 路由结构、数据库 schema、Edge Functions、其他业务页（后续可按同套令牌渐进升级）

## 8. 验收要点

- 进入 `/`，0.5 秒内能看到本人当前学分申请总览与「下一步该做什么」
- 状态全部以语义色 Badge 呈现，无裸文字状态
- 主按钮与次按钮视觉层级清晰；空数据有引导，不再留白
- 侧边栏当前项有色条 + 背景高亮；折叠后仍可用

