import { useCallback, useEffect, useRef, useState } from "react";
import type { Cell, Coordinate, TiltDirection } from "../types";
import get2DVectorByTiltDirection from "../utils/get2DVectorByTiltDirection";
import type { WorkerInMessage, WorkerOutMessage } from "../ai/aiWorker";

/** Interval between AI moves in milliseconds. */
const AI_MOVE_INTERVAL_MS = 500;

export interface UseAiPlayerReturn {
  aiEnabled: boolean;
  toggleAi: () => void;
  workerReady: boolean;
}

/**
 * Manages an AI Web Worker that runs the DQN agent in a separate thread.
 * When enabled, the AI periodically selects and applies moves via the
 * provided `onMove` callback.
 */
export default function useAiPlayer(
  cells: Cell[],
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

  // Keep onMove in a ref so the worker callback always uses the latest version
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

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
          break;
        case "ACTION":
          if (aiEnabledRef.current) {
            applyDirection(msg.direction);
          }
          pendingActionRef.current = false;
          break;
        case "ERROR":
          console.error("[AI Worker]", msg.message);
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

  // Start/stop the move interval when AI is toggled
  useEffect(() => {
    if (aiEnabled && workerReady) {
      intervalRef.current = setInterval(() => {
        const worker = workerRef.current;
        if (!worker || pendingActionRef.current) return;
        pendingActionRef.current = true;
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
