import { useCallback, useEffect, useRef, useState } from "react";
import type { Cell, Coordinate, TiltDirection } from "../types";
import get2DVectorByTiltDirection from "../utils/get2DVectorByTiltDirection";
import type { WorkerInMessage, WorkerOutMessage } from "../ai/aiWorker";
import { encodeBoardFlat, countEmptyCells } from "../ai/encoding";
import { calculateReward } from "../ai/rewardUtils";

/** Interval between AI moves in milliseconds. */
const AI_MOVE_INTERVAL_MS = 500;

/** Auto-save the model every this many completed training steps. */
const SAVE_EVERY = 100;

export interface UseAiPlayerReturn {
  aiEnabled: boolean;
  toggleAi: () => void;
  workerReady: boolean;
}

/** Pending experience descriptor – queued when ACTION arrives, consumed when cells update. */
interface PendingExp {
  prevCells: Cell[];
  prevScore: number;
  actionIndex: number;
}

/**
 * Manages an AI Web Worker that runs the DQN agent in a separate thread.
 * When enabled, the AI periodically selects and applies moves via the
 * provided `onMove` callback.  After each move the hook sends REMEMBER +
 * TRAIN_STEP so the agent learns from every transition, and periodically
 * sends SAVE_MODEL to persist the trained weights.  On startup it attempts
 * LOAD_MODEL to resume a previous training run.
 */
export default function useAiPlayer(
  cells: Cell[],
  score: number,
  onMove: (vector: Coordinate<-1 | 0 | 1>) => void,
): UseAiPlayerReturn {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const aiEnabledRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingActionRef = useRef(false);

  // Keep aiEnabledRef in sync with state
  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

  // Keep a ref to the latest cells so the interval always uses fresh state
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

  // Queue of experiences waiting for the cells to update before being sent
  const pendingExpsRef = useRef<PendingExp[]>([]);
  // State captured right before SELECT_ACTION is sent
  const prevCellsForExpRef = useRef<Cell[]>([]);
  const prevScoreForExpRef = useRef(0);
  // Count of completed training steps, used for periodic saves
  const trainStepCountRef = useRef(0);
  // Flag set while LOAD_MODEL is in flight so errors are downgraded to warnings
  const loadingModelRef = useRef(false);

  const applyDirection = useCallback((direction: TiltDirection) => {
    const vector = get2DVectorByTiltDirection(direction);
    onMoveRef.current(vector);
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
          // Attempt to resume a previous training run from IndexedDB
          loadingModelRef.current = true;
          worker.postMessage({ type: "LOAD_MODEL" } satisfies WorkerInMessage);
          break;

        case "ACTION":
          if (aiEnabledRef.current) {
            // Queue the experience before applying the move so prevCells / prevScore
            // are still the board state the agent observed.
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
            worker.postMessage({ type: "SAVE_MODEL" } satisfies WorkerInMessage);
          }
          break;

        case "SAVE_DONE":
          // Model persisted – nothing further needed on the main thread
          break;

        case "LOAD_DONE":
          loadingModelRef.current = false;
          break;

        case "ERROR":
          if (loadingModelRef.current) {
            // No saved model found – this is expected on first run
            console.warn("[AI Worker] No saved model found, starting fresh:", msg.message);
            loadingModelRef.current = false;
          } else {
            console.error("[AI Worker]", msg.message);
          }
          pendingActionRef.current = false;
          break;

        default:
          break;
      }
    };

    const initMsg: WorkerInMessage = { type: "INIT" };
    worker.postMessage(initMsg);
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [applyDirection]);

  // After each AI move the cells (and possibly score) update.
  // Drain the pending experience queue: encode the transition and send
  // REMEMBER + TRAIN_STEP to the worker.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !pendingExpsRef.current.length) return;

    while (pendingExpsRef.current.length > 0) {
      const exp = pendingExpsRef.current.shift();
      if (!exp) break;

      const state = encodeBoardFlat(exp.prevCells);
      const nextState = encodeBoardFlat(cells);
      const reward = calculateReward(exp.prevCells, cells, exp.prevScore, score);
      // done = true when the board is completely full; the game will be stuck on the
      // next turn since addNewCell cannot place a tile (full-board game-over proxy).
      const done = countEmptyCells(cells) === 0;

      worker.postMessage({
        type: "REMEMBER",
        experience: { state, action: exp.actionIndex, reward, nextState, done },
      } satisfies WorkerInMessage);

      worker.postMessage({ type: "TRAIN_STEP" } satisfies WorkerInMessage);
    }
  }, [cells, score]);

  // Start/stop the move interval when AI is toggled
  useEffect(() => {
    if (aiEnabled && workerReady) {
      intervalRef.current = setInterval(() => {
        const worker = workerRef.current;
        if (!worker || pendingActionRef.current) return;
        pendingActionRef.current = true;
        // Snapshot the current state so the experience can be built once the
        // move result arrives.
        prevCellsForExpRef.current = cellsRef.current;
        prevScoreForExpRef.current = scoreRef.current;
        const msg: WorkerInMessage = {
          type: "SELECT_ACTION",
          cells: cellsRef.current,
        };
        worker.postMessage(msg);
      }, AI_MOVE_INTERVAL_MS);
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [aiEnabled, workerReady]);

  const toggleAi = useCallback(() => {
    setAiEnabled((prev) => !prev);
  }, []);

  return { aiEnabled, toggleAi, workerReady };
}
