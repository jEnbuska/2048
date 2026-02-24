import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  memo,
} from "react";
import useAiPlayer from "../../hooks/useAiPlayer";
import { BEST_MODEL_KEY, POLICY_MODEL_KEY } from "../../hooks/useAiPlayer";
import Grid from "../Grid/Grid";
import { REWARD_WEIGHTS } from "../../ai/rewardUtils";
import type { RewardWeights } from "../../ai/rewardUtils";
import { getRandomFunnyName } from "../../utils/funnyNames";
import { deleteModelArtifact, downloadJson, downloadModelJson } from "../../utils/modelStorage";
import ScoreGraph from "./ScoreGraph";
import styles from "./styles.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  achievedAt: string; // ISO date string for easy localStorage serialisation
  rewardWeights?: RewardWeights;
}

const LEADERBOARD_KEY = "2048-leaderboard";
const STATS_KEY = "2048-arena-stats";
const SCORE_HISTORY_KEY = "2048-score-history";
const MAX_LEADERBOARD = 10;
const MAX_WORKERS = 16;
/** Maximum number of game scores retained in the performance graph. */
const MAX_SCORE_HISTORY = 10_000;
/** Maximum number of data points passed to the score graph for rendering. */
const MAX_GRAPH_SCORES = 500;
/** Rolling window sizes used for the score-average tiles. */
const AVG_WINDOW_100 = 100;
const AVG_WINDOW_1000 = 1_000;
const AVG_WINDOW_10000 = 10_000;
/** How often (ms) pending training-step counts and score history are flushed to state/storage. */
const FLUSH_INTERVAL_MS = 2_000;

/**
 * Number of top-performing weight configurations kept in the elite pool.
 * Genetic operators (crossover / selection) draw parents from this pool.
 */
const ELITE_POOL_SIZE = 6;

/**
 * Random perturbation magnitude for reward weights (±40 %).
 * Each arena slot starts with a slightly different weight configuration so
 * that the population explores the weight-hyperparameter space in parallel.
 * Whenever a slot achieves a new overall high score its weights are adopted
 * as the new base for the next generation of slots.
 */
const PERTURB_MAGNITUDE = 0.4;

// Perturbation magnitudes for genetic strategies (smaller = more exploitation).
const ELITISM_MUTATION = 0.1;
const CROSSOVER_MUTATION = 0.2;

// Roulette thresholds for the three genetic strategies in generateEvolved().
const ELITISM_THRESHOLD = 0.33;
const CROSSOVER_THRESHOLD = 0.66;

// ─── Elite pool entry ─────────────────────────────────────────────────────────

interface EliteEntry {
  weights: RewardWeights;
  score: number;
}

// ─── Genetic helpers ──────────────────────────────────────────────────────────

/**
 * Returns a copy of `base` where every weight is randomly perturbed by up to
 * ±`magnitude × 100` %.  Floors keep values in a sensible range.
 */
function perturbWeights(base: RewardWeights, magnitude = PERTURB_MAGNITUDE): RewardWeights {
  const p = (v: number) =>
    Math.max(0.1, v * (1 + (Math.random() * 2 - 1) * magnitude));
  // gameOverPenalty is negative; perturb its magnitude, then negate.
  const penaltyMagnitude = Math.abs(base.gameOverPenalty);
  const perturbedPenalty = -Math.max(
    0.5,
    penaltyMagnitude * (1 + (Math.random() * 2 - 1) * magnitude),
  );
  return {
    mergeBonus: p(base.mergeBonus),
    emptyTiles: p(base.emptyTiles),
    monotonicity: p(base.monotonicity),
    cornerBonus: p(base.cornerBonus),
    smoothness: p(base.smoothness),
    maxTileBonus: p(base.maxTileBonus),
    gameOverPenalty: perturbedPenalty,
  };
}

/**
 * Uniform crossover: each weight is independently taken from either parent
 * with 50 % probability.
 */
function crossoverWeights(a: RewardWeights, b: RewardWeights): RewardWeights {
  const pick = <T,>(x: T, y: T): T => (Math.random() < 0.5 ? x : y);
  return {
    mergeBonus: pick(a.mergeBonus, b.mergeBonus),
    emptyTiles: pick(a.emptyTiles, b.emptyTiles),
    monotonicity: pick(a.monotonicity, b.monotonicity),
    cornerBonus: pick(a.cornerBonus, b.cornerBonus),
    smoothness: pick(a.smoothness, b.smoothness),
    maxTileBonus: pick(a.maxTileBonus, b.maxTileBonus),
    gameOverPenalty: pick(a.gameOverPenalty, b.gameOverPenalty),
  };
}

