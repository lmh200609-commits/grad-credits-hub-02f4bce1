import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { extractPaletteFromImage } from "@/lib/extractPalette";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { hexToHslTokens, hslTokensToHex } from "@/lib/colorConvert";
import { Input } from "@/components/ui/input";
import { usePreviewTheme } from "@/hooks/usePreviewTheme";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Theme = {
  primary?: string; accent?: string; background?: string;
  radius?: string; layout?: "sidebar" | "top-nav" | "compact";
};

const PRESETS = [
  "#1d4ed8", "#0ea5e9", "#0891b2", "#059669",
  "#65a30d", "#ca8a04", "#ea580c", "#dc2626",
  "#db2777", "#9333ea", "#475569", "#0f172a",
];

const ColorField = ({
  label, value, onChange,
}: { label: string; value?: string; onChange: (tokens: string) => void }) => {
  const hex = hslTokensToHex(value);
  const setHex = (h: string) => {
    const tokens = hexToHslTokens(h);
    if (tokens) onChange(tokens);
  };
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="h-10 w-16 cursor-pointer rounded border bg-background p-1"
          aria-label={`${label} 拾色器`}
        />
        <span className="text-sm text-muted-foreground">点击左侧色块或选择下方预设</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setHex(p)}
            title={p}
            aria-label={`选择 ${p}`}
            className={`h-6 w-6 rounded border transition hover:scale-110 ${
              hex.toLowerCase() === p.toLowerCase() ? "ring-2 ring-ring ring-offset-1" : ""
            }`}
            style={{ backgroundColor: p }}
          />
        ))}
      </div>
    </div>
  );
};

const Branding = () => {
  const { collegeId, loading: authLoading } = useAuth();
  const { enterPreview } = usePreviewTheme();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [college, setCollege] = useState<any>(null);
  const [theme, setTheme] = useState<Theme>({});
  const [systemTitle, setSystemTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      const isHsl = (v?: string) => !!v && /^\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*$/.test(v);
      const palette = await extractPaletteFromImage(url).catch(() => null);
      const valid: Theme = {};
      if (palette) {
        if (isHsl(palette.primary)) valid.primary = palette.primary;
        if (isHsl(palette.background)) valid.background = palette.background;
        if (isHsl(palette.accent)) valid.accent = palette.accent;
      }
      const newTheme: Theme = { ...theme, ...valid };
      const { error } = await supabase.from("colleges").update({ badge_url: url, theme: newTheme }).eq("id", collegeId);
      if (error) throw error;
      setTheme(newTheme);
      toast.success(Object.keys(valid).length > 0 ? "院徽已上传，主题已自动更新" : "院徽已上传（未识别到合适主色，主题未变）");
      await load();
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
    else { toast.success("已同步到本学院全部用户"); }
  };

  const lightnessOf = (tokens?: string) => {
    if (!tokens) return null;
    const m = /(\d+(?:\.\d+)?)%\s*$/.exec(tokens);
    return m ? parseFloat(m[1]) : null;
  };

  const requestSave = () => {
    const lp = lightnessOf(theme.primary);
    const lb = lightnessOf(theme.background);
    if (lp !== null && lp > 88) {
      toast.warning("主色过浅，按钮文字可能看不清，建议选择更深的主色");
    } else if (lp !== null && lb !== null && Math.abs(lp - lb) < 6) {
      toast.warning("主色与背景色过于接近，按钮可能不可见");
    }
    setConfirmOpen(true);
  };

  if (authLoading) {
    return <AppLayout><div className="p-6 text-muted-foreground">加载中…</div></AppLayout>;
  }
  if (!collegeId) {
    return <AppLayout><div className="p-6 text-muted-foreground">未绑定学院，无法配置主题。</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">学院界面风格</h1>
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            以下修改仅作用于本学院{college?.name ? `（${college.name}）` : ""}，确认后本学院的全部管理员、教师、学生端将自动同步，无需刷新。
          </CardContent>
        </Card>
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
              <Button variant="solid" onClick={onPick} disabled={uploading}>{uploading ? "上传中…" : "上传院徽"}</Button>
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
          <CardHeader><CardTitle className="text-base">配色与样式</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <ColorField label="主色" value={theme.primary} onChange={(v) => setTheme({ ...theme, primary: v })} />
            <ColorField label="辅色" value={theme.accent} onChange={(v) => setTheme({ ...theme, accent: v })} />
            <ColorField label="背景色" value={theme.background} onChange={(v) => setTheme({ ...theme, background: v })} />
            <div className="space-y-2"><Label>圆角大小</Label>
              <Input value={theme.radius ?? ""} onChange={(e) => setTheme({ ...theme, radius: e.target.value })} placeholder="留空使用默认" />
              <p className="text-xs text-muted-foreground">控制按钮、卡片的圆角程度，留空使用系统默认。</p>
            </div>
            <div className="md:col-span-2">
              <Label>布局变体</Label>
              <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <Select value={theme.layout ?? "sidebar"} onValueChange={(v) => setTheme({ ...theme, layout: v as Theme["layout"] })}>
                  <SelectTrigger className="md:w-[280px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sidebar">侧边栏（经典）</SelectItem>
                    <SelectItem value="top-nav">顶部导航</SelectItem>
                    <SelectItem value="compact">紧凑式</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => void load()} disabled={saving}>还原</Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const lp = lightnessOf(theme.primary);
                      const lb = lightnessOf(theme.background);
                      if (lp !== null && lp > 88) {
                        toast.warning("主色过浅，按钮文字可能看不清");
                      } else if (lp !== null && lb !== null && Math.abs(lp - lb) < 6) {
                        toast.warning("主色与背景色过于接近，按钮可能不可见");
                      }
                      enterPreview(theme);
                      navigate("/admin/dashboard");
                    }}
                    disabled={saving}
                  >
                    进入全局预览
                  </Button>
                  <Button variant="solid" onClick={requestSave} disabled={saving}>
                    {saving ? "提交中…" : "确认并提交修改"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认提交修改？</AlertDialogTitle>
              <AlertDialogDescription>
                确认后将把新的界面风格立即应用到本学院{college?.name ? `（${college.name}）` : ""}的所有管理员、教师与学生。其他学院不受影响。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => { void save(); }} className="bg-action text-action-foreground hover:bg-action/90">确认提交</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={extractOpen} onOpenChange={setExtractOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>检测到院徽主色，是否应用为 UI 主题？</AlertDialogTitle>
              <AlertDialogDescription>
                应用后将覆盖当前的主色 / 背景 / 强调色；如果想保留现有主题，请选择「保留原主题」。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              {[
                { title: "保留原主题", t: theme },
                { title: "应用新提取", t: { ...theme, ...(extracted ?? {}) } },
              ].map((col) => (
                <div key={col.title} className="rounded-lg border p-3">
                  <div className="mb-2 text-sm font-medium">{col.title}</div>
                  <div className="space-y-2 text-xs">
                    {(["primary", "background", "accent"] as const).map((k) => {
                      const hex = hslTokensToHex(col.t[k]);
                      return (
                        <div key={k} className="flex items-center gap-2">
                          <span className="inline-block h-5 w-5 rounded border" style={{ backgroundColor: hex || "transparent" }} />
                          <span className="w-20 text-muted-foreground">{k}</span>
                          <span className="font-mono">{hex || "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setExtracted(null); }}>保留原主题</AlertDialogCancel>
              <AlertDialogAction onClick={() => { void applyExtracted(); }} className="bg-action text-action-foreground hover:bg-action/90">应用新主题</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
};

export default Branding;