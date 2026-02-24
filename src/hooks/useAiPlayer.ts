import { useCallback, useEffect, useRef, useState } from "react";
import type { Cell, Coordinate, TiltDirection } from "../types";
import get2DVectorByTiltDirection from "../utils/get2DVectorByTiltDirection";
import type { WorkerInMessage, WorkerOutMessage } from "../ai/aiWorker";
import { encodeBoardFlat, countEmptyCells } from "../ai/encoding";
import { calculateReward, isGameOver } from "../ai/rewardUtils";
import { getMoveInterval } from "../utils/moveInterval";

/** Auto-save the model every this many completed training steps. */
const SAVE_EVERY = 100;

/** Shared model keys stored in IndexedDB. */
const BEST_MODEL_KEY = "2048-dqn-best";
const POLICY_MODEL_KEY = "2048-dqn-policy";

export interface UseAiPlayerOptions {
  /** Called once when the board reaches a game-over state. */
  onGameOver?: (score: number) => void;
  /**
   * Increment this value to trigger an immediate game reset inside the hook
   * (clears pending experiences and reschedules the next move).
   */
  restartTrigger?: number;
}

export interface UseAiPlayerReturn {
  aiEnabled: boolean;
  toggleAi: () => void;
  workerReady: boolean;
  /** Save the current policy weights to the shared "best" model slot. */
  saveAsBest: () => void;
}

/** Pending experience descriptor – queued when ACTION arrives, consumed when cells update. */
interface PendingExp {
  prevCells: Cell[];
  prevScore: number;
  actionIndex: number;
}

/**
 * Manages an AI Web Worker that runs the DQN agent in a separate thread.
 *
 * Changes from the original single-game version:
 * - Move interval is dynamic: computed from the number of free cells so that
 *   a nearly-empty board moves at ~5 ms and a nearly-full board at ~500 ms.
 * - On startup the worker tries to load the shared "best" model first, then
 *   the regular policy model, before falling back to training from scratch.
 * - Exposes `saveAsBest()` so the caller can persist a high-scoring model to
 *   the shared best-model slot that future workers will load from.
 * - Accepts `onGameOver` and `restartTrigger` options for multi-game use.
 */