/**
 * Fitness-proportionate (roulette-wheel) selection from the elite pool.
 * Higher-scoring elites are more likely to be chosen as a parent.
 */
function selectElite(pool: EliteEntry[], fallback: RewardWeights): RewardWeights {
  if (pool.length === 0) return { ...fallback };
  const totalFitness = pool.reduce((s, e) => s + Math.max(1, e.score), 0);
  let r = Math.random() * totalFitness;
  for (const e of pool) {
    r -= Math.max(1, e.score);
    if (r <= 0) return e.weights;
  }
  return pool[pool.length - 1].weights;
}

/**
 * Generate evolved weights for a new agent using a mix of genetic strategies:
 *  • ~33 % – Elitism: copy the best elite with very small perturbation (±10 %)
 *  • ~33 % – Crossover: blend two fitness-selected parents, then mutate (±20 %)
 *  • ~34 % – Exploration: fitness-selected elite + standard mutation (±40 %)
 */
function generateEvolved(pool: EliteEntry[], fallback: RewardWeights): RewardWeights {
  if (pool.length === 0) return perturbWeights(fallback);
  const r = Math.random();
  if (r < ELITISM_THRESHOLD) {
    // Elitism: copy top performer with minimal perturbation
    return perturbWeights(pool[0].weights, ELITISM_MUTATION);
  }
  if (r < CROSSOVER_THRESHOLD && pool.length >= 2) {
    // Crossover two fitness-proportionate parents, then lightly mutate
    const pa = selectElite(pool, fallback);
    const pb = selectElite(pool, fallback);
    return perturbWeights(crossoverWeights(pa, pb), CROSSOVER_MUTATION);
  }
  // Exploration: fitness-proportionate selection + standard mutation
  return perturbWeights(selectElite(pool, fallback));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ArenaStats {
  totalModels: number;
  totalIterations: number;
  /** Running sum of all non-zero game scores (for the all-time average). */
  allTimeSum: number;
  /** Count of all non-zero game scores recorded (for the all-time average). */
  allTimeCount: number;
  /** Precomputed rolling averages – null until the window has enough games. */
  avg100: number | null;
  avg1000: number | null;
  avg10000: number | null;
}

function loadStats(): ArenaStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ArenaStats>;
      return {
        totalModels: parsed.totalModels ?? 0,
        totalIterations: parsed.totalIterations ?? 0,
        allTimeSum: parsed.allTimeSum ?? 0,
        allTimeCount: parsed.allTimeCount ?? 0,
        avg100: parsed.avg100 ?? null,
        avg1000: parsed.avg1000 ?? null,
        avg10000: parsed.avg10000 ?? null,
      };
    }
  } catch {
    // fall through
  }
  return { totalModels: 0, totalIterations: 0, allTimeSum: 0, allTimeCount: 0, avg100: null, avg1000: null, avg10000: null };
}

function saveStats(stats: ArenaStats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore storage errors
  }
}

function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    return raw ? (JSON.parse(raw) as LeaderboardEntry[]) : [];
  } catch {
    return [];
  }
}

function saveLeaderboard(entries: LeaderboardEntry[]) {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage errors
  }
}

