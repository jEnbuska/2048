import { useCallback, useEffect, useRef, useState } from "react";
import type { Cell } from "../types";
import type { WorkerInMessage, WorkerOutMessage } from "../ai/aiWorker";
import { REWARD_WEIGHTS } from "../ai/rewardUtils";
import type { RewardWeights } from "../ai/rewardUtils";

/** Shared model keys stored in IndexedDB. */
export const BEST_MODEL_KEY = "2048-dqn-best";
export const POLICY_MODEL_KEY = "2048-dqn-policy";

export interface UseAiPlayerOptions {
  /** Called once when the board reaches a game-over state. */
  onGameOver?: (score: number) => void;
  /** Called after each completed training step (TRAIN_RESULT received). */
  onTrainStep?: () => void;
  /**
   * Custom reward weights for this worker instance.
   * Defaults to the global REWARD_WEIGHTS when omitted.
   */
  rewardWeights?: RewardWeights;
  /**
   * When true the worker runs the game loop as fast as possible and
   * throttles DISPLAY messages to at most once per 500 ms.
   * When false every move triggers a DISPLAY message.
   */
  speedMode?: boolean;
  /**
   * Called once with the TF.js backend name (e.g. "webgl", "cpu") when the
   * worker reports that it is ready.
   */
  onBackendDetected?: (backend: string) => void;
}

export interface UseAiPlayerReturn {
  aiEnabled: boolean;
  toggleAi: () => void;
  workerReady: boolean;
  /** Save the current policy weights to the shared "best" model slot. */
  saveAsBest: () => void;
  /** Reset the board and restart the game loop immediately. */
  resetGame: () => void;
  /** Cells to render (already throttled by the worker). */
  displayCells: Cell[];
  /** Score to display (from the latest DISPLAY message). */
  displayScore: number;
  /** Whether the game has ended. */
  gameOver: boolean;
}

// Initial empty board so the Grid renders an empty grid before the first DISPLAY.
/**
 * Manages an AI Web Worker that runs the full 2048 game loop.
 *
 * Unlike the previous version this hook no longer drives the game loop from
 * the React side.  The worker owns all board state; it applies moves, computes
 * rewards, trains the DQN, and decides when to push a DISPLAY update to React.
 * React only re-renders when the worker sends a message – at most once every
 * 500 ms in speed mode, or once per move in normal mode.
 */
export default function useAiPlayer(options: UseAiPlayerOptions = {}): UseAiPlayerReturn {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [displayCells, setDisplayCells] = useState<Cell[]>([]);
  const [displayScore, setDisplayScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const aiEnabledRef = useRef(false);
  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

  // Keep option callbacks in refs so worker message handlers always call the
  // current version without causing the worker-init effect to re-run.
  const onGameOverRef = useRef(options.onGameOver);
  useEffect(() => {
    onGameOverRef.current = options.onGameOver;
  }, [options.onGameOver]);

  const onTrainStepRef = useRef(options.onTrainStep);
  useEffect(() => {
    onTrainStepRef.current = options.onTrainStep;
  }, [options.onTrainStep]);

  const onBackendDetectedRef = useRef(options.onBackendDetected);
  useEffect(() => {
    onBackendDetectedRef.current = options.onBackendDetected;
  }, [options.onBackendDetected]);

  // Keep the latest option values in refs so they are always current when
  // START_GAME / RESET_GAME is sent, without triggering extra renders.
  const rewardWeightsRef = useRef<RewardWeights>(options.rewardWeights ?? REWARD_WEIGHTS);
  const speedModeRef = useRef(options.speedMode ?? false);

  // Propagate rewardWeights changes to the running worker.
  useEffect(() => {
    rewardWeightsRef.current = options.rewardWeights ?? REWARD_WEIGHTS;
    workerRef.current?.postMessage({
      type: "SET_REWARD_WEIGHTS",
      weights: rewardWeightsRef.current,
    } satisfies WorkerInMessage);
  }, [options.rewardWeights]);

  // Propagate speedMode changes to the running worker.
  useEffect(() => {
    speedModeRef.current = options.speedMode ?? false;
    workerRef.current?.postMessage({
      type: "SET_SPEED_MODE",
      speedMode: speedModeRef.current,
    } satisfies WorkerInMessage);
  }, [options.speedMode]);

  // Load-attempt sequence: 'best' → 'policy' → 'done'
  const loadAttemptRef = useRef<"best" | "policy" | "done" | null>(null);

  // Initialize worker on mount.
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
          onBackendDetectedRef.current?.(msg.backend);
          // Try loading best model first, then regular policy.
          loadAttemptRef.current = "best";
          worker.postMessage({
            type: "LOAD_MODEL",
            key: BEST_MODEL_KEY,
          } satisfies WorkerInMessage);
          break;

        case "DISPLAY":
          setDisplayCells(msg.cells);
          setDisplayScore(msg.score);
          setGameOver(msg.gameOver);
          break;

        case "GAME_OVER":
          // score and gameOver are already set by the preceding DISPLAY message;
          // call the callback so the arena can record stats.
          onGameOverRef.current?.(msg.score);
          break;

        case "TRAIN_RESULT":
          onTrainStepRef.current?.();
          break;

        case "SAVE_DONE":
          break;

        case "LOAD_DONE":
          loadAttemptRef.current = "done";
          break;

        case "ERROR":
          if (loadAttemptRef.current === "best") {
            // Best model not found – try the regular policy model.
            loadAttemptRef.current = "policy";
            worker.postMessage({
              type: "LOAD_MODEL",
              key: POLICY_MODEL_KEY,
            } satisfies WorkerInMessage);
          } else if (loadAttemptRef.current === "policy") {
            // Policy model not found either – start fresh.
            loadAttemptRef.current = "done";
          } else {
            console.error("[AI Worker]", msg.message);
          }
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
  }, []);

  // Start the game loop once AI is enabled and the worker is ready.
  useEffect(() => {
    if (!aiEnabled || !workerReady) return;
    workerRef.current?.postMessage({
      type: "START_GAME",
      speedMode: speedModeRef.current,
      rewardWeights: rewardWeightsRef.current,
    } satisfies WorkerInMessage);
  }, [aiEnabled, workerReady]);

  const toggleAi = useCallback(() => {
    setAiEnabled((prev) => !prev);
  }, []);

  const resetGame = useCallback(() => {
    setGameOver(false);
    workerRef.current?.postMessage({
      type: "RESET_GAME",
      speedMode: speedModeRef.current,
      rewardWeights: rewardWeightsRef.current,
    } satisfies WorkerInMessage);
  }, []);

  const saveAsBest = useCallback(() => {
    workerRef.current?.postMessage({
      type: "SAVE_MODEL",
      key: BEST_MODEL_KEY,
    } satisfies WorkerInMessage);
  }, []);

  return {
    aiEnabled,
    toggleAi,
    workerReady,
    saveAsBest,
    resetGame,
    displayCells,
    displayScore,
    gameOver,
  };
}

