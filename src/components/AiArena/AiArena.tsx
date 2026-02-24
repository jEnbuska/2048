import {
  useCallback,
  useEffect,
  useRef,
  useState,
  memo,
} from "react";
import type { Cell, Coordinate } from "../../types";
import addNewCell from "../../utils/addNewCell";
import tilt from "../../utils/tilt";
import useAiPlayer from "../../hooks/useAiPlayer";
import Grid from "../Grid/Grid";
import { isGameOver } from "../../ai/rewardUtils";
import { REWARD_WEIGHTS } from "../../ai/rewardUtils";
import type { RewardWeights } from "../../ai/rewardUtils";
import { getRandomFunnyName } from "../../utils/funnyNames";
import styles from "./styles.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  achievedAt: string; // ISO date string for easy localStorage serialisation
}

const LEADERBOARD_KEY = "2048-leaderboard";
const STATS_KEY = "2048-arena-stats";
const MAX_LEADERBOARD = 10;
const MAX_WORKERS = 16;

/**
 * Random perturbation magnitude for reward weights (±40 %).
 * Each arena slot starts with a slightly different weight configuration so
 * that the population explores the weight-hyperparameter space in parallel.
 * Whenever a slot achieves a new overall high score its weights are adopted
 * as the new base for the next generation of slots.
 */
const PERTURB_MAGNITUDE = 0.4;

/**
 * Returns a copy of `base` where every weight is randomly perturbed by up to
 * ±`PERTURB_MAGNITUDE × 100` %.  Floors keep values in a sensible range.
 */
