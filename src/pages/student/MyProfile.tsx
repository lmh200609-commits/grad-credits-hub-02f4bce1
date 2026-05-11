import { useCallback, useEffect, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

type Profile = {
  full_name: string | null;
  student_no: string | null;
  department: string | null;
  major: string | null;
  class_name: string | null;
  id_card: string | null;
  phone: string | null;
  school: string | null;
  photo_url: string | null;
  gender: string | null;
  ethnicity: string | null;
  political_status: string | null;
  birth_date: string | null;
  enrollment_year: number | null;
  advisor: string | null;
  apartment_no: string | null;
  dorm_room: string | null;
  bed_no: string | null;
};

const MyProfile = () => {
  const { user } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("full_name, student_no, department, major, class_name, id_card, phone, school, photo_url, gender, ethnicity, political_status, birth_date, enrollment_year, advisor, apartment_no, dorm_room, bed_no")
      .eq("user_id", user.id)
      .maybeSingle();
    setP((data as Profile) ?? {
      full_name: "", student_no: "", department: "", major: "", class_name: "",
      id_card: "", phone: "", school: "长春财经学院", photo_url: null,
      gender: "", ethnicity: "", political_status: "", birth_date: "",
      enrollment_year: null, advisor: "", apartment_no: "", dorm_room: "", bed_no: "",
    });
    if ((data as Profile)?.photo_url) {
      const { data: signed } = await supabase.storage
        .from("application-files")
        .createSignedUrl((data as Profile).photo_url!, 3600);
      setPhotoUrl(signed?.signedUrl ?? null);
    } else {
      setPhotoUrl(null);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const changePassword = async () => {
    if (pwdSaving) return;
    if (!pwd || pwd.length < 6) {
      return toast({ title: "新密码至少 6 位", variant: "destructive" });
    }
    if (pwd !== pwd2) {
      return toast({ title: "两次输入的密码不一致", variant: "destructive" });
    }
    setPwdSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setPwdSaving(false);
    if (error) return toast({ title: "修改失败", description: error.message, variant: "destructive" });
    setPwd(""); setPwd2("");
    toast({ title: "密码已更新" });
  };

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !user) return;
    if (!/^image\//.test(f.type)) {
      return toast({ title: "请选择图片", variant: "destructive" });
    }
    if (f.size > 5 * 1024 * 1024) {
      return toast({ title: "图片过大", description: "请小于 5MB", variant: "destructive" });
    }
    setUploading(true);
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `student-photos/${user.id}/photo.${ext}`;
    const { error: ue } = await supabase.storage
      .from("application-files")
      .upload(path, f, { upsert: true, contentType: f.type });
    if (ue) {
      setUploading(false);
      return toast({ title: "上传失败", description: ue.message, variant: "destructive" });
    }
    const { error: pe } = await supabase
      .from("profiles")
      .update({ photo_url: path })
      .eq("user_id", user.id);
    setUploading(false);
    if (pe) return toast({ title: "保存失败", description: pe.message, variant: "destructive" });
    toast({ title: "照片已更新" });
    load();
  };

  if (!p) return <AppLayout><p>加载中…</p></AppLayout>;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">我的档案</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">证件照</CardTitle>
            <CardDescription>用于学分认定证明，建议 1 寸或 2 寸正面免冠彩色照</CardDescription>
          </CardHeader>
          <CardContent className="flex items-start gap-4">
            <div className="h-40 w-32 overflow-hidden rounded border bg-muted/40">
              {photoUrl ? (
                <img src={photoUrl} alt="证件照" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  未上传
                </div>
              )}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              <Button onClick={onPick} disabled={uploading} variant="outline">
                <Upload className="mr-1 h-4 w-4" />
                {uploading ? "上传中…" : photoUrl ? "更换照片" : "上传照片"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本信息</CardTitle>
            <CardDescription>基本信息由学校统一维护，如有错误请联系辅导员；证件照可自行更换</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="姓名" v={p.full_name} />
            <Field label="学号" v={p.student_no} />
            <Field label="院系" v={p.department} />
            <Field label="专业" v={p.major} />
            <Field label="班级" v={p.class_name} />
            <Field label="年级（入学年份）" v={p.enrollment_year != null ? String(p.enrollment_year) : ""} />
            <Field label="性别" v={p.gender} />
            <Field label="民族" v={p.ethnicity} />
            <Field label="政治面貌" v={p.political_status} />
            <Field label="出生日期" v={p.birth_date} />
            <Field label="辅导员" v={p.advisor} />
            <Field label="身份证号" v={p.id_card} />
            <Field label="手机号" v={p.phone} />
            <Field label="公寓号" v={p.apartment_no} />
            <Field label="宿舍号" v={p.dorm_room} />
            <Field label="床号" v={p.bed_no} />
            <div>
              <Label>学校</Label>
              <Input value={p.school ?? ""} disabled />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">修改密码</CardTitle>
            <CardDescription>设置新的登录密码，至少 6 位</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>新密码</Label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <Label>确认新密码</Label>
              <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={changePassword} disabled={pwdSaving}>
                {pwdSaving ? "提交中…" : "提交"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

const Field = ({
  label, v,
}: { label: string; v: string | null }) => (
  <div>
    <Label>{label}</Label>
    <Input value={v ?? ""} disabled />
  </div>
);

export default MyProfile;