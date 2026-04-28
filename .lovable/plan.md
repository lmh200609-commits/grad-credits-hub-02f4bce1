# 学分认定证明导出功能

为审核通过（status=approved 或 auto_approved）的申请增加"导出学分认定证明 PDF"按钮，证明上包含学生身份信息、学分、证书编号、学生照片、学校公章与防伪二维码。

## 1. 数据库变更（migration）

**`profiles` 表新增字段**：
- `school text` —— 学校名称，默认 `'湖南文理学院'`（占位，可改）
- `photo_url text` —— 学生证件照路径（指向 `application-files` 桶下的 `student-photos/{user_id}.jpg`）
  - 复用已有 `application-files` 桶，避免新建桶；为 student-photos 子目录的对象增加 RLS：学生本人可 select/insert/update 自己目录；admin/teacher 可 select 全部

**`applications` 表新增字段**：
- `certificate_no text unique` —— 证书编号
- `certificate_issued_at timestamptz` —— 首次签发时间

**编号生成函数**：
```sql
create or replace function public.gen_certificate_no(_app_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_year text := to_char(now(),'YYYY');
        v_seq int;
        v_no text;
begin
  -- 已存在直接返回
  select certificate_no into v_no from applications where id=_app_id;
  if v_no is not null then return v_no; end if;
  -- 仅审核通过的申请可签发
  if not exists(select 1 from applications where id=_app_id
                  and status in ('approved','auto_approved')) then
     raise exception 'application not approved';
  end if;
  -- 序号 = 当年已签发数 + 1
  select count(*)+1 into v_seq from applications
   where certificate_no like v_year||'-%';
  v_no := v_year||'-'||lpad(v_seq::text,4,'0');
  update applications set certificate_no=v_no,
         certificate_issued_at=now() where id=_app_id;
  return v_no;
end;$$;
```
RLS：当前申请的学生本人 / teacher / admin 才能调用（在函数内部 `auth.uid()` 校验）。

## 2. 学生端：照片与档案维护

**新页面 `src/pages/student/MyProfile.tsx`**（侧边栏新增"我的档案"入口）：
- 展示并允许学生编辑：姓名、学号、院系、专业、班级、身份证号、电话、出生日期、学校（只读）
- 上传/替换学生照片（裁剪为 1:1.25 证件照比例，存到 `application-files/student-photos/{user_id}.jpg`）
- 写入 `profiles` 表（已有 RLS：本人可 update）

**`AppLayout.tsx`** 学生角色侧边栏增加 `我的档案` 菜单项，路由 `/profile`。

## 3. 证书 PDF 导出

**依赖**：`bun add jspdf qrcode` （`jspdf` 内置中文字体方案：用 `jsPDF` + 注册思源宋体子集，或直接用 `html2canvas` 把 React 渲染的证书 DOM 截图后嵌入 PDF —— 采用后者，避免中文字体打包问题）。
追加 `bun add html2canvas`。

**新组件 `src/components/CertificatePreview.tsx`**：
A4 横版（1123×794px @96dpi），布局：
```
┌─────────────────────────────────────────┐
│   学校名（大标题）                          │
│   学分认定证明                              │
│  ─────────────────────────────────       │
│  [学生照片]   姓名: xxx   学号: xxx          │
│   1寸照     院系: xxx   专业: xxx           │
│             身份证号: 4302**********1234   │ ← 中间脱敏
│                                          │
│  兹证明该生在校期间，因 [项目/获奖名称]       │
│  获得创新创业学分 X.X 分，特此证明。           │
│                                          │
│  申请说明摘要：……                            │
│  审核日期：YYYY-MM-DD  审核人：xxx           │
│                                          │
│         证书编号：2026-0001                │
│  [二维码]                       [虚拟公章]  │
│  扫码验证                                  │
└─────────────────────────────────────────┘
```

二维码内容：`{origin}/verify/{certificate_no}`（验证页面下面单独建）。

**导出按钮位置**：`src/pages/ApplicationDetail.tsx`，仅当 `status in ('approved','auto_approved')` 且当前用户是该申请的学生本人 / teacher / admin 时显示「导出学分证明」按钮。

**导出流程**：
1. 点击按钮 → 若 `certificate_no` 为空，调 `supabase.rpc('gen_certificate_no', { _app_id })` 生成
2. 隐式渲染 `<CertificatePreview>` 组件到屏外 div
3. `html2canvas` 截图 → `jsPDF`（A4 横向）`addImage` → `save('学分认定证明_{学号}_{证书编号}.pdf')`

## 4. 证书在线验证页

**新页面 `src/pages/VerifyCertificate.tsx`**，路由 `/verify/:certNo`（无需登录可访问）：
- 通过新增 edge function `verify-certificate`（公开，verify_jwt=false）按 `certificate_no` 查询并返回安全字段（学生姓名、学号、学分、签发日期），不暴露身份证、照片、详细描述
- 页面显示"✓ 证书有效 / ✗ 证书无效"

## 5. 文件改动一览

**新建**：
- `supabase/migrations/<ts>_certificate.sql`
- `src/pages/student/MyProfile.tsx`
- `src/pages/VerifyCertificate.tsx`
- `src/components/CertificatePreview.tsx`
- `src/lib/certificate.ts`（导出逻辑封装）
- `supabase/functions/verify-certificate/index.ts`

**修改**：
- `src/App.tsx`（注册 `/profile`、`/verify/:certNo` 路由）
- `src/components/AppLayout.tsx`（学生侧边栏新增"我的档案"）
- `src/pages/ApplicationDetail.tsx`（新增"导出学分证明"按钮 + 调用导出）
- `package.json`（新增 jspdf、html2canvas、qrcode）

## 6. 用户需要做的事

签发后请管理员在"用户管理"或学生本人在"我的档案"页面：
1. 上传学生证件照（必填，否则证书上是占位头像）
2. 补全院系、身份证号等基础信息

如需修改默认校名"湖南文理学院"，请告诉我正确校名，我会在 migration 默认值里改掉。
