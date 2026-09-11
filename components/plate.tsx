"use client";

import { useState } from "react";
import { clsx } from "./clsx";

/* ------------------------------------------------------------- generator */

function rng(seed: number) {
  let a = (Math.imul(seed + 7, 0x6d2b79f5) + 0x9e3779b9) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 400;
const H = 260;

const INK = "var(--c-plate-ink)";
const SPARK = "var(--c-spark)";

type Comp = { rnd: () => number; big: boolean };

/* ---------------------------------------------------------- compositions */

function Halftone({ big }: Comp) {
  const cols = big ? 21 : 15;
  const rows = big ? 14 : 10;
  const sx = W / cols;
  const sy = H / rows;
  const dots = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tx = x / (cols - 1);
      const ty = y / (rows - 1);
      // diagonal gradient falloff, kept below ~30% ink coverage so the plate
      // reads as printed texture rather than a solid block
      const t = tx * 0.76 + ty * 0.24;
      const r = Math.max(0.45, (1 - t * 0.94) * Math.min(sx, sy) * 0.3);
      dots.push(
        <circle
          key={`${x}:${y}`}
          cx={sx * (x + 0.5)}
          cy={sy * (y + 0.5)}
          r={r}
          fill={INK}
          opacity={0.68 + tx * 0.22}
        />,
      );
    }
  }
  return (
    <>
      {dots}
      <rect x={W * 0.68} y={0} width={3} height={H} fill={SPARK} opacity={0.9} />
    </>
  );
}

function Arcs({ rnd, big }: Comp) {
  const cx = 46;
  const cy = 258;
  const step = big ? 22 : 26;
  const arcs = [];
  let i = 0;
  for (let r = step; r < 420; r += step) {
    arcs.push(
      <circle
        key={r}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={INK}
        strokeWidth={i % 4 === 0 ? 1.6 : 0.8}
        opacity={0.28 + (i % 3) * 0.16}
        vectorEffect="non-scaling-stroke"
      />,
    );
    i++;
  }
  const solid = rnd() > 0.5;
  return (
    <>
      {arcs}
      <path
        d={`M ${cx} ${cy} L ${cx + 300} ${cy} A 300 300 0 0 0 ${cx} ${cy - 300} Z`}
        fill={INK}
        opacity={0.09}
      />
      {solid && <circle cx={cx + 132} cy={cy - 132} r={7} fill={SPARK} />}
      <rect
        x={0}
        y={cy - 1}
        width={W}
        height={1}
        fill={INK}
        opacity={0.35}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

function Stripes({ rnd, big }: Comp) {
  const bars = [];
  let x = 0;
  let n = 0;
  const min = big ? 3 : 5;
  while (x < W) {
    const w = min + rnd() * (big ? 22 : 30);
    const tall = rnd() > 0.82;
    bars.push(
      <rect
        key={n}
        x={x}
        y={0}
        width={Math.max(1, tall ? 2.4 : 1)}
        height={H}
        fill={INK}
        opacity={tall ? 0.85 : 0.22 + rnd() * 0.34}
        vectorEffect="non-scaling-stroke"
      />,
    );
    x += w;
    n++;
  }
  return (
    <>
      {bars}
      <rect x={0} y={H * 0.62} width={W} height={2} fill={SPARK} opacity={0.9} />
    </>
  );
}

function Bands({ rnd, big }: Comp) {
  const rows = big ? 13 : 10;
  const h = H / rows;
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => {
        const w = (0.22 + rnd() * 0.78) * W;
        const accent = i === Math.floor(rows * 0.62);
        return (
          <rect
            key={i}
            x={0}
            y={i * h + h * 0.18}
            width={accent ? W : w}
            height={accent ? h * 0.64 : h * 0.4}
            fill={accent ? SPARK : INK}
            opacity={accent ? 0.92 : 0.24 + (i / rows) * 0.5}
          />
        );
      })}
    </>
  );
}

function Grid({ rnd, big }: Comp) {
  const cols = big ? 13 : 9;
  const rows = big ? 8 : 6;
  const cw = W / cols;
  const ch = H / rows;
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const r = rnd();
      const filled = r > 0.86;
      const accent = r > 0.965;
      cells.push(
        <rect
          key={`${x}:${y}`}
          x={x * cw + cw * 0.16}
          y={y * ch + ch * 0.16}
          width={cw * 0.68}
          height={ch * 0.68}
          fill={accent ? SPARK : filled ? INK : "none"}
          opacity={accent ? 0.95 : filled ? 0.72 : 0}
          stroke={accent || filled ? "none" : INK}
          strokeWidth={0.8}
          strokeOpacity={0.42}
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
  }
  return <>{cells}</>;
}

