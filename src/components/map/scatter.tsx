"use client";

import { HandIcon, LassoIcon, MaximizeIcon, MinusIcon, PlusIcon, SquareDashedIcon } from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { IconButton } from "@/components/ui/icon-button";

export type MapKind = "audio" | "text";
export type Tool = "pan" | "lasso" | "box";
/** A position on a map, both axes in [0, 1]. */
export type MapPoint = [number, number];

/** How each clip is painted. Layer 0 is drawn first; layer 3 is emphasised (larger, with a ring). */
export type ScatterStyle = {
  colors: string[];
  alpha: Float32Array;
  layer: Uint8Array;
};

export type ScatterProps = {
  /** Positions, interleaved x0, y0, x1, y1… on the audio map and on the text map. */
  audio: Float32Array;
  text: Float32Array;
  mapKind: MapKind;
  style: ScatterStyle;
  /** 1 for clips filtered out: drawn faintly, never hovered or picked. */
  hidden: Uint8Array;
  /** The query, drawn as a star, on each map. */
  anchor: { audio: MapPoint; text: MapPoint } | null;
  /** Lines from a clip (or the anchor) to other clips. */
  links: { from: number | "anchor"; to: number[] } | null;
  /** Clips numbered 1, 2, 3… next to their dot. */
  ranks: number[];
  selected: number | null;
  hovered: number | null;
  /** A drawn selection outline, on the map it was drawn on. */
  outline: { map: MapKind; polygon: MapPoint[] } | null;
  /** Where to frame the view: changing `key` (or the map) animates to `points`. */
  fit: { key: string; points: (map: MapKind) => MapPoint[]; maxZoom: number };
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
  /** A lasso or box was drawn: its outline in map coordinates. */
  onArea: (polygon: MapPoint[], map: MapKind) => void;
  /** HTML drawn over the canvas, placed in pixels: a clip's dot, or the anchor, where they are now. */
  overlay: (place: Placement, size: Size) => ReactNode;
  label: string;
};

type View = { k: number; tx: number; ty: number };
type Size = { width: number; height: number };
export type Placement = { clip: (index: number) => MapPoint; anchor: MapPoint | null };

const IDENTITY: View = { k: 1, tx: 0, ty: 0 };
const PADDING = 28;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 40;
const ANIMATION_MS = 650;
const INK = "#1a1a19";
const GROUND = "rgba(249,249,246,0.95)";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The square the [0, 1] map is drawn in at zoom 1, centred in the canvas. */
function geometry({ width, height }: Size) {
  const side = Math.max(10, Math.min(width, height) - 2 * PADDING);
  return { side, left: (width - side) / 2, top: (height - side) / 2 };
}

function project(point: MapPoint, view: View, size: Size): MapPoint {
  const g = geometry(size);
  return [(g.left + point[0] * g.side) * view.k + view.tx, (g.top + point[1] * g.side) * view.k + view.ty];
}

function unproject(x: number, y: number, view: View, size: Size): MapPoint {
  const g = geometry(size);
  return [((x - view.tx) / view.k - g.left) / g.side, ((y - view.ty) / view.k - g.top) / g.side];
}

/** The view that frames `points`, leaving room for the overlays at the edges. */
function framing(points: MapPoint[], maxZoom: number, size: Size): View {
  if (points.length === 0 || !size.width) return IDENTITY;
  const g = geometry(size);
  // A group's few outliers (a sound clip deep in the speech region) would frame
  // the whole map: large groups are framed by their 3rd to 97th percentiles.
  const trim = points.length > 40 ? 0.03 : 0;
  const range = (values: number[]) => {
    values.sort((a, b) => a - b);
    const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
    return [at(trim), at(1 - trim)];
  };
  const [minX, maxX] = range(points.map((p) => p[0]));
  const [minY, maxY] = range(points.map((p) => p[1]));
  const boxW = Math.max((maxX - minX) * g.side, 30);
  const boxH = Math.max((maxY - minY) * g.side, 30);
  const k = clamp(Math.min((size.width - 220) / boxW, (size.height - 200) / boxH), 1, maxZoom);
  const cx = g.left + ((minX + maxX) / 2) * g.side;
  const cy = g.top + ((minY + maxY) / 2) * g.side;
  return { k, tx: size.width / 2 - cx * k, ty: size.height / 2 - cy * k };
}

