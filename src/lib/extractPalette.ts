// Lightweight dominant-color extractor using canvas + simple histogram.
// No external deps. Returns HSL strings in "H S% L%" format suitable for CSS variables.

export type Palette = { primary: string; accent: string; background: string };

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
          .map((v) => ({ r: v.r / v.count, g: v.g / v.count, b: v.b / v.count, count: v.count }))
          .sort((a, b) => b.count - a.count);
        if (sorted.length === 0) {
          // fallback neutral palette
          resolve({ primary: hsl(222, 76, 38), accent: hsl(210, 40, 96), background: hsl(220, 20, 98) });
          return;
        }
        const top = sorted[0];
        const second = sorted[1] ?? sorted[0];
        const [h1, s1, l1] = rgbToHsl(top.r, top.g, top.b);
        const [h2, s2] = rgbToHsl(second.r, second.g, second.b);
        // Ensure good contrast on light bg → clamp lightness
        const primary = hsl(h1, Math.max(40, Math.min(85, s1)), Math.max(28, Math.min(50, l1)));
        const accent = hsl(h2, Math.max(20, Math.min(40, s2)), 94);
        const background = hsl(h1, 20, 98);
        resolve({ primary, accent, background });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("无法加载院徽图片"));
    img.src = url;
  });