function loadScoreHistory(): number[] {
  try {
    const raw = localStorage.getItem(SCORE_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function saveScoreHistory(history: number[]) {
  try {
    localStorage.setItem(
      SCORE_HISTORY_KEY,
      JSON.stringify(history.slice(-MAX_SCORE_HISTORY)),
    );
  } catch {
    // ignore storage errors
  }
}

// ─── ArenaGameSlot ────────────────────────────────────────────────────────────

interface ArenaGameSlotProps {
  /** Stable ID so the worker is created once and never torn down by key changes. */
  id: number;
  autoRestart: boolean;
  /** Per-slot reward weights used by this worker's experience replay. */
  rewardWeights: RewardWeights;
  /**
   * When true the worker runs the game loop as fast as possible and throttles
   * DISPLAY messages to at most once every 500 ms.
   */
  speedMode: boolean;
  onGameOver: (id: number, score: number, saveAsBest: () => void, weights: RewardWeights) => void;
  onTrainStep: () => void;
  /** Only called for slot 0; reports the TF.js backend ("webgl" / "cpu"). */
  onBackendDetected?: (backend: string) => void;
}

const ArenaGameSlot = memo(function ArenaGameSlot({
  id,
  autoRestart,
  rewardWeights,
  speedMode,
  onGameOver,
  onTrainStep,
  onBackendDetected,
}: ArenaGameSlotProps) {
  const handleGameOver = useCallback(
    (finalScore: number, saveAsBest: () => void) => {
      onGameOver(id, finalScore, saveAsBest, rewardWeights);
    },
    [id, onGameOver, rewardWeights],
  );

  const {
    aiEnabled,
    toggleAi,
    workerReady,
    saveAsBest,
    resetGame,
    displayCells,
    displayScore,
    gameOver,
  } = useAiPlayer({
    onGameOver: (s) => handleGameOver(s, saveAsBest),
    onTrainStep,
    rewardWeights,
    speedMode,
    onBackendDetected,
  });

  // Auto-start AI once the worker is ready.
  const aiStartedRef = useRef(false);
  useEffect(() => {
    if (workerReady && !aiStartedRef.current) {
      aiStartedRef.current = true;
      toggleAi();
    }
  }, [workerReady, toggleAi]);

  // Auto-restart when the game ends (if autoRestart is on).
  useEffect(() => {
    if (!autoRestart || !gameOver) return;
    const timer = setTimeout(() => {
      resetGame();
    }, 800);
    return () => clearTimeout(timer);
  }, [gameOver, autoRestart, resetGame]);

  const sortedCells = displayCells.slice().sort((a, b) => a.id - b.id);

  return (
    <div className={`${styles.slot} ${gameOver ? styles.slotGameOver : ""}`}>
      <div className={styles.slotHeader}>
        {speedMode && <span className={styles.slotSpeed}>⚡</span>}
        <span className={styles.slotId}>#{id + 1}</span>
        <span className={styles.slotScore}>{displayScore}</span>
        {!workerReady && <span className={styles.slotStatus}>loading…</span>}
        {workerReady && !aiEnabled && (
          <span className={styles.slotStatus}>ready</span>
        )}
        {gameOver && <span className={styles.slotStatus}>game over</span>}
      </div>
      <div className={styles.slotGrid}>
        <Grid cells={sortedCells} />
      </div>
    </div>
  );
});

// ─── ScoreStats ───────────────────────────────────────────────────────────────

/** Displays the historical score averages for up to 4 rolling windows. */
function windowAvg(scores: number[], n: number): number | null {
  const slice = n > 0 ? scores.slice(-n) : scores;
  if (slice.length === 0) return null;
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

interface ScoreStatsProps {
  stats: ArenaStats;
}

function ScoreStats({ stats }: ScoreStatsProps) {
  const allTimeAvg =
    stats.allTimeCount > 0 ? stats.allTimeSum / stats.allTimeCount : null;
  const windows: Array<{ label: string; avg: number | null }> = [
    { label: "Last 100", avg: stats.avg100 },
    { label: "Last 1,000", avg: stats.avg1000 },
    { label: "Last 10,000", avg: stats.avg10000 },
  ];
  return (
    <div className={styles.scoreStats}>
      <div className={styles.scoreStatItem}>
        <span className={styles.scoreStatLabel}>All-time</span>
        <span className={styles.scoreStatValue}>
          {allTimeAvg !== null ? Math.round(allTimeAvg).toLocaleString() : "—"}
        </span>
      </div>
      {windows.map(({ label, avg }) =>
        avg !== null ? (
          <div key={label} className={styles.scoreStatItem}>
            <span className={styles.scoreStatLabel}>{label}</span>
            <span className={styles.scoreStatValue}>
              {Math.round(avg).toLocaleString()}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

// ─── AiArena ─────────────────────────────────────────────────────────────────

export default function AiArena() {
  const [, startTransition] = useTransition();
  const [workerCount, setWorkerCount] = useState(4);
  const [autoRestart, setAutoRestart] = useState(true);
  const [speedMode, setSpeedMode] = useState(false);
  const [restartTrigger, setRestartTrigger] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(
    loadLeaderboard,
  );
  const bestScoreRef = useRef(
    leaderboard.length > 0 ? leaderboard[0].score : 0,
  );

  // Score history lives in a mutable ref to avoid the O(n) array copy that a
  // functional setState would require on every game-over.  A downsampled slice
  // is flushed to `graphScores` state (≤ MAX_GRAPH_SCORES points) via
  // startTransition so the chart re-renders without blocking urgent work.
  const scoreHistoryRef = useRef<number[]>(loadScoreHistory());

  const [stats, setStats] = useState<ArenaStats>(() => {
    const s = loadStats();
    const h = scoreHistoryRef.current;
    return {
      ...s,
      avg100: h.length >= AVG_WINDOW_100 ? windowAvg(h, AVG_WINDOW_100) : null,
      avg1000: h.length >= AVG_WINDOW_1000 ? windowAvg(h, AVG_WINDOW_1000) : null,
      avg10000: h.length >= AVG_WINDOW_10000 ? windowAvg(h, AVG_WINDOW_10000) : null,
    };
  });

  const [graphScores, setGraphScores] = useState<number[]>(() =>
    scoreHistoryRef.current.slice(-MAX_GRAPH_SCORES),
  );

  // Pending iteration increments are accumulated in a ref and flushed to the
  // stats state every FLUSH_INTERVAL_MS, replacing one setState per training
  // step with at most one every two seconds.
  const pendingIterationsRef = useRef(0);

  // ── Backend label (reported by the first worker) ──────────────────────────
  const [backendLabel, setBackendLabel] = useState<string | null>(null);
  const handleBackendDetected = useCallback((backend: string) => {
    const label =
      backend === "webgl" ? "🟢 GPU (WebGL)"
      : backend === "wasm" ? "🟡 WASM"
      : `🟡 ${backend.toUpperCase()}`;
    setBackendLabel(label);
  }, []);

  // ── Elite pool (in memory) ─────────────────────────────────────────────────
  // Top-N weight configurations ranked by score; rebuilt on every game-over.
  const elitePoolRef = useRef<EliteEntry[]>([]);

  // ── Reward-weight evolution ────────────────────────────────────────────────
  const [bestWeights, setBestWeights] = useState<RewardWeights>(
    () => ({ ...REWARD_WEIGHTS }),
  );
  const bestWeightsRef = useRef(bestWeights);
  useEffect(() => {
    bestWeightsRef.current = bestWeights;
  }, [bestWeights]);

  // Stable per-slot weight arrays.  Initialised on mount with evolved weights
  // and regenerated (from the latest best/elite weights) on every full restart.
  const [slotWeights, setSlotWeights] = useState<RewardWeights[]>(() =>
    Array.from({ length: MAX_WORKERS }, () => perturbWeights(REWARD_WEIGHTS)),
  );

  // Regenerate weights when the user triggers a full restart so each new slot
  // generation explores a different neighbourhood around the best-known weights.
  useEffect(() => {
    setSlotWeights(
      Array.from({ length: MAX_WORKERS }, () =>
        generateEvolved(elitePoolRef.current, bestWeightsRef.current),
      ),
    );
  }, [restartTrigger]);

  // Persist stats whenever they change
  useEffect(() => {
    saveStats(stats);
  }, [stats]);

  // Persist leaderboard whenever it changes
  useEffect(() => {
    saveLeaderboard(leaderboard);
  }, [leaderboard]);

  // Flush pending training-step counts and persist score history every 2 s.
  // This replaces one setState per training step with at most one per interval.
  useEffect(() => {
    const id = setInterval(() => {
      const delta = pendingIterationsRef.current;
      if (delta > 0) {
        pendingIterationsRef.current = 0;
        startTransition(() => {
          setStats((prev) => ({ ...prev, totalIterations: prev.totalIterations + delta }));
        });
      }
      saveScoreHistory(scoreHistoryRef.current);
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  // startTransition is stable and never changes between renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGameOver = useCallback(
    (slotId: number, score: number, saveAsBest: () => void, slotWeights: RewardWeights) => {
      // Capture the best weights NOW (before any state update) so that
      // generateEvolved below always uses the correct value even when a new
      // high-score causes setBestWeights to be queued in the same batch.
      const currentBestWeights =
        score > bestScoreRef.current ? slotWeights : bestWeightsRef.current;

      if (score > bestScoreRef.current) {
        bestScoreRef.current = score;
        saveAsBest();
        setBestWeights(slotWeights);
      }

      // Update elite pool with this result.
      if (score > 0) {
        elitePoolRef.current = [
          ...elitePoolRef.current,
          { weights: slotWeights, score },
        ]
          .sort((a, b) => b.score - a.score)
          .slice(0, ELITE_POOL_SIZE);
      }

      // Evolve weights for the completed slot's next game.  Not deferred so
      // the slot receives fresh weights before its 800 ms restart timer fires.
      setSlotWeights((prev) => {
        const next = [...prev];
        next[slotId] = generateEvolved(elitePoolRef.current, currentBestWeights);
        return next;
      });

      // Zero-score game: only bump the model counter, nothing else to record.
      if (score === 0) {
        startTransition(() => {
          setStats((prev) => ({ ...prev, totalModels: prev.totalModels + 1 }));
        });
        return;
      }

      // Append to history ref – O(1) push instead of the O(n) spread a
      // functional setState would require.
      scoreHistoryRef.current.push(score);
      if (scoreHistoryRef.current.length > MAX_SCORE_HISTORY) {
        scoreHistoryRef.current = scoreHistoryRef.current.slice(-MAX_SCORE_HISTORY);
      }
      const history = scoreHistoryRef.current;

      // Precompute window averages – null when the window is not yet full,
      // which prevents all three averages from showing the same value early on.
      const avg100 = history.length >= AVG_WINDOW_100 ? windowAvg(history, AVG_WINDOW_100) : null;
      const avg1000 = history.length >= AVG_WINDOW_1000 ? windowAvg(history, AVG_WINDOW_1000) : null;
      const avg10000 = history.length >= AVG_WINDOW_10000 ? windowAvg(history, AVG_WINDOW_10000) : null;

      // Snapshot the graph slice now so the transition closure always captures
      // the data current at this game-over, even if the ref is mutated later.
      const graphSlice = history.slice(-MAX_GRAPH_SCORES);

      const entry: LeaderboardEntry = {
        id: crypto.randomUUID(),
        name: getRandomFunnyName(),
        score,
        achievedAt: new Date().toISOString(),
        rewardWeights: slotWeights,
      };

      // Stats, graph and leaderboard are display-only – defer via transition so
      // they never block urgent game renders.
      startTransition(() => {
        setStats((prev) => ({
          totalModels: prev.totalModels + 1,
          totalIterations: prev.totalIterations,
          allTimeSum: prev.allTimeSum + score,
          allTimeCount: prev.allTimeCount + 1,
          avg100,
          avg1000,
          avg10000,
        }));

        setGraphScores(graphSlice);

        setLeaderboard((prev) =>
          [...prev, entry]
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_LEADERBOARD),
        );
      });
    },
    [startTransition],
  );

  const handleTrainStep = useCallback(() => {
    // Accumulate in a ref; the 2-second interval flushes to React state so
    // we avoid one setState (and re-render) per worker training step.
    pendingIterationsRef.current++;
  }, []);

  const restartAll = useCallback(() => {
    setRestartTrigger((t) => t + 1);
  }, []);

  const toggleAutoRestart = useCallback(() => {
    setAutoRestart((v) => !v);
  }, []);

  const toggleSpeedMode = useCallback(() => {
    setSpeedMode((v) => !v);
  }, []);

  const clearLeaderboard = useCallback(() => {
    setLeaderboard([]);
    bestScoreRef.current = 0;
  }, []);

  const clearAll = useCallback(() => {
    // Clear all persisted data: localStorage + IndexedDB models.
    localStorage.removeItem(LEADERBOARD_KEY);
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(SCORE_HISTORY_KEY);
    void deleteModelArtifact(BEST_MODEL_KEY).catch(() => {});
    void deleteModelArtifact(POLICY_MODEL_KEY).catch(() => {});
    // Reset all in-memory state.
    scoreHistoryRef.current = [];
    pendingIterationsRef.current = 0;
    setGraphScores([]);
    setLeaderboard([]);
    setStats({ totalModels: 0, totalIterations: 0, allTimeSum: 0, allTimeCount: 0, avg100: null, avg1000: null, avg10000: null });
    bestScoreRef.current = 0;
    elitePoolRef.current = [];
    setBestWeights({ ...REWARD_WEIGHTS });
    setRestartTrigger((t) => t + 1);
  }, []);

  const exportBestModel = useCallback(() => {
    void downloadModelJson(
      BEST_MODEL_KEY,
      { rewardWeights: bestWeights },
      "2048-best-model.json",
    ).then((found) => {
      if (!found) alert("No saved model found yet – the model is saved automatically every 100 training steps. Let the AI play a little longer.");
    });
  }, [bestWeights]);

  return (
    <div className={styles.arena}>
      {/* ── Controls ── */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Workers</span>
          <div className={styles.workerBtns}>
            {Array.from({ length: MAX_WORKERS }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={`${styles.workerBtn} ${workerCount === n ? styles.workerBtnActive : ""}`}
                onClick={() => setWorkerCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <button className={styles.actionBtn} onClick={restartAll}>
            ↺ Restart All
          </button>
          <button
            className={`${styles.actionBtn} ${autoRestart ? styles.actionBtnActive : ""}`}
            onClick={toggleAutoRestart}
          >
            {autoRestart ? "⟳ Auto-restart ON" : "⟳ Auto-restart OFF"}
          </button>
          <button
            className={`${styles.actionBtn} ${speedMode ? styles.actionBtnActive : ""}`}
            onClick={toggleSpeedMode}
          >
            {speedMode ? "⚡ Speed ON" : "⚡ Speed OFF"}
          </button>
          <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={clearAll}>
            🗑 Clear All
          </button>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>
            Models: {stats.totalModels.toLocaleString()}
          </span>
          <span className={styles.controlLabel}>
            Iterations: {stats.totalIterations.toLocaleString()}
          </span>
          {backendLabel && (
            <span className={styles.controlLabel} title="TensorFlow.js compute backend">
              {backendLabel}
            </span>
          )}
        </div>

        {/* Best weights display – updates whenever a new high-score worker wins */}
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>🧬 Best weights</span>
          <span className={styles.controlLabel} title="merge bonus">
            merge={bestWeights.mergeBonus.toFixed(2)}
          </span>
          <span className={styles.controlLabel} title="empty tiles">
            empty={bestWeights.emptyTiles.toFixed(2)}
          </span>
          <span className={styles.controlLabel} title="monotonicity">
            mono={bestWeights.monotonicity.toFixed(2)}
          </span>
          <span className={styles.controlLabel} title="corner bonus">
            corner={bestWeights.cornerBonus.toFixed(2)}
          </span>
          <span className={styles.controlLabel} title="smoothness">
            smooth={bestWeights.smoothness.toFixed(2)}
          </span>
          <span className={styles.controlLabel} title="max tile bonus">
            maxTile={bestWeights.maxTileBonus.toFixed(2)}
          </span>
          <span className={styles.controlLabel} title="game-over penalty">
            gameover={bestWeights.gameOverPenalty.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── Performance graph ── */}
      {graphScores.length >= 2 && (
        <div className={styles.scoreGraph}>
          <span className={styles.scoreGraphTitle}>📈 Score History</span>
          <ScoreGraph scores={graphScores} />
          <ScoreStats stats={stats} />
        </div>
      )}

      {/* ── Game grid ── */}
      <div
        className={styles.gamesGrid}
        style={
          {
            "--cols": Math.ceil(Math.sqrt(workerCount)),
          } as React.CSSProperties
        }
      >
        {Array.from({ length: workerCount }, (_, id) => (
          <ArenaGameSlot
            key={`${id}-${restartTrigger}`}
            id={id}
            autoRestart={autoRestart}
            rewardWeights={slotWeights[id] ?? { ...REWARD_WEIGHTS }}
            speedMode={speedMode}
            onGameOver={handleGameOver}
            onTrainStep={handleTrainStep}
            onBackendDetected={id === 0 ? handleBackendDetected : undefined}
          />
        ))}
      </div>

      {/* ── Leaderboard ── */}
      <div className={styles.leaderboard}>
        <div className={styles.leaderboardHeader}>
          <span>🏆 Leaderboard</span>
          <div className={styles.leaderboardHeaderActions}>
            <button className={styles.exportModelBtn} onClick={exportBestModel}>
              📥 Export Model
            </button>
            {leaderboard.length > 0 && (
              <button className={styles.clearBtn} onClick={clearLeaderboard}>
                Clear
              </button>
            )}
          </div>
        </div>
        {leaderboard.length === 0 ? (
          <p className={styles.leaderboardEmpty}>
            No scores yet – let the AI play!
          </p>
        ) : (
          <ol className={styles.leaderboardList}>
            {leaderboard.map((entry, i) => (
              <li key={entry.id} className={styles.leaderboardEntry}>
                <span className={styles.rank}>#{i + 1}</span>
                <span className={styles.entryName}>{entry.name}</span>
                <span className={styles.entryScore}>
                  {entry.score.toLocaleString()}
                </span>
                <span className={styles.entryDate}>
                  {new Date(entry.achievedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  className={styles.exportEntryBtn}
                  title="Export weights as JSON"
                  onClick={() => {
                    const { id: _id, ...exportable } = entry;
                    downloadJson(exportable, `2048-weights-${entry.score}.json`);
                  }}
                >
                  ⬇
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
