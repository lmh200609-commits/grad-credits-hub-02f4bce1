## 目标

把"提交时间窗口"批次报告从 Excel 改成 **PDF**，内容覆盖数据看板的全部维度，并对**不合格学生按班级**详细列出。重点：详尽 + 美观 + 中文显示正常。

## 技术方案

- Edge Function `generate-window-report/index.ts` 完全重写
- PDF 引擎：**jsPDF (`esm.sh/jspdf@2.5.2`) + jspdf-autotable (`esm.sh/jspdf-autotable@3.8.4`)**
  - autoTable 自带分页、表头染色、斑马条纹、页脚页码——天然适合大表
- **中文字体**：加载 **Noto Sans SC Regular + Bold**（jsdelivr cdn 上的 ttf），通过 `doc.addFileToVFS` + `doc.addFont` 注入 jsPDF
  - 字体抓取后内存缓存（模块级），每个 cold start 仅下载一次
  - 兜底：若字体下载失败，回退到内置字体并把中文按 Unicode 显示（仍可打开但变成方框，记录到日志）
- 输出到现有 `application-files` bucket，路径 `reports/{collegeId}/{windowId}-{ts}.pdf`，`contentType: application/pdf`
- `submission_window_reports.file_path` 与 `submission_windows.report_path` 直接写 .pdf 路径，前端 `createSignedUrl` 不变

## 报告内容（A4 纵向，多页）

### 封面 / 概览页
- 顶部色带 + 学院 LOGO 占位 + 大标题"批次提交报告"
- 副信息：学院名、批次名、起止时间、生成时间、生成人
- KPI 卡片网格（4×3，圆角矩形 + 主色描边）：
  - 学院学生总数 / 已提交 / 未提交 / 提交率
  - 申请总数 / 通过 / 驳回 / 待审
  - 累计通过学分 / 合格人数(≥4) / 不合格人数 / 合格率

### 状态分布（与看板一致）
- 表格 + 简单**横向条形图**（jsPDF rect 手绘）：系统通过 / 人工通过 / 待教师复核 / 系统驳回 / 人工驳回 / AI 评估中

### 学分合格情况
- 三档对比表：≥2、≥4(主)、≥6 学分各自的 合格 / 不合格 / 合格率

### 14 天提交趋势
- 折线图（手绘 polyline）+ 数据表

### 院系 / 专业分布
- 两张 autoTable：院系（人数 + 占比）、专业（人数 + 占比 + 平均学分）

### 按班级分布 ⭐
- autoTable，列：班级 / 专业 / 班级人数 / 提交 / 未提交 / 提交率 / 通过 / 驳回 / 待审 / 累计学分 / 人均学分 / 合格 / 不合格 / 合格率
- 末行汇总加粗
- 合格率 < 60% 的整行红色描边提醒

### ⭐ 不合格学生名单（按班级分组，重点章节）
- 每个有不合格学生的班级单独一个小标题段
  - 标题行：`{班级}（专业）— 不合格 X / Y 人 — 合格率 Z%`
  - 表格列：学号 / 姓名 / 已提交申请数 / 通过 / 驳回 / 待审 / 当前累计学分 / 距合格差额(4 − 当前)
- 同一班级内按"距合格差额"由大到小排序，便于学院重点跟进

### 未提交学生名单（按班级分组）
- 每班级一段 mini autoTable：学号 / 姓名 / 专业

### 申请明细（附录）
- autoTable 全量申请：时间 / 学号 / 姓名 / 班级 / 状态 / 匹配规则 / AI 建议学分 / 最终学分 / 描述（截断 60 字）
- 状态列单元格背景色：通过=绿、驳回=红、待审=橙

### 页脚（每页）
- 左：`{学院} · {批次}`
- 中：`第 X / Y 页`
- 右：生成时间

## 视觉规范

- 主色 `#1F4E79`，辅色绿 `#10B981` / 红 `#EF4444` / 橙 `#F59E0B`
- 表头：主色填充 + 白字加粗
- 斑马条纹 `#F5F8FB`
- 章节标题：左侧 4px 主色竖条 + 16pt 加粗
- 页边距 18mm，行高 1.4

## 计算 / 数据

完全沿用并扩展当前查询：
- 学院学生（user_roles+profiles）
- 窗口内 applications（带 status / final_credit / ai_suggested_credit / matched_rule / 时间）
- rules 名称映射
- 学院信息（colleges.name / system_title）用于封面

新增 in-function 聚合：
- 班级聚合（`profileMap` group by class_name + major）
- 不合格名单（学生在窗口内累计通过学分 < 4 且 submitted_count > 0）
- 三档合格阈值对照
- 14 天趋势按日填零

## 前端调整

- `SubmissionWindows.tsx`：
  - 下载文件名提示改为 PDF
  - `createSignedUrl` 不变（直接打开新标签即可预览 PDF）
- 兼容历史 .xlsx 报告：根据 `report_path` 后缀判断 MIME，不影响打开

## 不改动

- 表结构、RLS、触发器、调用入口、鉴权逻辑
- bucket 与签名 URL 流程

## 风险

- 字体冷启动下载 ~3-5MB，首次生成会慢 2-4 秒；后续命中模块缓存
- jspdf-autotable 中文宽度计算依赖字体 metrics，已通过设置 `styles.font: "NotoSansSC"` 修正
- 若 esm.sh 不稳定，备选 `https://cdn.skypack.dev/jspdf` 与 `npm:` 协议
