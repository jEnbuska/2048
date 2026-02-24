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

function createGameState() {
  const initialCells = addNewCell([]);
  return { cells: addNewCell(initialCells), score: 0 };
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

interface ArenaGameSlotProps {
  /** Stable ID so the worker is created once and never torn down by key changes. */
  id: number;
  autoRestart: boolean;
  onGameOver: (score: number, saveAsBest: () => void) => void;
  onTrainStep: () => void;
}

const ArenaGameSlot = memo(function ArenaGameSlot({
  id,
  autoRestart,
  onGameOver,
  onTrainStep,
}: ArenaGameSlotProps) {
  const [{ cells, score }, setState] = useState(createGameState);
  const [restartCount, setRestartCount] = useState(0);

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
          return { cells: addNewCell(nextCells), score: nextScore };
        } catch {
          return prevState;
        }
      });
    },
    [],
  );

  const handleGameOver = useCallback(
    (finalScore: number, saveAsBest: () => void) => {
      onGameOver(finalScore, saveAsBest);
    },
    [onGameOver],
  );

  const { aiEnabled, toggleAi, workerReady, saveAsBest } = useAiPlayer(
    cells,
    score,
    updateStateByVector,
    {
      onGameOver: (s) => handleGameOver(s, saveAsBest),
      onTrainStep,
      restartTrigger: restartCount,
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
      setState(createGameState());
      setRestartCount((c) => c + 1);
    }, 800);
    return () => clearTimeout(timer);
  }, [cells, autoRestart]);

  const gameOver = isGameOver(cells);

  return (
    <div className={`${styles.slot} ${gameOver ? styles.slotGameOver : ""}`}>
      <div className={styles.slotHeader}>
        <span className={styles.slotId}>#{id + 1}</span>
        <span className={styles.slotScore}>{score}</span>
        {!workerReady && <span className={styles.slotStatus}>loading…</span>}
        {workerReady && !aiEnabled && (
          <span className={styles.slotStatus}>ready</span>
        )}
        {gameOver && <span className={styles.slotStatus}>game over</span>}
      </div>
      <div className={styles.slotGrid}>
        <Grid cells={cells.slice().sort((a, b) => a.id - b.id)} />
      </div>
    </div>
  );
});

// ─── AiArena ─────────────────────────────────────────────────────────────────

export default function AiArena() {
  const [workerCount, setWorkerCount] = useState(4);
  const [autoRestart, setAutoRestart] = useState(true);
  const [restartTrigger, setRestartTrigger] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(
    loadLeaderboard,
  );
  const bestScoreRef = useRef(
    leaderboard.length > 0 ? leaderboard[0].score : 0,
  );

  const [stats, setStats] = useState<ArenaStats>(loadStats);

  // Persist stats whenever they change
  useEffect(() => {
    saveStats(stats);
  }, [stats]);

  // Persist leaderboard whenever it changes
  useEffect(() => {
    saveLeaderboard(leaderboard);
  }, [leaderboard]);

  const handleGameOver = useCallback(
    (score: number, saveAsBest: () => void) => {
      // Functional update ensures concurrent game-overs from multiple workers
      // are queued and processed sequentially without losing counts.
      setStats((prev) => ({ ...prev, totalModels: prev.totalModels + 1 }));
      if (score > bestScoreRef.current) {
        bestScoreRef.current = score;
        saveAsBest();
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
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>
            Models: {stats.totalModels.toLocaleString()}
          </span>
          <span className={styles.controlLabel}>
            Iterations: {stats.totalIterations.toLocaleString()}
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
