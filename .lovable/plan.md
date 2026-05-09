## 问题

1. **编辑批次弹窗"看不清楚"**（图二）：弹窗背景被穿透，可以透过卡片看到下方表格的内容（"批次列表 / 开始时间 / 结束时间"等），文字与背景叠在一起完全不可读。原因：当前 `Dialog` 用 `bg-background`，而学院主题动态写入的 `--background`（HSL token）在某些情况下与卡片底色一致或半透明，加上 `DialogOverlay` 默认 `bg-black/80` 在低对比度颜色下也压不住后面的卡片纹理。

2. **操作列四个图标缺少 hover 提示**（图三）：`编辑 / 生成报告 / 下载报告 / 删除` 四个 ghost 按钮只有图标，鼠标悬停时没有任何文字提示，新用户不知道每个图标含义。

## 修复方案

### 一、弹窗内容可读性

在 `src/pages/admin/SubmissionWindows.tsx` 的 `<DialogContent>` 上做两件事：

- 加 `className="bg-card text-card-foreground shadow-2xl border"`，强制使用 card token（不会被学院主题的 `--background` 覆盖成透明）。
- 内容容器加足够的 `space-y` 和 `p-6` 已有，标题与表单之间的层次没问题，只是现在透出了背景。改完即可。

如果想顺手把整体提升一档，把 DialogTitle 之外补一个 DialogDescription（"修改批次的开放时间和启用状态"），表单字段之间用 `border-t` 分隔，看上去更克制。

### 二、四个操作图标加悬浮文字

复用项目里已有的 `Tooltip` 组件（`TooltipProvider` 已经在 `src/App.tsx` 全局包裹）。在 `SubmissionWindows.tsx` 顶部新增：

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

把每个操作按钮包成：

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button size="sm" variant="ghost" onClick={() => openEdit(w)} aria-label="编辑批次">
      <Pencil className="h-4 w-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>编辑批次</TooltipContent>
</Tooltip>
```

四个按钮对应文案：

- ✏️ Pencil → **编辑批次**
- 📄 FileSpreadsheet → **生成报告**（生成中改为"生成中…"）
- ⬇️ Download → **下载报告**
- 🗑️ Trash2 → **删除批次**（已生成报告不可删，禁用态 tooltip 可显示"已生成报告，无法删除"）

## 改动文件

- `src/pages/admin/SubmissionWindows.tsx`（唯一文件）

## 验收

- 打开"编辑批次"弹窗，背景为不透明的卡片色，表单字段清晰可读，下方表格不再透出来。
- 鼠标悬停四个操作图标，0.5s 左右出现"编辑批次 / 生成报告 / 下载报告 / 删除批次"提示。
- 删除按钮在已生成报告时仍禁用，hover 显示禁用原因。
- 其他功能行为不变。