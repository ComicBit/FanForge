import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Switch,
} from "./ui";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Wifi, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * FanForge UI (standalone preview)
 * - BIOS-like curve editor with draggable points
 * - Editable settings panel
 * - Simulated live temperature + computed PWM output
 * - Optional API wiring (GET/POST) for ESP32 endpoints
 *
 * Expected ESP32 endpoints (suggested):
 *   GET  /api/status -> { temp_c, pwm_pct, mode, last_update_ms }
 *   GET  /api/config -> { mode, smoothing_mode, points:[{t,p}], min_pwm, max_pwm, slew_pct_per_sec, failsafe_temp, failsafe_pwm }
 *   POST /api/config -> same as config (server validates & persists)
 */

// ---------- helpers ----------
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, digits = 0) => {
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
};

type Point = { t: number; p: number; id: string };

type Mode = "auto" | "manual" | "off";
type SmoothingMode = "linear" | "smooth";

type Config = {
  mode: Mode;
  smoothing_mode: SmoothingMode;
  points: Array<{ t: number; p: number }>;
  min_pwm: number;
  max_pwm: number;
  slew_pct_per_sec: number;
  failsafe_temp: number;
  failsafe_pwm: number;
};

type ToastState = {
  id: number;
  type: "success" | "error";
  title: string;
  message: string;
};

type DeviceStatus = {
  temp_c: number | null;
  pwm_pct: number | null;
  mode: Mode | null;
  last_update_ms: number | null;
};
type TelemetryPoint = {
  ts: number;
  temp: number;
  pwm: number;
};

const DEVICE_POLL_INTERVAL_MS = 1000;
const GRAPH_SAMPLE_INTERVAL_MS = 1000 / 120;
const VALUE_INTERPOLATION_MS = 960;

function useSpringNumber(target: number, enabled: boolean) {
  const [value, setValue] = useState(target);
  const targetRef = useRef(target);
  const fromRef = useRef(target);
  const valueRef = useRef(target);
  const startTsRef = useRef<number>(performance.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    fromRef.current = valueRef.current;
    targetRef.current = target;
    startTsRef.current = performance.now();
  }, [target, enabled]);

  useEffect(() => {
    if (!enabled) {
      valueRef.current = target;
      fromRef.current = target;
      targetRef.current = target;
      setValue(target);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = (now: number) => {
      const t = clamp((now - startTsRef.current) / VALUE_INTERPOLATION_MS, 0, 1);
      const eased = t * t * (3 - 2 * t); // smoothstep
      const next = fromRef.current + (targetRef.current - fromRef.current) * eased;
      valueRef.current = next;
      setValue(next);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, target]);

  return value;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} L${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
  }
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function tempColor(temp: number, min: number, max: number) {
  const u = clamp((temp - min) / Math.max(1e-6, max - min), 0, 1);
  const r = Math.round(37 + (239 - 37) * u);
  const g = Math.round(99 + (68 - 99) * u);
  const b = Math.round(235 + (68 - 235) * u);
  return `rgb(${r}, ${g}, ${b})`;
}

function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative z-30 inline-flex">
      <button
        type="button"
        aria-label={text}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border-0 bg-[#ECF0F3] text-[#4D4E68] transition hover:text-[#34334C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C7CC9]/45 focus-visible:ring-offset-2 shadow-[-0.3rem_-0.3rem_0.6rem_rgba(255,255,255,0.8),0.3rem_0.3rem_0.7rem_rgba(54,85,153,0.2),inset_0.03rem_0.03rem_0.05rem_rgba(255,255,255,0.8),inset_-0.03rem_-0.03rem_0.05rem_rgba(54,85,153,0.15)]"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className={
          "pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-[70] w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[1rem] border-0 bg-[#ECF0F3] p-2.5 text-xs leading-relaxed text-[#4D4E68] shadow-[0.7rem_0.7rem_1.4rem_rgba(54,85,153,0.18),-0.35rem_-0.35rem_1.2rem_rgba(255,255,255,0.72),inset_0.05rem_0.05rem_0.08rem_rgba(255,255,255,0.75),inset_-0.05rem_-0.05rem_0.08rem_rgba(54,85,153,0.14)] transition " +
          (open ? "opacity-100" : "opacity-0")
        }
      >
        {text}
      </span>
    </span>
  );
}

function MetricTimeline({
  values,
  color,
  variant = "pwm",
  yMin = 0,
  yMax = 100,
  width = 320,
  height = 96,
}: {
  values: number[];
  color: string;
  variant?: "temp" | "pwm";
  yMin?: number;
  yMax?: number;
  width?: number;
  height?: number;
}) {
  const pad = 10;
  const safeValues = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const smoothValues: number[] = [];
  for (let i = 0; i < safeValues.length; i++) {
    if (i === 0) smoothValues.push(safeValues[i]);
    else smoothValues.push(smoothValues[i - 1] * 0.78 + safeValues[i] * 0.22);
  }

  const vMin = yMin;
  const vMax = Math.max(vMin + 0.001, yMax);

  const mapX = (i: number) => pad + (i / Math.max(1, safeValues.length - 1)) * (width - pad * 2);
  const mapY = (v: number) => height - pad - ((v - vMin) / Math.max(1e-6, vMax - vMin)) * (height - pad * 2);
  const pts = smoothValues.map((v, i) => ({ x: mapX(i), y: mapY(v) }));
  const d = smoothPath(pts);
  const last = pts[pts.length - 1];
  const lastVal = smoothValues[smoothValues.length - 1];
  const key = `${variant}-${color.replace("#", "")}`;
  const strokeRef = variant === "temp" ? `url(#temp-gradient-${key})` : `url(#fade-${key})`;
  const tempPointer = variant === "temp" ? tempColor(lastVal, yMin, yMax) : color;
  const glowStroke = variant === "temp" ? tempPointer : color;
  const tempStops = variant === "temp"
    ? Array.from({ length: 28 }, (_, idx) => {
        const u = idx / 27;
        const sampleIdx = Math.round(u * (smoothValues.length - 1));
        const v = smoothValues[sampleIdx];
        return { offset: `${Math.round(u * 100)}%`, color: tempColor(v, yMin, yMax) };
      })
    : [];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[96px] w-full">
      <defs>
        <filter
          id={`glow-${key}`}
          filterUnits="userSpaceOnUse"
          x={-24}
          y={-24}
          width={width + 48}
          height={height + 48}
        >
          <feGaussianBlur stdDeviation="3" result="blur" />
        </filter>
        <linearGradient id={`fade-${key}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="55%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0.98" />
        </linearGradient>
        <linearGradient id={`temp-gradient-${key}`} x1="0%" y1="0%" x2="100%" y2="0%">
          {tempStops.map((s, i) => (
            <stop key={`${key}-temp-stop-${i}`} offset={s.offset} stopColor={s.color} stopOpacity={i === 0 ? 0.14 : i > 22 ? 1 : 0.72} />
          ))}
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((u) => {
        const y = pad + u * (height - pad * 2);
        return <line key={u} x1={pad} x2={width - pad} y1={y} y2={y} stroke="rgba(148,163,184,0.2)" strokeDasharray="4 6" />;
      })}
      <path d={d} fill="none" stroke={glowStroke} strokeOpacity="0.38" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter={`url(#glow-${key})`} />
      <path d={d} fill="none" stroke={strokeRef} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r="4.2" fill={variant === "temp" ? tempPointer : color} stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
    </svg>
  );
}

const STORAGE_KEYS = {
  apiBase: "fanTweaker.apiBase",
  useApi: "fanTweaker.useApi",
} as const;

const DEFAULT_CONFIG: Config = {
  mode: "auto",
  smoothing_mode: "smooth",
  // Default curve domain is 15..50°C (BIOS-style). Temps above max saturate at the last point.
  points: [
    { t: 20, p: 20 },
    { t: 30, p: 30 },
    { t: 40, p: 55 },
    { t: 50, p: 100 },
  ],
  min_pwm: 22,
  max_pwm: 100,
  slew_pct_per_sec: 10,
  failsafe_temp: 80,
  failsafe_pwm: 100,
};

function sortPoints(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.t - b.t);
}