function perturbWeights(base: RewardWeights): RewardWeights {
  const p = (v: number) =>
    Math.max(0.1, v * (1 + (Math.random() * 2 - 1) * PERTURB_MAGNITUDE));
  // gameOverPenalty is negative; perturb its magnitude, then negate.
  const penaltyMagnitude = Math.abs(base.gameOverPenalty);
  const perturbedPenalty = -Math.max(
    0.5,
    penaltyMagnitude * (1 + (Math.random() * 2 - 1) * PERTURB_MAGNITUDE),
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ArenaStats {
  totalModels: number;
  totalIterations: number;
}

function loadStats(): ArenaStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw
      ? (JSON.parse(raw) as ArenaStats)
      : { totalModels: 0, totalIterations: 0 };
  } catch {
    return { totalModels: 0, totalIterations: 0 };
  }
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

// ─── ArenaGameSlot ────────────────────────────────────────────────────────────

/** Combined state for the slot – avoids a separate display state and
 *  the associated setState-in-effect pattern. */
interface SlotState {
  cells: Cell[];
  score: number;
  /** What the Grid actually renders.  In speed mode this lags behind `cells`
   *  and only updates on notable events (new personal-best score / tile),
   *  throttled to ≤ 50 ms.  In normal mode it always mirrors `cells`. */
  displayCells: Cell[];
  displayScore: number;
}

function createSlotState(): SlotState {
  const cells = addNewCell(addNewCell([]));
  return { cells, score: 0, displayCells: cells, displayScore: 0 };
}

interface ArenaGameSlotProps {
  /** Stable ID so the worker is created once and never torn down by key changes. */
  id: number;
  autoRestart: boolean;
  /** Per-slot reward weights used by this worker's experience replay. */
  rewardWeights: RewardWeights;
  /**
   * When true the AI runs as fast as possible and the grid only re-renders
   * when a new per-slot top-score or new highest-tile is reached, throttled to
   * at most once every 50 ms.
   */
  speedMode: boolean;
  onGameOver: (score: number, saveAsBest: () => void, weights: RewardWeights) => void;
  onTrainStep: () => void;
}

const ArenaGameSlot = memo(function ArenaGameSlot({
  id,
  autoRestart,
  rewardWeights,
  speedMode,
  onGameOver,
  onTrainStep,
}: ArenaGameSlotProps) {
  const [state, setState] = useState<SlotState>(createSlotState);
  const [restartCount, setRestartCount] = useState(0);

  const { cells, score, displayCells, displayScore } = state;

  // Speed-mode tracking refs – never cause a re-render themselves.
  // Accessed inside the setState updater to decide whether to refresh the
  // display layer, avoiding a setState-in-effect anti-pattern.
  const speedModeRef = useRef(speedMode);
  useEffect(() => {
    speedModeRef.current = speedMode;
  }, [speedMode]);
  const topScoreRef = useRef(0);
  const topTileRef = useRef(0);
  const lastDisplayMsRef = useRef(0);

  const updateStateByVector = useCallback(
    (vector: Coordinate<-1 | 0 | 1>) => {
      setState((prevState) => {
        const { score } = prevState;
        const cells = prevState.cells.filter((it) => !it.consumedBy);
        try {
          const nextCells = tilt(vector, cells);
          const nextScore = nextCells
            .filter((cell: Cell) => cell.consumedBy)
            .map((cell) => cell.value)
            .reduce((a, b) => a + b * 2, score);
          const sortById = (a: Cell, b: Cell) => a.id - b.id;
          if (
            JSON.stringify(nextCells.slice().sort(sortById)) ===
            JSON.stringify(cells.slice().sort(sortById))
          ) {
            return prevState;
          }

          const nextCellsWithNew = addNewCell(nextCells);
          const gameOver = isGameOver(nextCellsWithNew);

          // Decide whether to refresh the display layer.
          let { displayCells, displayScore } = prevState;

          if (!speedModeRef.current) {
            // Normal mode: display always mirrors actual state.
            displayCells = nextCellsWithNew;
            displayScore = nextScore;
          } else {
            // Speed mode: only update display on notable events, throttled.
            // maxTile is computed over at most 16 cells – O(1) in practice.
            const activeCells = nextCellsWithNew.filter((c) => !c.consumedBy);
            const maxTile = activeCells.reduce((m, c) => Math.max(m, c.value), 0);
            const isNewTopScore = nextScore > topScoreRef.current;
            const isNewTopTile = maxTile > topTileRef.current;
            if (isNewTopScore) topScoreRef.current = nextScore;
            if (isNewTopTile) topTileRef.current = maxTile;
            const now = Date.now();
            const throttleOk = now - lastDisplayMsRef.current >= 50;
            if (gameOver || ((isNewTopScore || isNewTopTile) && throttleOk)) {
              lastDisplayMsRef.current = now;
              displayCells = nextCellsWithNew;
              displayScore = nextScore;
            }
          }

          return { cells: nextCellsWithNew, score: nextScore, displayCells, displayScore };
        } catch {
          return prevState;
        }
      });
    },
    [],
  );

  const handleGameOver = useCallback(
    (finalScore: number, saveAsBest: () => void) => {
      onGameOver(finalScore, saveAsBest, rewardWeights);
    },
    [onGameOver, rewardWeights],
  );

  const { aiEnabled, toggleAi, workerReady, saveAsBest } = useAiPlayer(
    cells,
    score,
    updateStateByVector,
    {
      onGameOver: (s) => handleGameOver(s, saveAsBest),
      onTrainStep,
      restartTrigger: restartCount,
      rewardWeights,
      speedMode,
    },
  );

  // Auto-start AI once the worker is ready
  const aiStartedRef = useRef(false);
  useEffect(() => {
    if (workerReady && !aiStartedRef.current) {
      aiStartedRef.current = true;
      toggleAi();
    }
  }, [workerReady, toggleAi]);

  // Auto-restart when the game ends (if autoRestart is on)
  useEffect(() => {
    if (!autoRestart || !isGameOver(cells)) return;
    const timer = setTimeout(() => {
      // Reset speed-mode trackers for the new game.
      topScoreRef.current = 0;
      topTileRef.current = 0;
      lastDisplayMsRef.current = 0;
      setState(createSlotState());
      setRestartCount((c) => c + 1);
    }, 800);
    return () => clearTimeout(timer);
  }, [cells, autoRestart]);

  const gameOver = isGameOver(cells);

  return (
    <div className={`${styles.slot} ${gameOver ? styles.slotGameOver : ""}`}>
      <div className={styles.slotHeader}>
        {speedMode && <span className={styles.slotSpeed}>⚡</span>}
        <span className={styles.slotId}>#{id + 1}</span>
        <span className={styles.slotScore}>{score}</span>
        {!workerReady && <span className={styles.slotStatus}>loading…</span>}
        {workerReady && !aiEnabled && (
          <span className={styles.slotStatus}>ready</span>
        )}
        {gameOver && <span className={styles.slotStatus}>game over</span>}
      </div>
      <div className={styles.slotGrid}>
        <Grid cells={displayCells.slice().sort((a, b) => a.id - b.id)} />
        {speedMode && displayCells !== cells && (
          <span className={styles.slotSpeedScore}>{displayScore.toLocaleString()}</span>
        )}
      </div>
    </div>
  );
});

// ─── AiArena ─────────────────────────────────────────────────────────────────

export default function AiArena() {
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

  const [stats, setStats] = useState<ArenaStats>(loadStats);

  // ── Reward-weight evolution ────────────────────────────────────────────────
  // Each slot starts with a randomly perturbed copy of the current best weights.
  // When a slot achieves a new overall high score its weights become the new
  // base so subsequent slots explore the nearby hyperparameter neighbourhood.
  const [bestWeights, setBestWeights] = useState<RewardWeights>(
    () => ({ ...REWARD_WEIGHTS }),
  );
  const bestWeightsRef = useRef(bestWeights);
  useEffect(() => {
    bestWeightsRef.current = bestWeights;
  }, [bestWeights]);

  // Stable per-slot weight arrays.  Initialised on mount with perturbed defaults
  // and regenerated (from the latest best weights) on every full restart.
  const [slotWeights, setSlotWeights] = useState<RewardWeights[]>(() =>
    Array.from({ length: MAX_WORKERS }, () => perturbWeights(REWARD_WEIGHTS)),
  );

  // Regenerate weights when the user triggers a full restart so each new slot
  // generation explores a different neighbourhood around the best-known weights.
  useEffect(() => {
    setSlotWeights(
      Array.from({ length: MAX_WORKERS }, () => perturbWeights(bestWeightsRef.current)),
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

  const handleGameOver = useCallback(
    (score: number, saveAsBest: () => void, slotWeights: RewardWeights) => {
      // Functional update ensures concurrent game-overs from multiple workers
      // are queued and processed sequentially without losing counts.
      setStats((prev) => ({ ...prev, totalModels: prev.totalModels + 1 }));
      if (score > bestScoreRef.current) {
        bestScoreRef.current = score;
        saveAsBest();
        // Evolutionary step: winner's weights become the new base so the next
        // generation of slots explores the surrounding hyperparameter region.
        setBestWeights(slotWeights);
      }
      if (score === 0) return; // Skip trivial scores
      const entry: LeaderboardEntry = {
        id: crypto.randomUUID(),
        name: getRandomFunnyName(),
        score,
        achievedAt: new Date().toISOString(),
      };
      setLeaderboard((prev) =>
        [...prev, entry]
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_LEADERBOARD),
      );
    },
    [],
  );

  const handleTrainStep = useCallback(() => {
    // Functional update ensures concurrent TRAIN_RESULT messages from multiple
    // workers are queued and processed sequentially without losing counts.
    setStats((prev) => ({
      ...prev,
      totalIterations: prev.totalIterations + 1,
    }));
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
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>
            Models: {stats.totalModels.toLocaleString()}
          </span>
          <span className={styles.controlLabel}>
            Iterations: {stats.totalIterations.toLocaleString()}
          </span>
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
          />
        ))}
      </div>

      {/* ── Leaderboard ── */}
      <div className={styles.leaderboard}>
        <div className={styles.leaderboardHeader}>
          <span>🏆 Leaderboard</span>
          {leaderboard.length > 0 && (
            <button className={styles.clearBtn} onClick={clearLeaderboard}>
              Clear
            </button>
          )}
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
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
