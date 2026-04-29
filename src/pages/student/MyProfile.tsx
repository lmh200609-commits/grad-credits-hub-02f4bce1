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
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const save = async () => {
    if (!user || !p) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: p.full_name?.trim() || null,
        student_no: p.student_no?.trim() || null,
        department: p.department?.trim() || null,
        major: p.major?.trim() || null,
        class_name: p.class_name?.trim() || null,
        id_card: p.id_card?.trim() || null,
        phone: p.phone?.trim() || null,
        gender: p.gender?.trim() || null,
        ethnicity: p.ethnicity?.trim() || null,
        political_status: p.political_status?.trim() || null,
        birth_date: p.birth_date?.trim() || null,
        enrollment_year: p.enrollment_year ?? null,
        advisor: p.advisor?.trim() || null,
        apartment_no: p.apartment_no?.trim() || null,
        dorm_room: p.dorm_room?.trim() || null,
        bed_no: p.bed_no?.trim() || null,
      })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) return toast({ title: "保存失败", description: error.message, variant: "destructive" });
    toast({ title: "已保存" });
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
            <CardDescription>姓名、学号、身份证号等将打印到学分认定证明上</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="姓名" v={p.full_name} on={(v) => setP({ ...p, full_name: v })} />
            <Field label="学号" v={p.student_no} on={(v) => setP({ ...p, student_no: v })} />
            <Field label="院系" v={p.department} on={(v) => setP({ ...p, department: v })} />
            <Field label="专业" v={p.major} on={(v) => setP({ ...p, major: v })} />
            <Field label="班级" v={p.class_name} on={(v) => setP({ ...p, class_name: v })} />
            <Field label="年级（入学年份）" v={p.enrollment_year != null ? String(p.enrollment_year) : ""} on={(v) => {
              const n = parseInt(v.replace(/\D+/g, ""), 10);
              setP({ ...p, enrollment_year: Number.isFinite(n) ? n : null });
            }} maxLength={4} />
            <Field label="性别" v={p.gender} on={(v) => setP({ ...p, gender: v })} />
            <Field label="民族" v={p.ethnicity} on={(v) => setP({ ...p, ethnicity: v })} />
            <Field label="政治面貌" v={p.political_status} on={(v) => setP({ ...p, political_status: v })} />
            <Field label="出生日期" v={p.birth_date} on={(v) => setP({ ...p, birth_date: v })} placeholder="YYYY-MM-DD" />
            <Field label="辅导员" v={p.advisor} on={(v) => setP({ ...p, advisor: v })} />
            <Field label="身份证号" v={p.id_card} on={(v) => setP({ ...p, id_card: v })} maxLength={18} />
            <Field label="手机号" v={p.phone} on={(v) => setP({ ...p, phone: v })} />
            <Field label="公寓号" v={p.apartment_no} on={(v) => setP({ ...p, apartment_no: v })} />
            <Field label="宿舍号" v={p.dorm_room} on={(v) => setP({ ...p, dorm_room: v })} />
            <Field label="床号" v={p.bed_no} on={(v) => setP({ ...p, bed_no: v })} />
            <div>
              <Label>学校</Label>
              <Input value={p.school ?? ""} disabled />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

const Field = ({
  label, v, on, maxLength, placeholder,
}: { label: string; v: string | null; on: (s: string) => void; maxLength?: number; placeholder?: string }) => (
  <div>
    <Label>{label}</Label>
    <Input value={v ?? ""} maxLength={maxLength} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
  </div>
);

export default MyProfile;