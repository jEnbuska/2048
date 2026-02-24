/**
 * ScoreGraph
 *
 * Renders a compact SVG line chart of completed game scores.
 * A bold coloured line shows the exponential moving average (EMA) of scores,
 * giving a smooth visual of whether the AI population is improving over time.
 * Raw per-game scores are shown as faint dots for context.
 */

interface ScoreGraphProps {
  scores: number[];
  /** Chart height in px (default 120). */
  height?: number;
  /**
   * EMA smoothing factor α ∈ (0, 1].  A smaller value gives a smoother line.
   * Default: 0.08.
   */
  emaAlpha?: number;
}

/** Compute exponential moving average. */
function computeEma(values: number[], alpha: number): number[] {
  return values.reduce<number[]>((acc, v, i) => {
    acc.push(i === 0 ? v : alpha * v + (1 - alpha) * acc[i - 1]);
    return acc;
  }, []);
}

export default function ScoreGraph({
  scores,
  height = 120,
  emaAlpha = 0.08,
}: ScoreGraphProps) {
  if (scores.length < 2) return null;

  // ── Layout constants ──────────────────────────────────────────────────────
  const VW = 860; // SVG viewBox width (scales to container)
  const VH = height;
  const pad = { top: 8, right: 12, bottom: 18, left: 50 };
  const iW = VW - pad.left - pad.right; // inner width
  const iH = VH - pad.top - pad.bottom; // inner height

  // ── Scales ────────────────────────────────────────────────────────────────
  const maxScore = Math.max(...scores, 1);
  const scaleX = (i: number) => pad.left + (i / (scores.length - 1)) * iW;
  const scaleY = (v: number) => pad.top + iH - (v / maxScore) * iH;

  // ── EMA ───────────────────────────────────────────────────────────────────
  const ema = computeEma(scores, emaAlpha);
  const latestEma = ema[ema.length - 1];

  // ── SVG path helpers ──────────────────────────────────────────────────────
  const linePath = (pts: Array<[number, number]>) =>
    pts
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");

  const emaPath = linePath(ema.map((v, i) => [scaleX(i), scaleY(v)]));

  // ── Y-axis ticks ──────────────────────────────────────────────────────────
  const yTickFractions = [0, 0.25, 0.5, 0.75, 1];

  // ── Label for the current EMA value ──────────────────────────────────────
  const emaLabelY = Math.min(
    pad.top + iH - 2,
    Math.max(pad.top + 10, scaleY(latestEma) - 5),
  );

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: `${height}px`, display: "block" }}
      aria-label="Score history chart"
      role="img"
    >
      {/* ── Grid + Y axis ── */}
      {yTickFractions.map((frac) => {
        const y = pad.top + iH - frac * iH;
        const label = Math.round(frac * maxScore).toLocaleString();
        return (
          <g key={frac}>
            <line
              x1={pad.left}
              y1={y}
              x2={pad.left + iW}
              y2={y}
              stroke="#3a3028"
              strokeWidth="1"
            />
            <text
              x={pad.left - 4}
              y={y + 4}
              textAnchor="end"
              fontSize="9"
              fill="#6a5e54"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* ── Raw score dots ── */}
      {scores.map((v, i) => (
        <circle
          key={i}
          cx={scaleX(i)}
          cy={scaleY(v)}
          r="2"
          fill="#4d4438"
          opacity="0.8"
        />
      ))}

      {/* ── EMA line ── */}
      <path
        d={emaPath}
        fill="none"
        stroke="#f49463"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Latest EMA label ── */}
      <text
        x={pad.left + iW}
        y={emaLabelY}
        textAnchor="end"
        fontSize="10"
        fill="#f49463"
        fontWeight="bold"
      >
        avg≈{Math.round(latestEma).toLocaleString()}
      </text>
    </svg>
  );
}
