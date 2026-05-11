// Lightweight dominant-color extractor using canvas + simple histogram.
// No external deps. Returns HSL strings in "H S% L%" format suitable for CSS variables.

export type Palette = {
  primary: string;
  accent: string;
  background: string;
  sidebarBg: string;
  headerTint: string;
  brandStrong: string;
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
};

const hsl = (h: number, s: number, l: number) => `${h} ${s}% ${l}%`;

const fallback: Palette = {
  primary: hsl(222, 76, 38),
  accent: hsl(210, 40, 88),
  background: hsl(222, 30, 98),
  sidebarBg: hsl(222, 30, 96),
  headerTint: hsl(222, 50, 94),
  brandStrong: hsl(222, 80, 32),
};

export const extractPaletteFromImage = (url: string): Promise<Palette> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 64;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 128) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // Skip near-white / near-black / near-gray
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max - min < 20) continue;
          if (max > 240 && min > 240) continue;
          if (max < 25) continue;
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
          const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
          cur.count += 1; cur.r += r; cur.g += g; cur.b += b;
          buckets.set(key, cur);
        }
        const sorted = [...buckets.values()]
          .map((v) => {
            const r = v.r / v.count, g = v.g / v.count, b = v.b / v.count;
            const [h, s, l] = rgbToHsl(r, g, b);
            // Score = popularity * saturation weight; penalize very dark/very light & very low sat
            const satW = Math.min(1, s / 60);
            const lightW = l > 12 && l < 88 ? 1 : 0.4;
            return { r, g, b, h, s, l, count: v.count, score: v.count * (0.3 + satW) * lightW };
          })
          .sort((a, b) => b.score - a.score);
        if (sorted.length === 0) {
          resolve(fallback);
          return;
        }
        // Pick a primary with decent saturation; fall back through the list if needed
        let chosen = sorted[0];
        if (chosen.s < 25) {
          const better = sorted.find((c) => c.s >= 35);
          if (better) chosen = better;
        }
        const h1 = chosen.h;
        const s1 = Math.max(45, Math.min(85, chosen.s));
        const l1 = Math.max(30, Math.min(48, chosen.l));
        const primary = hsl(h1, s1, l1);
        // Accent: complementary-ish hue offset to maximize differentiation across colleges
        const accentHue = (h1 + 180) % 360;
        const accent = hsl(accentHue, Math.max(35, Math.min(55, s1 - 10)), 88);
        // Background: very faintly tinted with primary hue
        const background = hsl(h1, 30, 97);
        // Sidebar: slightly more saturated than background, still light
        const sidebarBg = hsl(h1, 35, 95);
        // Header tint: a noticeable but soft band
        const headerTint = hsl(h1, 55, 93);
        // Brand strong: deeper version of primary for emphasis
        const brandStrong = hsl(h1, Math.min(90, s1 + 10), Math.max(22, l1 - 10));
        resolve({ primary, accent, background, sidebarBg, headerTint, brandStrong });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("无法加载院徽图片"));
    img.src = url;
  });