import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import QRCode from "qrcode";

/** 把远端图片转成 dataURL，避免 html2canvas 跨域污染 canvas */
export async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function makeQrDataUrl(text: string): Promise<string> {
  return await QRCode.toDataURL(text, { width: 256, margin: 1 });
}

/** 把指定 DOM 节点导出为 A4 横版 PDF */
export async function exportElementToPdf(
  el: HTMLElement,
  filename: string,
): Promise<void> {
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });
  const img = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // 等比缩放并居中
  const imgRatio = canvas.width / canvas.height;
  const pageRatio = pageW / pageH;
  let drawW = pageW;
  let drawH = pageH;
  if (imgRatio > pageRatio) {
    drawH = pageW / imgRatio;
  } else {
    drawW = pageH * imgRatio;
  }
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  pdf.addImage(img, "JPEG", x, y, drawW, drawH);
  pdf.save(filename);
}