function toInternalPoints(cfg: Config): Point[] {
  return cfg.points.map((pt, i) => ({ ...pt, id: `p${i + 1}` }));
}

function toConfig(points: Point[], cfg: Config): Config {
  return {
    ...cfg,
    points: sortPoints(points).map(({ t, p }) => ({ t: round(t, 0), p: round(p, 0) })),
  };
}

function normalizeConfig(cfg: Config): Config {
  return {
    ...cfg,
    points: [...cfg.points]
      .sort((a, b) => a.t - b.t)
      .map((pt) => ({ t: round(pt.t, 0), p: round(pt.p, 0) })),
  };
}

/** Piecewise-linear interpolation on sorted points */
/** Piecewise-linear interpolation on sorted points */
function computeCurvePWM(tempC: number, pointsSorted: Array<{ t: number; p: number }>): number {
  const pts = [...pointsSorted].sort((a, b) => a.t - b.t);
  if (pts.length === 0) return 0;
  if (tempC <= pts[0].t) return pts[0].p;
  if (tempC >= pts[pts.length - 1].t) return pts[pts.length - 1].p;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (tempC >= a.t && tempC <= b.t) {
      const u = (tempC - a.t) / (b.t - a.t);
      return a.p + (b.p - a.p) * u;
    }
  }
  return pts[pts.length - 1].p;
}

/** Monotone cubic (PCHIP-ish) interpolation to avoid overshoot */
function computeCurvePWMSmooth(tempC: number, pointsSorted: Array<{ t: number; p: number }>): number {
  const pts = [...pointsSorted].sort((a, b) => a.t - b.t);
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0].p;

  // clamp outside
  if (tempC <= pts[0].t) return pts[0].p;
  if (tempC >= pts[pts.length - 1].t) return pts[pts.length - 1].p;

  const xs = pts.map((p) => p.t);
  const ys = pts.map((p) => p.p);

  // secants
  const m: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    const dy = ys[i + 1] - ys[i];
    m.push(dy / Math.max(1e-6, dx));
  }

  // tangents
  const t: number[] = new Array(xs.length).fill(0);
  t[0] = m[0];
  t[xs.length - 1] = m[m.length - 1];
  for (let i = 1; i < xs.length - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else t[i] = (m[i - 1] + m[i]) / 2;
  }

  // monotonicity clamp (Fritsch-Carlson)
  for (let i = 0; i < m.length; i++) {
    if (Math.abs(m[i]) < 1e-6) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }

  // find segment
  let i = 0;
  for (; i < xs.length - 1; i++) {
    if (tempC >= xs[i] && tempC <= xs[i + 1]) break;
  }
  const x0 = xs[i], x1 = xs[i + 1];
  const y0 = ys[i], y1 = ys[i + 1];
  const h = x1 - x0;
  const u = (tempC - x0) / Math.max(1e-6, h);

  // Hermite basis
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;

  return h00 * y0 + h10 * h * t[i] + h01 * y1 + h11 * h * t[i + 1];
}

function validateConfig(cfg: Config): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (cfg.points.length < 2) errors.push("Need at least 2 curve points.");
  const pts = [...cfg.points].sort((a, b) => a.t - b.t);
  for (let i = 0; i < pts.length; i++) {
    const { t, p } = pts[i];
    if (!Number.isFinite(t) || !Number.isFinite(p)) errors.push("Curve points must be numbers.");
    if (t < 0 || t > 100) warnings.push("Some temperatures are outside 0..100°C.");
    if (p < 0 || p > 100) errors.push("PWM % must be within 0..100.");
    if (i > 0 && pts[i - 1].t >= t) errors.push("Temperatures must be strictly increasing.");
  }
  if (cfg.min_pwm < 0 || cfg.min_pwm > 100) errors.push("min_pwm must be 0..100.");
  if (cfg.max_pwm < 0 || cfg.max_pwm > 100) errors.push("max_pwm must be 0..100.");
  if (cfg.max_pwm < cfg.min_pwm) errors.push("max_pwm must be >= min_pwm.");
  if (cfg.slew_pct_per_sec < 0 || cfg.slew_pct_per_sec > 100) warnings.push("Slew rate looks unusual (0..100 recommended).");
  if (cfg.failsafe_temp < 0 || cfg.failsafe_temp > 120) warnings.push("Failsafe temperature looks unusual.");
  if (cfg.failsafe_pwm < 0 || cfg.failsafe_pwm > 100) errors.push("failsafe_pwm must be 0..100.");
  if (cfg.smoothing_mode !== "linear" && cfg.smoothing_mode !== "smooth") errors.push("smoothing_mode must be linear or smooth.");

  return { ok: errors.length === 0, errors, warnings };
}

