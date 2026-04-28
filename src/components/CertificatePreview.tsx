import { forwardRef } from "react";

export type CertificateData = {
  school: string;
  studentName: string;
  studentNo: string;
  department: string;
  major?: string | null;
  idCard?: string | null;
  photoDataUrl?: string | null;
  certificateNo: string;
  credit: number;
  projectTitle: string;
  description: string;
  reviewerName?: string | null;
  issuedAt: string; // ISO
  qrDataUrl?: string | null;
};

const maskId = (id?: string | null) => {
  if (!id) return "—";
  const s = id.trim();
  if (s.length < 8) return s;
  return s.slice(0, 4) + "*".repeat(Math.max(0, s.length - 8)) + s.slice(-4);
};

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  } catch {
    return iso;
  }
};

/**
 * A4 横版 1123 × 794 px @96dpi。固定像素布局以便 html2canvas 截图后嵌入 PDF。
 * 注意：组件用纯内联样式而非 Tailwind 语义 token，因为渲染到 PDF 时
 * Tailwind 的 CSS 变量在离屏 DOM 上可能解析失败。
 */
const CertificatePreview = forwardRef<HTMLDivElement, { data: CertificateData }>(
  ({ data }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          width: 1123,
          height: 794,
          background: "#fffdf6",
          padding: 56,
          fontFamily:
            '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",-apple-system,system-ui,sans-serif',
          color: "#1a1a1a",
          position: "relative",
          boxSizing: "border-box",
          border: "8px double #8b5a2b",
        }}
      >
        {/* 顶部 */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 4, color: "#8b1c1c" }}>
            {data.school}
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: 12,
              marginTop: 8,
              color: "#1a1a1a",
            }}
          >
            学 分 认 定 证 明
          </div>
          <div style={{ marginTop: 12, fontSize: 14, color: "#6b6b6b" }}>
            CREDIT CERTIFICATION · 证书编号：{data.certificateNo}
          </div>
        </div>

        {/* 正文 + 照片 */}
        <div style={{ display: "flex", gap: 32, marginTop: 24 }}>
          <div
            style={{
              width: 160,
              height: 200,
              border: "1px solid #c4c4c4",
              background: "#f3f3f3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {data.photoDataUrl ? (
              <img
                src={data.photoDataUrl}
                alt="学生照片"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                crossOrigin="anonymous"
              />
            ) : (
              <span style={{ color: "#999", fontSize: 14 }}>学生照片</span>
            )}
          </div>

          <div style={{ flex: 1, fontSize: 17, lineHeight: 2 }}>
            <Row label="姓名" value={data.studentName} />
            <Row label="学号" value={data.studentNo} />
            <Row label="院系" value={data.department || "—"} />
            {data.major && <Row label="专业" value={data.major} />}
            <Row label="身份证号" value={maskId(data.idCard)} />
            <Row label="学校" value={data.school} />
          </div>
        </div>

        {/* 认定描述 */}
        <div
          style={{
            marginTop: 28,
            fontSize: 18,
            lineHeight: 2,
            textIndent: "2em",
          }}
        >
          兹证明上述学生在校期间，因
          <span style={{ fontWeight: 700, color: "#8b1c1c", margin: "0 6px" }}>
            {data.projectTitle || "—"}
          </span>
          经学校学分认定委员会审核，认定授予创新创业学分
          <span style={{ fontWeight: 800, fontSize: 22, color: "#8b1c1c", margin: "0 6px" }}>
            {data.credit}
          </span>
          分，特此证明。
        </div>

        {/* 底部签发信息 */}
        <div
          style={{
            position: "absolute",
            left: 56,
            right: 56,
            bottom: 56,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.qrDataUrl && (
              <img
                src={data.qrDataUrl}
                alt="验证二维码"
                style={{ width: 96, height: 96 }}
              />
            )}
            <span style={{ fontSize: 11, color: "#888" }}>扫码在线验证</span>
          </div>

          <div style={{ textAlign: "right", fontSize: 15, lineHeight: 1.8 }}>
            <div>签发单位：{data.school} 教务处</div>
            {data.reviewerName && <div>审核人：{data.reviewerName}</div>}
            <div>签发日期：{fmtDate(data.issuedAt)}</div>
          </div>

          {/* 虚拟公章 */}
          <div
            style={{
              position: "absolute",
              right: 120,
              bottom: 40,
              width: 130,
              height: 130,
              border: "4px solid #c0392b",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(-12deg)",
              opacity: 0.78,
              color: "#c0392b",
              fontWeight: 700,
              textAlign: "center",
              fontSize: 13,
              lineHeight: 1.4,
              padding: 8,
              boxSizing: "border-box",
            }}
          >
            {data.school}
            <br />
            教务处专用章
          </div>
        </div>
      </div>
    );
  },
);

CertificatePreview.displayName = "CertificatePreview";

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex" }}>
    <span style={{ width: 96, color: "#666" }}>{label}：</span>
    <span style={{ fontWeight: 600 }}>{value}</span>
  </div>
);

export default CertificatePreview;