function pointAt(positions: { audio: Float32Array; text: Float32Array }, i: number, blend: number): MapPoint {
  const ax = positions.audio[2 * i];
  const ay = positions.audio[2 * i + 1];
  return [ax + (positions.text[2 * i] - ax) * blend, ay + (positions.text[2 * i + 1] - ay) * blend];
}

function blendAnchor(anchor: { audio: MapPoint; text: MapPoint }, blend: number): MapPoint {
  const [a, t] = [anchor.audio, anchor.text];
  return [a[0] + (t[0] - a[0]) * blend, a[1] + (t[1] - a[1]) * blend];
}

function insidePolygon([x, y]: MapPoint, polygon: MapPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Indices of the clips inside `polygon`, on `map`, leaving out hidden ones. */
export function clipsInside(
  positions: { audio: Float32Array; text: Float32Array },
  hidden: Uint8Array,
  polygon: MapPoint[],
  map: MapKind,
): number[] {
  const out: number[] = [];
  const blend = map === "text" ? 1 : 0;
  for (let i = 0; i < hidden.length; i++) {
    if (!hidden[i] && insidePolygon(pointAt(positions, i, blend), polygon)) out.push(i);
  }
  return out;
}

/**
 * The map's scatter plot: one dot per clip on a canvas (thousands of SVG nodes
 * would be slow), with pan and zoom, lasso and box selection, and an animated
 * switch between the audio map and the text map.
 */
export function Scatter(props: ScatterProps) {
  const { audio, text, mapKind, hidden, tool, onToolChange, overlay, label } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>(IDENTITY);
  const [blend, setBlend] = useState(mapKind === "text" ? 1 : 0);
  const [drawing, setDrawing] = useState<MapPoint[] | null>(null);
  // Mirrors for event handlers and animations, which start from the latest values.
  const viewRef = useRef(view);
  const blendRef = useRef(blend);
  const latest = useRef(props);
  const animation = useRef<number | null>(null);
  const drag = useRef<{ start: MapPoint; last: MapPoint; moved: boolean; tool: Tool; points: MapPoint[] } | null>(null);

  useLayoutEffect(() => {
    viewRef.current = view;
    blendRef.current = blend;
    latest.current = props;
  });

  const stopAnimation = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };

  const animateTo = (target: View, targetBlend: number) => {
    stopAnimation();
    const fromView = viewRef.current;
    const fromBlend = blendRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const e = ease(t);
      setView({
        k: fromView.k + (target.k - fromView.k) * e,
        tx: fromView.tx + (target.tx - fromView.tx) * e,
        ty: fromView.ty + (target.ty - fromView.ty) * e,
      });
      setBlend(fromBlend + (targetBlend - fromBlend) * e);
      animation.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  };

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
    const [cx, cy] = [size.width / 2, size.height / 2];
    animateTo({ k, tx: cx - ((cx - v.tx) * k) / v.k, ty: cy - ((cy - v.ty) * k) / v.k }, blendRef.current);
  };

  // Follow the container's size.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Frame what matters whenever it changes, or the map does: zoom and blend together.
  const fitKey = `${props.fit.key}|${mapKind}|${Math.round(size.width)}x${Math.round(size.height)}`;
  useEffect(() => {
    if (!size.width) return;
    const { fit, mapKind: kind } = latest.current;
    animateTo(framing(fit.points(kind), fit.maxZoom, size), kind === "text" ? 1 : 0);
    return stopAnimation;
    // fitKey stands for the fit, the map and the size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Wheel zoom around the pointer. Not a React handler: it must be able to stop the page scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopAnimation();
      const rect = canvas.getBoundingClientRect();
      const [mx, my] = [event.clientX - rect.left, event.clientY - rect.top];
      setView((v) => {
        const k = clamp(v.k * Math.exp(-event.deltaY * 0.0016), MIN_ZOOM, MAX_ZOOM);
        return { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Paint after every render: a few thousand arcs take a millisecond or two.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    paint(canvas, latest.current, view, blend, size);
  });

  const local = (event: PointerEvent): MapPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  /** The visible clip nearest to (x, y), within 9 px. Emphasised clips win ties. */
  const hit = ([x, y]: MapPoint): number | null => {
    const { style } = latest.current;
    let best: number | null = null;
    let bestDistance = 81;
    for (let i = 0; i < hidden.length; i++) {
      if (hidden[i]) continue;
      const [sx, sy] = project(pointAt({ audio, text }, i, blend), view, size);
      let d = (sx - x) ** 2 + (sy - y) ** 2;
      if (style.layer[i] === 3) d *= 0.5;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = local(event);
    drag.current = { start: p, last: p, moved: false, tool, points: [p] };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const p = local(event);
    const d = drag.current;
    if (!d) {
      const index = hit(p);
      if (index !== latest.current.hovered) props.onHover(index);
      return;
    }
    if (!d.moved && Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 4) {
      d.moved = true;
      stopAnimation();
      props.onHover(null);
    }
    if (d.moved) {
      if (d.tool === "pan") {
        const [dx, dy] = [p[0] - d.last[0], p[1] - d.last[1]];
        setView((v) => ({ k: v.k, tx: v.tx + dx, ty: v.ty + dy }));
      } else {
        if (d.tool === "lasso") {
          const last = d.points[d.points.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) d.points.push(p);
        } else {
          d.points = [d.start, [p[0], d.start[1]], p, [d.start[0], p[1]]];
        }
        setDrawing([...d.points]);
      }
    }
    d.last = p;
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      const index = hit(d.start);
      if (index !== null) props.onPick(index);
      return;
    }
    setDrawing(null);
    if (d.tool !== "pan" && d.points.length >= 3) {
      props.onArea(
        d.points.map(([x, y]) => unproject(x, y, view, size)),
        blend > 0.5 ? "text" : "audio",
      );
    }
  };

  const tools: { value: Tool; label: string; icon: ReactNode }[] = [
    { value: "pan", label: "Pan and zoom", icon: <HandIcon /> },
    { value: "lasso", label: "Lasso select", icon: <LassoIcon /> },
    { value: "box", label: "Box select", icon: <SquareDashedIcon /> },
  ];

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 size-full touch-none"
        style={{ cursor: tool === "pan" ? (props.hovered !== null ? "pointer" : "grab") : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDrawing(null);
        }}
        onPointerLeave={() => {
          if (!drag.current && latest.current.hovered !== null) props.onHover(null);
        }}
      />
      {drawing && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
          <polygon
            points={drawing.map((p) => p.join(",")).join(" ")}
            fill="rgba(26,26,25,0.05)"
            stroke={INK}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {size.width > 0 &&
        overlay(
          {
            clip: (i) => project(pointAt({ audio, text }, i, blend), view, size),
            anchor: props.anchor ? project(blendAnchor(props.anchor, blend), view, size) : null,
          },
          size,
        )}
      <div className="absolute top-3 left-3 flex items-center gap-0.5 rounded-full border bg-card p-1 shadow-[0_2px_6px_rgba(26,26,25,0.06)]">
        {tools.map((option) => (
          <IconButton
            key={option.value}
            label={option.label}
            tooltipSide="bottom"
            variant={tool === option.value ? "default" : "ghost"}
            aria-pressed={tool === option.value}
            onClick={() => onToolChange(option.value)}
          >
            {option.icon}
          </IconButton>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <IconButton label="Zoom in" tooltipSide="bottom" variant="ghost" onClick={() => zoomBy(1.6)}>
          <PlusIcon />
        </IconButton>
        <IconButton label="Zoom out" tooltipSide="bottom" variant="ghost" onClick={() => zoomBy(1 / 1.6)}>
          <MinusIcon />
        </IconButton>
        <IconButton
          label="Reset view"
          tooltipSide="bottom"
          variant="ghost"
          onClick={() => animateTo(IDENTITY, blendRef.current)}
        >
          <MaximizeIcon />
        </IconButton>
      </div>
    </div>
  );
}

function paint(canvas: HTMLCanvasElement, props: ScatterProps, view: View, blend: number, size: Size) {
  const { audio, text, style, hidden, anchor, links, ranks, selected, hovered, outline, mapKind } = props;
  const dpr = window.devicePixelRatio || 1;
  const [w, h] = [Math.round(size.width * dpr), Math.round(size.height * dpr)];
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);

  const count = hidden.length;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y] = project(pointAt({ audio, text }, i, blend), view, size);
    xs[i] = x;
    ys[i] = y;
  }
  const r = clamp(1.7 * Math.pow(view.k, 0.4), 1.7, 5);
  const big = Math.max(r + 1.5, 3.8);
  const dot = (i: number, radius: number) => {
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], radius, 0, Math.PI * 2);
  };

  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < count; i++) {
      if (style.layer[i] !== layer) continue;
      ctx.globalAlpha = style.alpha[i];
      ctx.fillStyle = style.colors[i];
      dot(i, r);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  if (outline && outline.map === mapKind && Math.abs(blend - (mapKind === "text" ? 1 : 0)) < 0.01) {
    ctx.beginPath();
    outline.polygon.forEach((p, i) => {
      const [x, y] = project(p, view, size);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(26,26,25,0.04)";
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const anchorXY = anchor ? project(blendAnchor(anchor, blend), view, size) : null;
  if (links) {
    const from = links.from === "anchor" ? anchorXY : [xs[links.from], ys[links.from]];
    if (from) {
      ctx.strokeStyle = "rgba(26,26,25,0.45)";
      ctx.lineWidth = 1.25;
      for (const j of links.to) {
        ctx.beginPath();
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(xs[j], ys[j]);
        ctx.stroke();
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (style.layer[i] !== 3) continue;
    dot(i, big);
    ctx.fillStyle = style.colors[i];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  if (ranks.length > 0) {
    ctx.font = '500 10.5px "Geist Mono", ui-monospace, monospace';
    ctx.lineJoin = "round";
    ranks.forEach((i, rank) => {
      const [x, y] = [xs[i] + 7, ys[i] - 6];
      ctx.lineWidth = 3;
      ctx.strokeStyle = GROUND;
      ctx.strokeText(String(rank + 1), x, y);
      ctx.fillStyle = INK;
      ctx.fillText(String(rank + 1), x, y);
    });
  }

  if (anchorXY) {
    const [qx, qy] = anchorXY;
    ctx.strokeStyle = "rgba(26,26,25,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(qx, qy, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(qx + dx * 12, qy + dy * 12);
      ctx.lineTo(qx + dx * 24, qy + dy * 24);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j < 10; j++) {
      const radius = j % 2 ? 4.2 : 10;
      const angle = -Math.PI / 2 + (j * Math.PI) / 5;
      ctx.lineTo(qx + radius * Math.cos(angle), qy + radius * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  if (selected !== null) {
    dot(selected, r + 7);
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    dot(selected, Math.max(r + 2, 4.5));
    ctx.fillStyle = style.colors[selected];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  if (hovered !== null && hovered !== selected) {
    dot(hovered, r + 5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}
