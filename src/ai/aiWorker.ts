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

import * as tf from "@tensorflow/tfjs"; // registers WebGL / CPU backend
import { DQNAgent, ACTIONS } from "./dqnAgent";
import type { DQNConfig, Experience } from "./dqnAgent";
import { encodeBoardFlat } from "./encoding";
import { computeLookaheadScores, LOOKAHEAD_WEIGHT } from "./lookahead";
import type { Cell, TiltDirection } from "../types";

// ─── Message types ────────────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: "INIT"; config?: DQNConfig }
  | { type: "SELECT_ACTION"; cells: Cell[] }
  | { type: "REMEMBER"; experience: Experience }
  | { type: "TRAIN_STEP" }
  | { type: "SAVE_MODEL"; key?: string }
  | { type: "LOAD_MODEL"; key?: string };

export type WorkerOutMessage =
  | { type: "READY"; backend: string }
  | { type: "ACTION"; direction: TiltDirection; actionIndex: number }
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
        // Prefer GPU acceleration via WebGL; fall back to CPU automatically.
        try {
          await tf.setBackend("webgl");
        } catch {
          // WebGL not available in this environment – CPU fallback is fine.
        }
        await tf.ready();
        agent = new DQNAgent(msg.config);
        self.postMessage({
          type: "READY",
          backend: tf.getBackend(),
        } satisfies WorkerOutMessage);
        break;

      case "SELECT_ACTION": {
        if (!agent) throw new Error("Agent not initialised");
        const flat = encodeBoardFlat(msg.cells);
        const lookaheadScores = computeLookaheadScores(msg.cells);
        const actionIndex = agent.selectActionBlended(flat, lookaheadScores, LOOKAHEAD_WEIGHT);
        const direction = ACTIONS[actionIndex];
        self.postMessage({
          type: "ACTION",
          direction,
          actionIndex,
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
        await agent.saveModel(msg.key);
        self.postMessage({ type: "SAVE_DONE" } satisfies WorkerOutMessage);
        break;

      case "LOAD_MODEL":
        if (!agent) throw new Error("Agent not initialised");
        await agent.loadModel(msg.key);
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
