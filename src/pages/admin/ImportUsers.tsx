import { useRef, useState } from "react";
import Papa from "papaparse";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Download, Upload } from "lucide-react";

type ParsedRow = {
  student_no: string;
  full_name: string;
  phone?: string;
  class_name?: string;
  department?: string;
  major?: string;
  role: "admin" | "teacher" | "student";
  password: string;
};

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  "学号": "student_no",
  "工号": "student_no",
  "学号/工号": "student_no",
  "姓名": "full_name",
  "手机号": "phone",
  "班级": "class_name",
  "院系": "department",
  "专业": "major",
  "角色": "role",
  "密码": "password",
};

const ROLE_MAP: Record<string, ParsedRow["role"]> = {
  "管理员": "admin",
  "admin": "admin",
  "教师": "teacher",
  "老师": "teacher",
  "teacher": "teacher",
  "学生": "student",
  "student": "student",
};

const ImportUsers = () => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const handleFile = (file: File) => {
    setFileName(file.name);
    setRows([]);
    setParseErrors([]);
    setServerErrors([]);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const errors: string[] = [];
        const parsed: ParsedRow[] = [];

        result.data.forEach((raw, idx) => {
          const line = idx + 2;
          const r: Partial<ParsedRow> = {};
          Object.entries(raw).forEach(([key, value]) => {
            const trimmedKey = key.trim();
            const mapped = HEADER_MAP[trimmedKey];
            if (mapped) (r as any)[mapped] = (value ?? "").trim();
          });

          if (!r.student_no) errors.push(`第 ${line} 行：学号/工号为空`);
          if (!r.full_name) errors.push(`第 ${line} 行：姓名为空`);
          if (!r.password || r.password.length < 6) errors.push(`第 ${line} 行：密码至少 6 位`);

          const roleRaw = (r.role as string)?.toLowerCase().trim();
          const mappedRole = ROLE_MAP[r.role as string] ?? ROLE_MAP[roleRaw];
          if (!mappedRole) errors.push(`第 ${line} 行：角色非法（应为 教师/学生/管理员）`);
          else r.role = mappedRole;

          parsed.push(r as ParsedRow);
        });

        setParseErrors(errors);
        setRows(parsed);
      },
      error: (err) => setParseErrors([err.message]),
    });
  };

  const handleSubmit = async () => {
    setServerErrors([]);
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("import-users", {
      body: { rows },
    });
    setSubmitting(false);

    if (error) {
      // Supabase wraps non-2xx as error; try to extract details
      const ctx: any = (error as any).context;
      let detail = error.message;
      try {
        const txt = await ctx?.text?.();
        if (txt) {
          const j = JSON.parse(txt);
          detail = j.error ?? detail;
          if (j.errors) setServerErrors(j.errors.map((e: any) => `第 ${e.line} 行：${e.message}`));
          if (j.conflicts) setServerErrors(j.conflicts.map((c: string) => `已存在：${c}`));
        }
      } catch {/* ignore */}
      toast({ title: "导入失败", description: detail, variant: "destructive" });
      return;
    }

    if (data?.success) {
      toast({ title: "导入成功", description: `已新增 ${data.created} 个账号` });
      setRows([]);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    const csv = "学号/工号,姓名,手机号,班级,院系,专业,角色,密码\n2024001,张三,13800000000,计科2401,计算机学院,软件工程,学生,123456\nT001,李老师,13900000000,,计算机学院,,教师,123456\n";
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "用户导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">批量导入账号</h1>
              <p className="text-sm text-muted-foreground">CSV 一次创建教师/学生账号</p>
            </div>
          </div>
          <Button variant="outline" onClick={signOut}>退出登录</Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>第 1 步：准备 CSV</CardTitle>
            <CardDescription>
              列：学号/工号、姓名、手机号、班级、院系、专业、角色、密码。角色填 教师 / 学生 / 管理员。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> 下载模板
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>第 2 步：上传文件</CardTitle>
            <CardDescription>{fileName || "尚未选择文件"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {parseErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>CSV 解析错误（{parseErrors.length}）</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-sm">
                    {parseErrors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                    {parseErrors.length > 10 && <li>…其余 {parseErrors.length - 10} 条已省略</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {serverErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>服务端校验错误</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-sm">
                    {serverErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {rows.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>学号/工号</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>院系</TableHead>
                      <TableHead>班级</TableHead>
                      <TableHead>手机号</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 20).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.student_no}</TableCell>
                        <TableCell>{r.full_name}</TableCell>
                        <TableCell>{r.role}</TableCell>
                        <TableCell>{r.department}</TableCell>
                        <TableCell>{r.class_name}</TableCell>
                        <TableCell>{r.phone}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 20 && (
                  <p className="border-t p-2 text-center text-xs text-muted-foreground">
                    仅预览前 20 行，共 {rows.length} 行
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>第 3 步：执行导入</CardTitle>
            <CardDescription>
              如果有任何学号已存在或校验未通过，整批中止。导入成功后系统会立即创建对应登录账号。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleSubmit}
              disabled={submitting || rows.length === 0 || parseErrors.length > 0}
            >
              <Upload className="mr-2 h-4 w-4" />
              {submitting ? "导入中…" : `导入 ${rows.length} 条`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default ImportUsers;
