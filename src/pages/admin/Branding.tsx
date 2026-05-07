import { useEffect, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { extractPaletteFromImage } from "@/lib/extractPalette";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Theme = {
  primary?: string; accent?: string; background?: string;
  radius?: string; layout?: "sidebar" | "top-nav" | "compact";
};

const Branding = () => {
  const { collegeId } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [college, setCollege] = useState<any>(null);
  const [theme, setTheme] = useState<Theme>({});
  const [systemTitle, setSystemTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!collegeId) return;
    const { data } = await supabase.from("colleges").select("*").eq("id", collegeId).maybeSingle();
    if (data) {
      setCollege(data);
      setTheme((data.theme as Theme) ?? {});
      setSystemTitle(data.system_title);
    }
  };
  useEffect(() => { void load(); }, [collegeId]);

  const onPick = () => fileRef.current?.click();
  const onFile = async (file: File) => {
    if (!collegeId) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("院徽最大 2MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${collegeId}/badge-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("college-badges").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("college-badges").getPublicUrl(path);
      const url = pub.publicUrl;
      const palette = await extractPaletteFromImage(url).catch(() => null);
      const newTheme: Theme = { ...theme, ...(palette ?? {}) };
      setTheme(newTheme);
      const { error } = await supabase.from("colleges").update({
        badge_url: url, theme: newTheme,
      }).eq("id", collegeId);
      if (error) throw error;
      toast.success("院徽已上传，主题色已自动提取");
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!collegeId) return;
    setSaving(true);
    const { error } = await supabase.from("colleges").update({
      theme, system_title: systemTitle,
    }).eq("id", collegeId);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("已保存，刷新页面后生效"); }
  };

  if (!collegeId) {
    return <AppLayout><div className="p-6 text-muted-foreground">未绑定学院，无法配置主题。</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">学院界面风格</h1>
        <Card>
          <CardHeader><CardTitle className="text-base">院徽</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-4">
            {college?.badge_url ? (
              <img src={college.badge_url} alt="院徽" className="h-24 w-24 rounded border bg-white object-contain p-2" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded border text-xs text-muted-foreground">未上传</div>
            )}
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <Button onClick={onPick} disabled={uploading}>{uploading ? "上传中…" : "上传院徽"}</Button>
              <p className="text-xs text-muted-foreground">PNG/JPG/SVG，≤ 2MB。上传后系统将自动提取主色作为 UI 主题。</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">系统标题</CardTitle></CardHeader>
          <CardContent>
            <Input value={systemTitle} onChange={(e) => setSystemTitle(e.target.value)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">主题（HSL 格式：H S% L%）</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div><Label>主色 primary</Label>
              <Input value={theme.primary ?? ""} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} placeholder="222 76% 38%" />
            </div>
            <div><Label>辅色 accent</Label>
              <Input value={theme.accent ?? ""} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} placeholder="210 40% 96%" />
            </div>
            <div><Label>背景 background</Label>
              <Input value={theme.background ?? ""} onChange={(e) => setTheme({ ...theme, background: e.target.value })} placeholder="220 20% 98%" />
            </div>
            <div><Label>圆角 radius</Label>
              <Input value={theme.radius ?? ""} onChange={(e) => setTheme({ ...theme, radius: e.target.value })} placeholder="0.5rem" />
            </div>
            <div><Label>布局变体</Label>
              <Select value={theme.layout ?? "sidebar"} onValueChange={(v) => setTheme({ ...theme, layout: v as Theme["layout"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sidebar">侧边栏（经典）</SelectItem>
                  <SelectItem value="top-nav">顶部导航</SelectItem>
                  <SelectItem value="compact">紧凑式</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存主题"}</Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default Branding;