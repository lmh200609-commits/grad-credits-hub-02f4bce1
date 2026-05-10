import { useEffect, useRef, useState, type WheelEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, ExternalLink } from "lucide-react";

type Props = {
  src: string;
  alt?: string;
  /** Optional href to open the original full-resolution file in a new tab. */
  openUrl?: string;
};

/**
 * Lightweight image viewer with mouse-wheel zoom and click-drag pan.
 * No external dependencies. Designed to live inside a Dialog body.
 */
export default function ZoomableImage({ src, alt, openUrl }: Props) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const reset = () => { setScale(1); setTx(0); setTy(0); };

  useEffect(() => { reset(); }, [src]);

  const clamp = (s: number) => Math.min(6, Math.max(1, s));

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setScale((s) => clamp(s * (1 + delta)));
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setTx(dragRef.current.tx + (e.clientX - dragRef.current.x));
    setTy(dragRef.current.ty + (e.clientY - dragRef.current.y));
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button type="button" size="sm" variant="outline" onClick={() => setScale((s) => clamp(s * 1.25))}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setScale((s) => clamp(s / 1.25))}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <span className="ml-1">{Math.round(scale * 100)}%</span>
        <span className="ml-auto">滚轮缩放，按住拖动</span>
        {openUrl && (
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={openUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-4 w-4" /> 原图
            </a>
          </Button>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative h-[70vh] w-full overflow-hidden rounded border bg-muted/30 select-none"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onDoubleClick={reset}
        style={{ cursor: scale > 1 ? (dragRef.current ? "grabbing" : "grab") : "zoom-in" }}
      >
        <img
          src={src}
          alt={alt}
          loading="eager"
          decoding="sync"
          draggable={false}
          className="absolute left-1/2 top-1/2 max-h-none max-w-none"
          style={{
            transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            imageRendering: "auto",
            transition: dragRef.current ? "none" : "transform 80ms ease-out",
          }}
          onClick={() => { if (scale === 1) setScale(2); }}
        />
      </div>
    </div>
  );
}