// ---------- chart component ----------
function CurveEditor({
  points,
  setPoints,
  tempC,
  xMin = 15,
  xMax = 50,
  width = 760,
  height = 380,
  pad = 32,
  grid = 1,
  smoothingMode,
  onSmoothingChange,
}: {
  points: Point[];
  setPoints: React.Dispatch<React.SetStateAction<Point[]>>;
  tempC: number;
  xMin?: number;
  xMax?: number;
  width?: number;
  height?: number;
  pad?: number;
  grid?: number;
  smoothingMode: "linear" | "smooth";
  onSmoothingChange: (mode: "linear" | "smooth") => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const isSmooth = smoothingMode === "smooth";

  const yMin = 0;
  const yMax = 100;

  const ptsSorted = useMemo(
    () => sortPoints(points).map((p) => ({ ...p, t: clamp(p.t, xMin, xMax) })),
    [points, xMin, xMax]
  );

  const xScale = (t: number) => {
    const u = (t - xMin) / (xMax - xMin);
    return pad + u * (width - pad * 2);
  };
  const yScale = (p: number) => {
    const u = (p - yMin) / (yMax - yMin);
    return height - pad - u * (height - pad * 2);
  };
  const xInv = (x: number) => {
    const u = (x - pad) / (width - pad * 2);
    return xMin + u * (xMax - xMin);
  };
  const yInv = (y: number) => {
    const u = (height - pad - y) / (height - pad * 2);
    return yMin + u * (yMax - yMin);
  };

  const snap = (v: number) => Math.round(v / grid) * grid;

  // --- monotone cubic smoothing (PCHIP-ish) ---
  const smoothPathD = useMemo(() => {
    const pts = ptsSorted;
    if (pts.length < 2) return "";

    const xs = pts.map((p) => p.t);
    const ys = pts.map((p) => p.p);

    // slopes (secants)
    const m: number[] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const dx = xs[i + 1] - xs[i];
      const dy = ys[i + 1] - ys[i];
      m.push(dy / Math.max(1e-6, dx));
    }

    // tangents
    const t: number[] = new Array(xs.length).fill(0);
    t[0] = m[0];
    t[xs.length - 1] = m[m.length - 1];
    for (let i = 1; i < xs.length - 1; i++) {
      if (m[i - 1] * m[i] <= 0) {
        t[i] = 0;
      } else {
        t[i] = (m[i - 1] + m[i]) / 2;
      }
    }

    // clamp tangents to preserve monotonicity (Fritsch-Carlson)
    for (let i = 0; i < m.length; i++) {
      if (Math.abs(m[i]) < 1e-6) {
        t[i] = 0;
        t[i + 1] = 0;
        continue;
      }
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i];
        t[i + 1] = k * b * m[i];
      }
    }

    const segToBezier = (x0: number, y0: number, x1: number, y1: number, t0: number, t1: number) => {
      const dx = x1 - x0;
      const c1x = x0 + dx / 3;
      const c1y = y0 + (t0 * dx) / 3;
      const c2x = x1 - dx / 3;
      const c2y = y1 - (t1 * dx) / 3;
      return { c1x, c1y, c2x, c2y };
    };

    const moveX = xScale(xs[0]);
    const moveY = yScale(ys[0]);
    let d = `M ${moveX} ${moveY}`;
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xScale(xs[i]);
      const y0 = yScale(ys[i]);
      const x1 = xScale(xs[i + 1]);
      const y1 = yScale(ys[i + 1]);
      const bz = segToBezier(xs[i], ys[i], xs[i + 1], ys[i + 1], t[i], t[i + 1]);
      d += ` C ${xScale(bz.c1x)} ${yScale(bz.c1y)} ${xScale(bz.c2x)} ${yScale(bz.c2y)} ${x1} ${y1}`;
    }
    return d;
  }, [ptsSorted, width, height, pad, xMax]);

  const polyline = useMemo(
    () => ptsSorted.map((pt) => `${xScale(pt.t)},${yScale(pt.p)}`).join(" "),
    [ptsSorted, width, height, pad, xMax]
  );

  const tempLineX = xScale(clamp(tempC, xMin, xMax));

  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragId(id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;

    setPoints((prev) => {
      const sorted = sortPoints(prev);
      const idx = sorted.findIndex((pt) => pt.id === dragId);
      if (idx < 0) return prev;

      const leftBound = idx > 0 ? sorted[idx - 1].t + 1 : xMin;
      const rightBound = idx < sorted.length - 1 ? sorted[idx + 1].t - 1 : xMax;
      const t = clamp(snap(xInv(px)), leftBound, rightBound);
      const p = clamp(snap(yInv(py)), yMin, yMax);

      return sorted.map((pt, i) => (i === idx ? { ...pt, t, p } : pt));
    });
  };

  const onPointerUp = () => setDragId(null);

  const addPoint = () => {
    const s = sortPoints(points);
    const a = s[Math.max(0, s.length - 2)];
    const b = s[Math.max(0, s.length - 1)];
    const t = clamp(Math.round((a.t + b.t) / 2), xMin, xMax);
    const p = clamp(Math.round((a.p + b.p) / 2), yMin, yMax);
    const id = `p${Date.now().toString(36)}`;
    setPoints(sortPoints([...s, { t, p, id }]));
  };

  const removePoint = () => {
    if (points.length <= 2) return;
    setPoints(sortPoints(points.slice(0, -1)));
  };
  const [isPointTableOpen, setIsPointTableOpen] = useState(false);

  return (
    <Card className="rounded-[2rem] border-0 bg-[#ECF0F3] shadow-[1rem_1rem_2rem_rgba(54,85,153,0.15),-0.5rem_-0.5rem_2rem_rgba(255,255,255,0.7),inset_0.1rem_0.1rem_0.1rem_rgba(255,255,255,0.7),inset_-0.1rem_-0.1rem_0.1rem_rgba(54,85,153,0.15)]">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              className={`curve-mode-button initial ${isSmooth ? "press" : ""}`}
              type="button"
              title={isSmooth ? "Curved mode" : "Linear mode"}
              aria-pressed={isSmooth}
              aria-label="Toggle interpolation mode"
              onClick={() => onSmoothingChange(isSmooth ? "linear" : "smooth")}
            >
              <svg className={`curve-mode-icon ${isSmooth ? "width" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
                <path
                  className={`curve-mode-path ${isSmooth ? "svgActive" : ""}`}
                  d="M3.5 16.5C6.2 16.5 6.9 8.2 10 8.2C13.1 8.2 13.8 15.8 17 15.8C19 15.8 20.1 12.8 20.5 11.5"
                />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button variant="secondary" size="sm" onClick={addPoint} className="w-full sm:w-auto">
              Add point
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={removePoint}
              disabled={points.length <= 2}
              className="w-full sm:w-auto"
            >
              Remove
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="rounded-[1.7rem] bg-[#ECF0F3] shadow-[inset_0.75rem_0.75rem_1.45rem_rgba(54,85,153,0.22),inset_-0.5rem_-0.5rem_1.1rem_rgba(255,255,255,0.9),0.12rem_0.12rem_0.15rem_rgba(255,255,255,0.65),-0.12rem_-0.12rem_0.15rem_rgba(54,85,153,0.15)] overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="select-none touch-none w-full h-[300px] sm:h-[340px] md:h-[380px]"
            width={undefined as any}
            height={undefined as any}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <defs>
              <linearGradient id="tempGradient" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.78" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.78" />
              </linearGradient>
              <linearGradient id="curveGlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
              <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="grainTexture">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch" result="noise">
                  <animate attributeName="seed" values="11;13;17;19;23;29;31;37;41;43;47;53;59;61;67;71;73;79" dur="3.6s" repeatCount="indefinite" />
                </feTurbulence>
                <feColorMatrix in="noise" type="saturate" values="0" result="monoNoise" />
                <feComponentTransfer in="monoNoise" result="grain">
                  <feFuncR type="table" tableValues="0.35 0.65" />
                  <feFuncG type="table" tableValues="0.35 0.65" />
                  <feFuncB type="table" tableValues="0.35 0.65" />
                  <feFuncA type="table" tableValues="0 0.65" />
                </feComponentTransfer>
              </filter>
              <filter id="pointKnobShadow" x="-80%" y="-80%" width="260%" height="260%">
                <feDropShadow dx="-1.5" dy="-1.5" stdDeviation="1.2" floodColor="#ffffff" floodOpacity="0.9" />
                <feDropShadow dx="2" dy="2" stdDeviation="1.6" floodColor="#6b7da8" floodOpacity="0.35" />
              </filter>
              <filter id="chartPanelDepth" x="-14%" y="-14%" width="128%" height="128%">
                <feDropShadow dx="-5" dy="-5" stdDeviation="5" floodColor="#ffffff" floodOpacity="0.78" />
                <feDropShadow dx="7" dy="7" stdDeviation="6" floodColor="#6b7da8" floodOpacity="0.28" />
              </filter>
            </defs>

            <g filter="url(#chartPanelDepth)">
              {/* Plot background */}
              <rect x={0} y={0} width={width} height={height} fill="url(#tempGradient)" />
              <rect
                x={pad}
                y={pad}
                width={width - pad * 2}
                height={height - pad * 2}
                fill="#ffffff"
                opacity={0.5}
                filter="url(#grainTexture)"
                style={{ mixBlendMode: "overlay", pointerEvents: "none" }}
              />

              {/* Grid_ATTACH: grid lines */}
              {Array.from({ length: 11 }).map((_, i) => {
                const x = pad + (i / 10) * (width - pad * 2);
                return <line key={`vx-${i}`} x1={x} y1={pad} x2={x} y2={height - pad} stroke="#334155" opacity={0.16} />;
              })}
              {Array.from({ length: 11 }).map((_, i) => {
                const y = pad + (i / 10) * (height - pad * 2);
                return <line key={`hy-${i}`} x1={pad} y1={y} x2={width - pad} y2={y} stroke="#334155" opacity={0.16} />;
              })}

              {/* Axes */}
              <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#0f172a" opacity={0.4} />
              <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#0f172a" opacity={0.4} />

              {/* X-axis ticks every 5°C */}
              {Array.from({ length: Math.floor((xMax - xMin) / 5) + 1 }).map((_, i) => {
                const t = xMin + i * 5;
                const x = xScale(t);
                const major = t % 10 === 0;
                return (
                  <g key={`xtick-${t}`}>
                    <line
                      x1={x}
                      y1={height - pad}
                      x2={x}
                      y2={height - pad + (major ? 9 : 6)}
                      stroke="#0f172a"
                      opacity={major ? 0.65 : 0.45}
                    />
                    <text
                      x={x}
                      y={height - pad + 22}
                      fontSize={major ? 11 : 10}
                      fill="#0f172a"
                      opacity={major ? 0.8 : 0.62}
                      textAnchor="middle"
                    >
                      {t}
                    </text>
                  </g>
                );
              })}

              {/* Labels */}
              <text x={pad} y={pad - 12} fontSize={12} fill="#0f172a" opacity={0.8}>
                PWM %
              </text>
              <text x={width - pad - 52} y={height - 12} fontSize={12} fill="#0f172a" opacity={0.8}>
                Temp °C
              </text>
              {/* Current temp marker */}
              <line x1={tempLineX} y1={pad} x2={tempLineX} y2={height - pad} stroke="#334155" opacity={0.45} strokeDasharray="6 6" />

              {/* Curve */}
              {smoothingMode === "smooth" ? (
                <path d={smoothPathD} fill="none" stroke="url(#curveGlow)" strokeWidth={4} filter="url(#softGlow)" />
              ) : (
                <polyline points={polyline} fill="none" stroke="url(#curveGlow)" strokeWidth={4} filter="url(#softGlow)" />
              )}

              {/* Points */}
              {ptsSorted.map((pt, idx) => {
                const cx = xScale(pt.t);
                const cy = yScale(pt.p);
                const active = dragId === pt.id;
                return (
                  <g key={pt.id}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={13}
                      fill="#ECF0F3"
                      opacity={active ? 0.98 : 0.94}
                      filter="url(#pointKnobShadow)"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={8}
                      fill="#ffffff"
                      opacity={active ? 1 : 0.9}
                      onPointerDown={onPointerDown(pt.id)}
                      style={{ cursor: active ? "grabbing" : "grab" }}
                    />
                    <circle cx={cx} cy={cy} r={10.5} fill="none" stroke="#4D4E68" strokeWidth={active ? 2.25 : 1.5} opacity={active ? 0.3 : 0.16} />
                    <text x={cx + 10} y={cy - 10} fontSize={12} fill="#0f172a" opacity={0.8}>
                      P{idx + 1}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        <div className="mt-3 flex flex-col items-start justify-between gap-2 px-3 pb-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:pb-4">
          <div className="text-xs text-muted-foreground sm:text-sm">
            Drag points (X = temperature, Y = PWM). Range: 0..{xMax}°C.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Temp: {round(tempC, 1)}°C</Badge>
            <Badge variant="secondary">Points: {points.length}</Badge>
            <Badge variant="secondary">Mode: {smoothingMode.toUpperCase()}</Badge>
          </div>
        </div>
        <div className="mt-1 rounded-[1.35rem] bg-[#ECF0F3] p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            aria-expanded={isPointTableOpen}
            aria-controls="point-table-panel"
            onClick={() => setIsPointTableOpen((v) => !v)}
          >
            <span className="text-sm font-semibold text-[#34334C]">Point Table</span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isPointTableOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {isPointTableOpen && (
              <motion.div
                id="point-table-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="mt-3 max-h-[280px] overflow-auto pr-1">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[#ECF0F3] text-muted-foreground">
                      <tr>
                        <th className="w-[3.25rem] py-2 text-left">Point</th>
                        <th className="py-2 text-left">Temp (°C)</th>
                        <th className="py-2 text-left">PWM (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortPoints(points).map((pt, idx) => (
                        <tr key={pt.id}>
                          <td className="w-[3.25rem] py-2 pr-2 font-medium">P{idx + 1}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-1.5">
                              <Slider
                                value={[pt.t]}
                                min={xMin}
                                max={xMax}
                                step={1}
                                onValueChange={(v) => {
                                  const t = v[0];
                                  setPoints((prev) => sortPoints(prev.map((x) => (x.id === pt.id ? { ...x, t } : x))));
                                }}
                              />
                              <span className="w-8 text-left tabular-nums">{round(pt.t, 0)}</span>
                            </div>
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-1.5">
                              <Slider
                                value={[pt.p]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={(v) => {
                                  const p = v[0];
                                  setPoints((prev) => sortPoints(prev.map((x) => (x.id === pt.id ? { ...x, p } : x))));
                                }}
                              />
                              <span className="w-8 text-left tabular-nums">{round(pt.p, 0)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- main component ----------
export default function FanForgePreview() {
  const [smoothingMode, setSmoothingMode] = useState<SmoothingMode>(DEFAULT_CONFIG.smoothing_mode);
  const [apiBase, setApiBase] = useState("http://esp32.local");
  const [useApi, setUseApi] = useState(false);
  const [connected, setConnected] = useState<null | boolean>(null);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isConfigHealthOpen, setIsConfigHealthOpen] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const autoSyncDoneRef = useRef(false);
  const autoApplyInFlightRef = useRef(false);
  const queuedConfigRef = useRef<Config | null>(null);
  const displayedTempRef = useRef(0);
  const displayedPwmRef = useRef(0);

  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [points, setPoints] = useState<Point[]>(toInternalPoints(DEFAULT_CONFIG));
  const [appliedConfig, setAppliedConfig] = useState<Config>(normalizeConfig(DEFAULT_CONFIG));

  // Simulated environment
  const [simTemp, setSimTemp] = useState(41);
  const [curveMin, setCurveMin] = useState(15);
  const [curveMax, setCurveMax] = useState(50);
  const [simRunning, setSimRunning] = useState(true);
  const [simDriftThreshold, setSimDriftThreshold] = useState(0.4);

  // Output simulation with smoothing
  const [pwmOut, setPwmOut] = useState(0);
  const lastUpdateRef = useRef<number>(Date.now());

  const effectiveConfig = useMemo(() => {
    const next = toConfig(points, cfg);
    // Keep cfg in sync with points without causing extra re-renders on every drag.
    return next;
  }, [points, cfg]);

  const validation = useMemo(() => validateConfig(effectiveConfig), [effectiveConfig]);
  const hasPendingChanges = useMemo(
    () => JSON.stringify(normalizeConfig(effectiveConfig)) !== JSON.stringify(normalizeConfig(appliedConfig)),
    [effectiveConfig, appliedConfig]
  );
  const isLiveDeviceConnected = useApi && connected === true;
  const rawDisplayedTemp = isLiveDeviceConnected ? (deviceStatus?.temp_c ?? simTemp) : simTemp;
  const rawDisplayedPwm = isLiveDeviceConnected ? (deviceStatus?.pwm_pct ?? pwmOut) : pwmOut;
  const interpolatedTemp = useSpringNumber(rawDisplayedTemp, isLiveDeviceConnected);
  const interpolatedPwm = useSpringNumber(rawDisplayedPwm, isLiveDeviceConnected);
  const displayedTemp = isLiveDeviceConnected ? interpolatedTemp : rawDisplayedTemp;
  const displayedPwm = isLiveDeviceConnected ? interpolatedPwm : rawDisplayedPwm;

  function pushToast(type: ToastState["type"], title: string, message: string) {
    setToast({ id: Date.now(), type, title, message });
  }

  function getErrorMessage(error: unknown, context: string) {
    if (error instanceof Error) return `${context}: ${error.message}`;
    return `${context}: Unknown error`;
  }

  const targetPWM = useMemo(() => {
    const c = effectiveConfig;
    if (c.mode === "off") return 0;
    if (c.mode === "manual") {
      // In this preview, manual uses first point's PWM as a placeholder.
      return clamp(c.points[0]?.p ?? 0, 0, 100);
    }

    // Curve domain is 0..CURVE_XMAX. Values above saturate to the last point.
    const temp = clamp(simTemp, curveMin, curveMax);

    let pwm =
      c.smoothing_mode === "smooth"
        ? computeCurvePWMSmooth(temp, c.points)
        : computeCurvePWM(temp, c.points);

    pwm = clamp(pwm, c.min_pwm, c.max_pwm);
    if (temp >= c.failsafe_temp) pwm = Math.max(pwm, c.failsafe_pwm);
    return clamp(pwm, 0, 100);
    }, [effectiveConfig, simTemp, curveMin, curveMax]);

  useEffect(() => {
    if (useApi && connected === true) return;
    if (!simRunning) return;
    const id = setInterval(() => {
      // mild temp drift
      setSimTemp((t) => {
        const drift = (Math.random() - 0.5) * simDriftThreshold;
        return clamp(t + drift, curveMin, curveMax);
      });
    }, 1200);
    return () => clearInterval(id);
  }, [simRunning, useApi, connected, curveMin, curveMax, simDriftThreshold]);

  useEffect(() => {
    if (useApi && connected === true) return;
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0.05, (now - lastUpdateRef.current) / 1000);
      lastUpdateRef.current = now;

      const c = effectiveConfig;
      const maxStep = clamp(c.slew_pct_per_sec, 0, 100) * dt;
      setPwmOut((cur) => {
        const delta = targetPWM - cur;
        const step = clamp(delta, -maxStep, maxStep);
        return clamp(cur + step, 0, 100);
      });
    }, 120);
    return () => clearInterval(id);
  }, [effectiveConfig, targetPWM, useApi, connected]);

  useEffect(() => {
    if (!isLiveDeviceConnected) return;
    setSimTemp(0);
    setSimRunning(false);
  }, [isLiveDeviceConnected]);

  useEffect(() => {
    try {
      const persistedApiBase = localStorage.getItem(STORAGE_KEYS.apiBase);
      const persistedUseApi = localStorage.getItem(STORAGE_KEYS.useApi);

      if (persistedApiBase) setApiBase(persistedApiBase);
      if (persistedUseApi === "true" || persistedUseApi === "false") setUseApi(persistedUseApi === "true");
    } catch {
      // no-op: localStorage unavailable
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEYS.apiBase, apiBase);
      localStorage.setItem(STORAGE_KEYS.useApi, String(useApi));
    } catch {
      // no-op: localStorage unavailable
    }
  }, [hydrated, apiBase, useApi]);

  // ---------- API wiring (optional) ----------
  async function apiGet(path: string) {
    const res = await fetch(`${apiBase}${path}`, { method: "GET" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  }

  async function apiPost(path: string, body: any) {
    const payload = JSON.stringify(body);
    const form = new URLSearchParams();
    form.set("payload", payload);
    const res = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  }

  async function pushConfigToDevice(payload: Config, notifyOnError = true) {
    if (autoApplyInFlightRef.current) {
      queuedConfigRef.current = payload;
      return;
    }

    autoApplyInFlightRef.current = true;
    try {
      await apiPost("/api/config", payload);
      setAppliedConfig(normalizeConfig(payload));
      setConnected(true);
    } catch (error) {
      setConnected(false);
      if (notifyOnError) {
        pushToast("error", "Apply failed", getErrorMessage(error, `Unable to save ${apiBase}/api/config`));
      }
    } finally {
      autoApplyInFlightRef.current = false;
      if (queuedConfigRef.current) {
        const queued = queuedConfigRef.current;
        queuedConfigRef.current = null;
        void pushConfigToDevice(queued, true);
      }
    }
  }

  async function testConnection() {
    try {
      setConnected(null);
      const status = await apiGet("/api/status");
      const temp = Number(status.temp_c);
      const pwm = Number(status.pwm_pct);
      const mode = status.mode as Mode;
      setDeviceStatus({
        temp_c: Number.isFinite(temp) ? temp : null,
        pwm_pct: Number.isFinite(pwm) ? pwm : null,
        mode: mode === "auto" || mode === "manual" || mode === "off" ? mode : null,
        last_update_ms: Number.isFinite(Number(status.last_update_ms)) ? Number(status.last_update_ms) : null,
      });
      setConnected(true);
      pushToast("success", "ESP32 reachable", `Connection successful: ${apiBase}/api/status`);
    } catch (error) {
      setConnected(false);
      pushToast("error", "Connection failed", getErrorMessage(error, `Unable to reach ${apiBase}/api/status`));
    }
  }

  async function loadFromDevice(notify = true) {
    try {
      const c = await apiGet("/api/config");
      const normalized: Config = {
        mode: (c.mode ?? "auto") as Mode,
        smoothing_mode: ((c.smoothing_mode ?? DEFAULT_CONFIG.smoothing_mode) as SmoothingMode),
        points: Array.isArray(c.points) ? c.points.map((x: any) => ({ t: Number(x.t), p: Number(x.p) })) : DEFAULT_CONFIG.points,
        min_pwm: Number(c.min_pwm ?? DEFAULT_CONFIG.min_pwm),
        max_pwm: Number(c.max_pwm ?? DEFAULT_CONFIG.max_pwm),
        slew_pct_per_sec: Number(c.slew_pct_per_sec ?? DEFAULT_CONFIG.slew_pct_per_sec),
        failsafe_temp: Number(c.failsafe_temp ?? DEFAULT_CONFIG.failsafe_temp),
        failsafe_pwm: Number(c.failsafe_pwm ?? DEFAULT_CONFIG.failsafe_pwm),
      };
      setCfg(normalized);
      setSmoothingMode(normalized.smoothing_mode);
      setPoints(toInternalPoints(normalized));
      setAppliedConfig(normalizeConfig(normalized));
      setConnected(true);
      if (notify) {
        pushToast("success", "Synced from ESP32", `Loaded config from ${apiBase}/api/config`);
      }
    } catch (error) {
      setConnected(false);
      if (notify) {
        pushToast("error", "Sync failed", getErrorMessage(error, `Unable to load ${apiBase}/api/config`));
      }
    }
  }

  useEffect(() => {
    autoSyncDoneRef.current = false;
    if (!useApi) {
      setConnected(null);
      return;
    }
    setConnected(null);
  }, [useApi, apiBase]);

  useEffect(() => {
    if (!hydrated || !useApi || autoSyncDoneRef.current) return;
    autoSyncDoneRef.current = true;
    loadFromDevice(false);
  }, [hydrated, useApi, apiBase]);

  useEffect(() => {
    if (!hydrated || !useApi || connected !== true) return;
    if (!validation.ok || !hasPendingChanges) return;
    const payload = normalizeConfig(effectiveConfig);
    const timer = window.setTimeout(() => {
      void pushConfigToDevice(payload);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [hydrated, useApi, connected, validation.ok, hasPendingChanges, effectiveConfig]);

  useEffect(() => {
    if (!useApi || connected !== true) return;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const status = await apiGet("/api/status");
        if (cancelled) return;
        const temp = Number(status.temp_c);
        const pwm = Number(status.pwm_pct);
        const mode = status.mode as Mode;
        setDeviceStatus({
          temp_c: Number.isFinite(temp) ? temp : null,
          pwm_pct: Number.isFinite(pwm) ? pwm : null,
          mode: mode === "auto" || mode === "manual" || mode === "off" ? mode : null,
          last_update_ms: Number.isFinite(Number(status.last_update_ms)) ? Number(status.last_update_ms) : null,
        });
      } catch {
        if (!cancelled) setConnected(false);
      }
    };

    pollStatus();
    const id = window.setInterval(pollStatus, DEVICE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [useApi, connected, apiBase]);

  useEffect(() => {
    displayedTempRef.current = displayedTemp;
    displayedPwmRef.current = displayedPwm;
  }, [displayedTemp, displayedPwm]);

  useEffect(() => {
    let rafId = 0;
    let lastSampleTs = 0;
    setTelemetry((prev) => {
      if (prev.length > 0) return prev;
      const now = Date.now();
      return Array.from({ length: 140 }, (_, i) => ({
        ts: now - (140 - i) * Math.round(GRAPH_SAMPLE_INTERVAL_MS),
        temp: displayedTempRef.current,
        pwm: displayedPwmRef.current,
      }));
    });
    const frame = (ts: number) => {
      if (ts - lastSampleTs >= GRAPH_SAMPLE_INTERVAL_MS) {
        lastSampleTs = ts;
        setTelemetry((prev) => {
          const next: TelemetryPoint = {
            ts: Date.now(),
            temp: displayedTempRef.current,
            pwm: displayedPwmRef.current,
          };
          return [...prev, next].slice(-480);
        });
      }
      rafId = window.requestAnimationFrame(frame);
    };
    rafId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const telemetryData = telemetry.length > 1 ? telemetry : [{ ts: Date.now() - 1, temp: displayedTemp, pwm: displayedPwm }, { ts: Date.now(), temp: displayedTemp, pwm: displayedPwm }];
  const statusChip = (() => {
    if (!useApi) return <Badge className="border-amber-200 bg-amber-100 text-amber-800">Preview Mode</Badge>;
    if (connected === null) return <Badge variant="secondary">Checking…</Badge>;
    if (connected) return (
      <Badge className="gap-1" variant="secondary">
        <Wifi className="h-3.5 w-3.5" /> Connected
      </Badge>
    );
    return (
      <Badge className="gap-1" variant="destructive">
        <WifiOff className="h-3.5 w-3.5 animate-[offlineBlink_1.4s_ease-in-out_infinite]" /> <span className="animate-[offlineBlink_1.4s_ease-in-out_infinite]">Offline</span>
      </Badge>
    );
  })();
  return (
    <div className="min-h-screen w-full bg-[#ECF0F3] p-3 sm:p-4 md:p-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-[1280px] space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#34334C]">FanForge</h1>
            <p className="mt-1 text-sm text-[#4D4E68]">Standalone curve editor that can talk to an ESP32 API. ESP remains autonomous.</p>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto">{statusChip}</div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="lg:col-span-2 flex h-full flex-col gap-4">
            <CurveEditor
              points={points}
              setPoints={setPoints}
              tempC={displayedTemp}
              xMin={curveMin}
              xMax={curveMax}
              smoothingMode={smoothingMode}
              onSmoothingChange={(mode) => {
                setSmoothingMode(mode);
                setCfg((c) => ({ ...c, smoothing_mode: mode }));
              }}
            />
            <div className="rounded-[2rem] border-0 bg-[#ECF0F3] p-4 shadow-[1rem_1rem_2rem_rgba(54,85,153,0.15),-0.5rem_-0.5rem_2rem_rgba(255,255,255,0.7),inset_0.1rem_0.1rem_0.1rem_rgba(255,255,255,0.7),inset_-0.1rem_-0.1rem_0.1rem_rgba(54,85,153,0.15)]">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-lg font-semibold"
                aria-expanded={isConfigHealthOpen}
                aria-controls="config-health-panel"
                onClick={() => setIsConfigHealthOpen((v) => !v)}
              >
                <span>Config Health</span>
                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${isConfigHealthOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence initial={false}>
                {isConfigHealthOpen && (
                  <motion.div
                    id="config-health-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="mt-4 space-y-3 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                      style={{ maxHeight: "min(45vh, 22rem)" }}
                    >
                      <div className="flex items-center gap-2">
                        {validation.ok ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-sm">Valid configuration</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm">Needs fixing</span>
                          </>
                        )}
                      </div>

                      {validation.errors.length > 0 && (
                        <div className="rounded-xl border p-3">
                          <div className="text-xs font-medium mb-2">Errors</div>
                          <ul className="list-disc pl-5 space-y-1 text-sm">
                            {validation.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {validation.warnings.length > 0 && (
                        <div className="rounded-xl border p-3">
                          <div className="text-xs font-medium mb-2">Warnings</div>
                          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                            {validation.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="rounded-xl border p-3">
                        <div className="text-xs font-medium mb-2">Payload preview</div>
                        <pre className="text-xs overflow-auto leading-relaxed">
                          {JSON.stringify(effectiveConfig, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex h-full flex-col gap-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Live Output</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-2 sm:gap-3">
                  <div className="rounded-[1.2rem] border-0 bg-[#ECF0F3] p-3">
                    <div className="mb-2 text-xs text-muted-foreground">Temperature</div>
                    <div className="mb-2 text-xl font-semibold sm:mb-3 sm:text-2xl">{round(displayedTemp, 1)}°C</div>
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
                      <MetricTimeline
                        values={telemetryData.map((x) => x.temp)}
                        color="#38bdf8"
                        variant="temp"
                        yMin={curveMin}
                        yMax={curveMax}
                      />
                    </motion.div>
                  </div>
                  <div className="rounded-[1.2rem] border-0 bg-[#ECF0F3] p-3">
                    <div className="mb-2 text-xs text-muted-foreground">PWM Output</div>
                    <div className="mb-2 text-xl font-semibold sm:mb-3 sm:text-2xl">{round(displayedPwm, 0)}%</div>
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: 0.04 }}>
                      <MetricTimeline values={telemetryData.map((x) => x.pwm)} color="#3b82f6" variant="pwm" yMin={0} yMax={100} />
                    </motion.div>
                  </div>
                </div>

                <div className={isLiveDeviceConnected ? "space-y-2 opacity-50 pointer-events-none" : "space-y-2"}>
                  <div className="flex items-center justify-between">
                    <Label>Simulate temperature</Label>
                    <Badge variant="secondary">
                      {isLiveDeviceConnected ? "Live device connected" : `Target ${round(targetPWM, 0)}%`}
                    </Badge>
                  </div>
                  <Slider
                    value={[simTemp]}
                    min={0}
                    max={curveMax}
                    step={0.5}
                    disabled={isLiveDeviceConnected}
                    onValueChange={(v) => setSimTemp(v[0])}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>0°C</span>
                    <span>{curveMax}°C</span>
                  </div>
                </div>

                <div className={isLiveDeviceConnected ? "flex items-start justify-between gap-3 opacity-50 pointer-events-none" : "flex items-start justify-between gap-3"}>
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Temp drift</div>
                    <div className="text-xs text-muted-foreground">Adds small random variation</div>
                  </div>
                  <Switch checked={simRunning} disabled={isLiveDeviceConnected} onCheckedChange={setSimRunning} />
                </div>
                <div className={isLiveDeviceConnected ? "space-y-2 opacity-50 pointer-events-none" : "space-y-2"}>
                  <div className="flex items-center justify-between">
                    <Label>Temp drift threshold (°C)</Label>
                    <Badge variant="secondary">{round(simDriftThreshold, 2)}</Badge>
                  </div>
                  <Slider
                    value={[simDriftThreshold]}
                    min={0.05}
                    max={2}
                    step={0.05}
                    disabled={isLiveDeviceConnected}
                    onValueChange={(v) => setSimDriftThreshold(v[0])}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl flex flex-1 flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Controller Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Mode</Label>
                    <InfoHint text="Controller behavior: Auto follows curve, Manual uses fixed output profile, Off forces 0% PWM." />
                  </div>
                  <Select
                    value={cfg.mode}
                    onValueChange={(v) => setCfg((c) => ({ ...c, mode: v as Mode }))}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Min PWM %</Label>
                    <Input
                      value={cfg.min_pwm}
                      onChange={(e) => setCfg((c) => ({ ...c, min_pwm: clamp(Number(e.target.value), 0, 100) }))}
                      className="rounded-xl"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max PWM %</Label>
                    <Input
                      value={cfg.max_pwm}
                      onChange={(e) => setCfg((c) => ({ ...c, max_pwm: clamp(Number(e.target.value), 0, 100) }))}
                      className="rounded-xl"
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label>Slew % per sec</Label>
                      <InfoHint text="Maximum change rate applied to PWM output each second. Lower values produce softer ramps." />
                    </div>
                    <Badge variant="secondary">{round(cfg.slew_pct_per_sec, 0)}%</Badge>
                  </div>
                  <Slider
                    value={[cfg.slew_pct_per_sec]}
                    min={0}
                    max={60}
                    step={1}
                    onValueChange={(v) => setCfg((c) => ({ ...c, slew_pct_per_sec: v[0] }))}
                  />
                </div>

                <Separator />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Failsafe temp (°C)</Label>
                      <InfoHint text="Temperature threshold that triggers failsafe PWM override to protect hardware." />
                    </div>
                    <Input
                      value={cfg.failsafe_temp}
                      onChange={(e) => setCfg((c) => ({ ...c, failsafe_temp: clamp(Number(e.target.value), 0, 120) }))}
                      className="rounded-xl"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Failsafe PWM %</Label>
                      <InfoHint text="PWM output forced while failsafe temperature condition is active." />
                    </div>
                    <Input
                      value={cfg.failsafe_pwm}
                      onChange={(e) => setCfg((c) => ({ ...c, failsafe_pwm: clamp(Number(e.target.value), 0, 100) }))}
                      className="rounded-xl"
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Connect to device</div>
                    <div className="text-xs text-muted-foreground">Connect to ESP32 endpoints</div>
                  </div>
                  <Switch checked={useApi} onCheckedChange={(v) => {
                    setUseApi(v);
                    setConnected(null);
                    if (!v) setDeviceStatus(null);
                  }} />
                </div>

                <div className={useApi ? "space-y-3" : "space-y-3 opacity-50 pointer-events-none"}>
                  <div className="space-y-2">
                    <Label>API Base URL</Label>
                    <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} className="rounded-xl" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={testConnection} className="w-full gap-2 sm:w-auto">
                      <Wifi className="h-4 w-4" /> Test
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="fixed bottom-3 left-1/2 z-50 w-[calc(100vw-1rem)] max-w-[340px] -translate-x-1/2 rounded-[1.1rem] border-0 bg-[#ECF0F3] p-3 shadow-[0.9rem_0.9rem_1.6rem_rgba(54,85,153,0.2),-0.45rem_-0.45rem_1.2rem_rgba(255,255,255,0.76),inset_0.05rem_0.05rem_0.08rem_rgba(255,255,255,0.7),inset_-0.05rem_-0.05rem_0.08rem_rgba(54,85,153,0.14)] sm:bottom-5 sm:left-auto sm:right-5 sm:w-[340px] sm:translate-x-0"
              style={{
                boxShadow: toast.type === "success"
                  ? "0.9rem 0.9rem 1.6rem rgba(54,85,153,0.2), -0.45rem -0.45rem 1.2rem rgba(255,255,255,0.76), inset 0.15rem 0 0 rgba(16,185,129,0.65), inset 0.05rem 0.05rem 0.08rem rgba(255,255,255,0.7), inset -0.05rem -0.05rem 0.08rem rgba(54,85,153,0.14)"
                  : "0.9rem 0.9rem 1.6rem rgba(54,85,153,0.2), -0.45rem -0.45rem 1.2rem rgba(255,255,255,0.76), inset 0.15rem 0 0 rgba(239,68,68,0.7), inset 0.05rem 0.05rem 0.08rem rgba(255,255,255,0.7), inset -0.05rem -0.05rem 0.08rem rgba(54,85,153,0.14)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-[#34334C]">{toast.title}</div>
                  <div className="text-xs text-[#4D4E68]">{toast.message}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setToast(null)}
                  className="rounded-md px-2 py-1 text-xs text-[#4D4E68] hover:bg-[#dfe6ee]"
                >
                  Close
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
