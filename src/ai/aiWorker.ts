/**
 * AI Web Worker
 *
 * Runs the DQN agent in a dedicated thread so model inference and training
 * never block React's UI thread or animation frames.
 *
 * Message protocol
 * ──────────────────────────────────────────────────────────────────────────
 * Main → Worker  (WorkerInMessage)
 *   { type: "INIT",          config?: DQNConfig }
 *   { type: "SELECT_ACTION", cells: Cell[] }
 *   { type: "REMEMBER",      experience: Experience }
 *   { type: "TRAIN_STEP" }
 *   { type: "SAVE_MODEL" }
 *   { type: "LOAD_MODEL" }
 *
 * Worker → Main  (WorkerOutMessage)
 *   { type: "READY" }
 *   { type: "ACTION",        direction: TiltDirection }
 *   { type: "TRAIN_RESULT",  loss: number | null }
 *   { type: "SAVE_DONE" }
 *   { type: "LOAD_DONE" }
 *   { type: "ERROR",         message: string }
 */

import "@tensorflow/tfjs"; // registers WebGL / CPU backend
import { DQNAgent } from "./dqnAgent";
import type { DQNConfig, Experience } from "./dqnAgent";
import type { Cell, TiltDirection } from "../types";

// ─── Message types ────────────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: "INIT"; config?: DQNConfig }
  | { type: "SELECT_ACTION"; cells: Cell[] }
  | { type: "REMEMBER"; experience: Experience }
  | { type: "TRAIN_STEP" }
  | { type: "SAVE_MODEL" }
  | { type: "LOAD_MODEL" };

export type WorkerOutMessage =
  | { type: "READY" }
  | { type: "ACTION"; direction: TiltDirection }
  | { type: "TRAIN_RESULT"; loss: number | null }
  | { type: "SAVE_DONE" }
  | { type: "LOAD_DONE" }
  | { type: "ERROR"; message: string };

// ─── Worker logic ─────────────────────────────────────────────────────────────

let agent: DQNAgent | null = null;

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "INIT":
        agent = new DQNAgent(msg.config);
        self.postMessage({ type: "READY" } satisfies WorkerOutMessage);
        break;

      case "SELECT_ACTION": {
        if (!agent) throw new Error("Agent not initialised");
        const direction = agent.selectActionFromCells(msg.cells);
        self.postMessage({
          type: "ACTION",
          direction,
        } satisfies WorkerOutMessage);
        break;
      }

      case "REMEMBER":
        agent?.remember(msg.experience);
        break;

      case "TRAIN_STEP": {
        if (!agent) throw new Error("Agent not initialised");
        const loss = await agent.trainStep();
        self.postMessage({
          type: "TRAIN_RESULT",
          loss,
        } satisfies WorkerOutMessage);
        break;
      }

      case "SAVE_MODEL":
        if (!agent) throw new Error("Agent not initialised");
        await agent.saveModel();
        self.postMessage({ type: "SAVE_DONE" } satisfies WorkerOutMessage);
        break;

      case "LOAD_MODEL":
        if (!agent) throw new Error("Agent not initialised");
        await agent.loadModel();
        self.postMessage({ type: "LOAD_DONE" } satisfies WorkerOutMessage);
        break;

      default:
        break;
    }
  } catch (err) {
    self.postMessage({
      type: "ERROR",
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOutMessage);
  }
};