export default function useAiPlayer(
  cells: Cell[],
  score: number,
  onMove: (vector: Coordinate<-1 | 0 | 1>) => void,
  options: UseAiPlayerOptions = {},
): UseAiPlayerReturn {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const aiEnabledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingActionRef = useRef(false);

  // Keep aiEnabledRef in sync with state
  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

  // Keep a ref to the latest cells so the timeout always uses fresh state
  const cellsRef = useRef(cells);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  // Keep a ref to the latest score
  const scoreRef = useRef(score);
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  // Keep onMove in a ref so the worker callback always uses the latest version
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // Keep option callbacks in refs
  const onGameOverRef = useRef(options.onGameOver);
  useEffect(() => {
    onGameOverRef.current = options.onGameOver;
  }, [options.onGameOver]);

  // Queue of experiences waiting for the cells to update before being sent
  const pendingExpsRef = useRef<PendingExp[]>([]);
  // State captured right before SELECT_ACTION is sent
  const prevCellsForExpRef = useRef<Cell[]>([]);
  const prevScoreForExpRef = useRef(0);
  // Count of completed training steps, used for periodic saves
  const trainStepCountRef = useRef(0);

  // Load-attempt sequence: 'best' → 'policy' → 'done'
  const loadAttemptRef = useRef<"best" | "policy" | "done" | null>(null);

  // Prevent onGameOver firing more than once per game
  const wasGameOverRef = useRef(false);

  const applyDirection = useCallback((direction: TiltDirection) => {
    const vector = get2DVectorByTiltDirection(direction);
    onMoveRef.current(vector);
  }, []);

  /** Schedule the next SELECT_ACTION with a delay based on the current free-cell count. */
  const scheduleNextMove = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!aiEnabledRef.current) return;

    const freeCells = countEmptyCells(cellsRef.current);
    const delay = getMoveInterval(freeCells);

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      const worker = workerRef.current;
      if (!worker || !aiEnabledRef.current || pendingActionRef.current) return;
      pendingActionRef.current = true;
      prevCellsForExpRef.current = cellsRef.current;
      prevScoreForExpRef.current = scoreRef.current;
      worker.postMessage({
        type: "SELECT_ACTION",
        cells: cellsRef.current,
      } satisfies WorkerInMessage);
    }, delay);
  }, []);

  // Initialize worker on mount
  useEffect(() => {
    const worker = new Worker(
      new URL("../ai/aiWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "READY":
          setWorkerReady(true);
          // Try loading best model first, then regular policy
          loadAttemptRef.current = "best";
          worker.postMessage({
            type: "LOAD_MODEL",
            key: BEST_MODEL_KEY,
          } satisfies WorkerInMessage);
          break;

        case "ACTION":
          if (aiEnabledRef.current) {
            pendingExpsRef.current.push({
              prevCells: prevCellsForExpRef.current,
              prevScore: prevScoreForExpRef.current,
              actionIndex: msg.actionIndex,
            });
            applyDirection(msg.direction);
          }
          pendingActionRef.current = false;
          break;

        case "TRAIN_RESULT":
          trainStepCountRef.current++;
          if (trainStepCountRef.current % SAVE_EVERY === 0) {
            worker.postMessage({
              type: "SAVE_MODEL",
              key: POLICY_MODEL_KEY,
            } satisfies WorkerInMessage);
          }
          break;

        case "SAVE_DONE":
          break;

        case "LOAD_DONE":
          loadAttemptRef.current = "done";
          break;

        case "ERROR":
          if (loadAttemptRef.current === "best") {
            // Best model not found – try the regular policy model
            loadAttemptRef.current = "policy";
            worker.postMessage({
              type: "LOAD_MODEL",
              key: POLICY_MODEL_KEY,
            } satisfies WorkerInMessage);
          } else if (loadAttemptRef.current === "policy") {
            // Policy model not found either – start fresh
            loadAttemptRef.current = "done";
          } else {
            console.error("[AI Worker]", msg.message);
          }
          pendingActionRef.current = false;
          break;

        default:
          break;
      }
    };

    worker.postMessage({ type: "INIT" } satisfies WorkerInMessage);
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [applyDirection]);

  // After each AI move the cells (and possibly score) update.
  // Drain the pending experience queue and schedule the next move.
  useEffect(() => {
    const worker = workerRef.current;
    const gameOver = isGameOver(cells);

    if (gameOver) {
      if (!wasGameOverRef.current) {
        wasGameOverRef.current = true;
        onGameOverRef.current?.(score);
      }
      // Stop scheduling moves once the board is stuck
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Still drain any final experience from the last move
      if (worker && pendingExpsRef.current.length > 0) {
        while (pendingExpsRef.current.length > 0) {
          const exp = pendingExpsRef.current.shift();
          if (!exp) break;
          const state = encodeBoardFlat(exp.prevCells);
          const nextState = encodeBoardFlat(cells);
          const reward = calculateReward(exp.prevCells, cells, exp.prevScore, score, true);
          worker.postMessage({
            type: "REMEMBER",
            experience: { state, action: exp.actionIndex, reward, nextState, done: true },
          } satisfies WorkerInMessage);
          worker.postMessage({ type: "TRAIN_STEP" } satisfies WorkerInMessage);
        }
      }
      return;
    }

    // Transitioning out of game-over means a new game just started (restart)
    if (wasGameOverRef.current) {
      wasGameOverRef.current = false;
      pendingExpsRef.current = [];
      if (aiEnabledRef.current) {
        scheduleNextMove();
      }
      return;
    }

    // Normal game running: drain pending experiences
    if (worker && pendingExpsRef.current.length > 0) {
      while (pendingExpsRef.current.length > 0) {
        const exp = pendingExpsRef.current.shift();
        if (!exp) break;
        const state = encodeBoardFlat(exp.prevCells);
        const nextState = encodeBoardFlat(cells);
        const done = isGameOver(cells);
        const reward = calculateReward(exp.prevCells, cells, exp.prevScore, score, done);
        worker.postMessage({
          type: "REMEMBER",
          experience: { state, action: exp.actionIndex, reward, nextState, done },
        } satisfies WorkerInMessage);
        worker.postMessage({ type: "TRAIN_STEP" } satisfies WorkerInMessage);
      }
      // Schedule next move now that the experience has been recorded
      if (aiEnabledRef.current) {
        scheduleNextMove();
      }
    } else if (aiEnabledRef.current && !pendingActionRef.current && timeoutRef.current === null) {
      // No pending exps and no scheduled move – ensure the loop keeps going
      scheduleNextMove();
    }
  }, [cells, score, scheduleNextMove]);

  // Start/stop the move loop when AI is toggled or worker becomes ready
  useEffect(() => {
    if (aiEnabled && workerReady) {
      scheduleNextMove();
    } else {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [aiEnabled, workerReady, scheduleNextMove]);

  // Handle external restart trigger
  const prevRestartTriggerRef = useRef(options.restartTrigger ?? 0);
  useEffect(() => {
    const trigger = options.restartTrigger ?? 0;
    if (trigger !== prevRestartTriggerRef.current) {
      prevRestartTriggerRef.current = trigger;
      pendingExpsRef.current = [];
      wasGameOverRef.current = false;
      pendingActionRef.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (aiEnabledRef.current) {
        scheduleNextMove();
      }
    }
  }, [options.restartTrigger, scheduleNextMove]);

  const toggleAi = useCallback(() => {
    setAiEnabled((prev) => !prev);
  }, []);

  const saveAsBest = useCallback(() => {
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({
        type: "SAVE_MODEL",
        key: BEST_MODEL_KEY,
      } satisfies WorkerInMessage);
    }
  }, []);

  return { aiEnabled, toggleAi, workerReady, saveAsBest };
}