function Hatch({ big }: Comp) {
  const gap = big ? 9 : 12;
  return (
    <>
      <defs>
        <pattern
          id="ff-hatch"
          width={gap}
          height={gap}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={gap}
            stroke={INK}
            strokeWidth={1.4}
            opacity="0.55"
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#ff-hatch)" />
      <polygon points={`0,${H} ${W * 0.62},${H} ${W},0 ${W * 0.36},0`} fill={INK} opacity={0.16} />
      <rect x={W * 0.66} y={H * 0.22} width={W * 0.2} height={H * 0.56} fill={INK} opacity={0.88} />
      <circle cx={W * 0.3} cy={H * 0.34} r={9} fill={SPARK} />
    </>
  );
}

function Horizon({ rnd, big }: Comp) {
  const cy = H * 0.56;
  const r = big ? 78 : 68;
  return (
    <>
      {Array.from({ length: 11 }).map((_, i) => (
        <rect
          key={i}
          x={0}
          y={H * 0.12 + i * (H * 0.075)}
          width={i % 4 === 3 ? W : W * (0.3 + rnd() * 0.68)}
          height={1}
          fill={INK}
          opacity={0.3}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle
        cx={W * 0.62}
        cy={cy}
        r={r + 14}
        fill="none"
        stroke={INK}
        strokeWidth={1}
        opacity={0.4}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={W * 0.62} cy={cy} r={r} fill={INK} opacity={0.14} />
      <circle cx={W * 0.62} cy={cy} r={r * 0.42} fill={SPARK} opacity={0.9} />
      <rect x={0} y={cy + r + 26} width={W} height={3} fill={INK} opacity={0.9} />
    </>
  );
}

function Numeral({ rnd, big }: Comp) {
  const glyphs = ["11", "R", "§", "09", "¶", "26"];
  const g = glyphs[Math.floor(rnd() * glyphs.length)];
  return (
    <>
      <text
        x={-14}
        y={H * 0.86}
        fontFamily="var(--font-display)"
        fontSize={big ? 330 : 300}
        fill={INK}
        opacity={0.2}
      >
        {g}
      </text>
      <rect
        x={0}
        y={H * 0.86}
        width={W}
        height={1}
        fill={INK}
        opacity={0.6}
        vectorEffect="non-scaling-stroke"
      />
      <rect x={0} y={H * 0.86 + 8} width={W * 0.42} height={2} fill={SPARK} />
      {Array.from({ length: 7 }).map((_, i) => (
        <rect
          key={i}
          x={W * 0.6}
          y={H * 0.1 + i * 9}
          width={W * (0.16 + rnd() * 0.24)}
          height={1}
          fill={INK}
          opacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

const COMPOSITIONS = [Halftone, Arcs, Stripes, Bands, Grid, Hatch, Horizon, Numeral];

/* ---------------------------------------------------------------- export */

export function Plate({
  seed,
  className,
  big = false,
  bordered = false,
}: {
  seed: number;
  className?: string;
  big?: boolean;
  bordered?: boolean;
}) {
  const Comp =
    COMPOSITIONS[((seed % COMPOSITIONS.length) + COMPOSITIONS.length) % COMPOSITIONS.length];
  const rnd = rng(seed * 977 + 13);
  return (
    <div
      className={clsx(
        "relative overflow-hidden bg-plate",
        bordered && "ring-1 ring-rule ring-inset",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <Comp rnd={rnd} big={big} />
      </svg>
    </div>
  );
}

/** The firefly: a single point of light. Used for brand, unread, and focus. */
export function Firefly({
  size = 8,
  className,
  glow = true,
  pulse = false,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={clsx("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {glow && (
        <span
          className={clsx("absolute rounded-full bg-spark blur-[3px]", pulse && "ff-glow")}
          style={{ inset: -size * 0.55 }}
        />
      )}
      <span className={clsx("absolute inset-0 rounded-full bg-spark", pulse && "ff-pulse")} />
    </span>
  );
}

/**
 * A story's artwork is either the publisher's own photograph or a generated
 * plate. If a remote image fails, the plate is already behind it, so the
 * layout never collapses.
 */
export function Media({
  seed,
  src,
  alt,
  className,
  big = false,
  sizes,
}: {
  seed: number;
  src?: string;
  alt?: string;
  className?: string;
  big?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);

  /*
   * Two different things wear the same slot, and they must not be confused.
   *
   * No `src` means the plate *is* the artwork — only the sample edition does
   * this, and it is labelled. A `src` means the publisher supplied a picture;
   * if it fails to load we say so rather than drawing something in its place,
   * because invented artwork in a photograph's slot reads as the article's own
   * image and does not exist on the page the story links to.
   */
  if (!src) return <Plate seed={seed} big={big} className={className} bordered />;

  return (
    <div className={clsx("relative overflow-hidden bg-plate", className)}>
      {failed ? (
        <span className="mono absolute inset-0 flex items-center justify-center text-[9px] tracking-[0.14em] text-ink4 uppercase">
          Image unavailable
        </span>
      ) : (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          sizes={sizes}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

export function hasArt(story: { plate?: number; image?: string }): boolean {
  return story.plate !== undefined || Boolean(story.image);
}
