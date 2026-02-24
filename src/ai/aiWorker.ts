/**
 * AI Web Worker
 *
 * Runs the full game loop autonomously: board management, DQN inference,
 * experience replay, and training all happen here.  React is notified via
 * DISPLAY messages (throttled to at most once per DISPLAY_THROTTLE_MS in
 * speed mode, and on every move in normal mode) and a single GAME_OVER
 * message when the board is exhausted.
 *
 * Message protocol
 * ──────────────────────────────────────────────────────────────────────────
 * Main → Worker  (WorkerInMessage)
 *   { type: "INIT",                config?: DQNConfig }
 *   { type: "START_GAME",          speedMode?: boolean; rewardWeights?: RewardWeights }
 *   { type: "RESET_GAME",          speedMode?: boolean; rewardWeights?: RewardWeights }
 *   { type: "STOP_GAME" }
 *   { type: "SET_SPEED_MODE",      speedMode: boolean }
 *   { type: "SET_REWARD_WEIGHTS",  weights: RewardWeights }
 *   { type: "SAVE_MODEL",          key?: string }
 *   { type: "LOAD_MODEL",          key?: string }
 *
 * Worker → Main  (WorkerOutMessage)
 *   { type: "READY",        backend: string }
 *   { type: "DISPLAY",      cells: Cell[]; score: number; gameOver: boolean }
 *   { type: "GAME_OVER",    score: number }
 *   { type: "TRAIN_RESULT", loss: number | null }
 *   { type: "SAVE_DONE" }
 *   { type: "LOAD_DONE" }
 *   { type: "ERROR",        message: string }
 */

import * as tf from "@tensorflow/tfjs"; // registers WebGL / CPU backend
import { DQNAgent, ACTIONS } from "./dqnAgent";
import type { DQNConfig } from "./dqnAgent";
import { encodeBoardFlat, countEmptyCells } from "./encoding";
import { computeLookaheadScores, LOOKAHEAD_WEIGHT, selectLookaheadAction } from "./lookahead";
import { calculateReward, isGameOver, REWARD_WEIGHTS } from "./rewardUtils";
import type { RewardWeights } from "./rewardUtils";
import tilt from "../utils/tilt";
import addNewCell from "../utils/addNewCell";
import { getMoveInterval } from "../utils/moveInterval";
import get2DVectorByTiltDirection from "../utils/get2DVectorByTiltDirection";
import type { Cell } from "../types";

// ─── Message types ────────────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: "INIT"; config?: DQNConfig }
  | { type: "START_GAME"; speedMode?: boolean; rewardWeights?: RewardWeights }
  | { type: "RESET_GAME"; speedMode?: boolean; rewardWeights?: RewardWeights }
  | { type: "STOP_GAME" }
  | { type: "SET_SPEED_MODE"; speedMode: boolean }
  | { type: "SET_REWARD_WEIGHTS"; weights: RewardWeights }
  | { type: "SAVE_MODEL"; key?: string }
  | { type: "LOAD_MODEL"; key?: string };

export type WorkerOutMessage =
  | { type: "READY"; backend: string }
  | { type: "DISPLAY"; cells: Cell[]; score: number; gameOver: boolean }
  | { type: "GAME_OVER"; score: number }
  | { type: "TRAIN_RESULT"; loss: number | null }
  | { type: "SAVE_DONE" }
  | { type: "LOAD_DONE" }
  | { type: "ERROR"; message: string };

// ─── Constants ────────────────────────────────────────────────────────────────

/** Auto-save the policy model every this many training steps. */
const SAVE_EVERY = 20;

/**
 * Number of initial game steps in which the pure lookahead solver acts as
 * teacher, seeding the replay buffer with high-quality expert demonstrations
 * before epsilon-greedy exploration begins.
 *
 * During this phase every action is chosen by `selectLookaheadAction` (no
 * randomness), so the first experiences stored in replay memory are the best
 * the heuristic can produce.  After this many steps the agent switches to the
 * normal blended epsilon-greedy policy.
 */
const DEMO_PHASE_STEPS = 2_000;

/**
 * Minimum milliseconds between DISPLAY messages sent to React in speed mode.
 * Normal-mode moves are already spaced by the move-interval (5–500 ms) so
 * every move triggers a display update there.
 */
const DISPLAY_THROTTLE_MS = 500;

const POLICY_MODEL_KEY = "2048-dqn-policy";

// ─── Mutable game state ───────────────────────────────────────────────────────

let agent: DQNAgent | null = null;
let cells: Cell[] = [];
let score = 0;
let running = false;
let speedMode = false;
let rewardWeights: RewardWeights = { ...REWARD_WEIGHTS };
let gameLoopTimer: ReturnType<typeof setTimeout> | null = null;
let trainStepCount = 0;
let lastDisplayMs = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startFreshBoard() {
  cells = addNewCell(addNewCell([]));
  score = 0;
  lastDisplayMs = 0;
}

function cancelLoop() {
  if (gameLoopTimer !== null) {
    clearTimeout(gameLoopTimer);
    gameLoopTimer = null;
  }
}

/** Send a DISPLAY message immediately (no throttle check). */
function sendDisplay(gameOver: boolean) {
  lastDisplayMs = Date.now();
  self.postMessage({
    type: "DISPLAY",
    cells,
    score,
    gameOver,
  } satisfies WorkerOutMessage);
}

function scheduleStep() {
  if (!running || !agent) return;
  const delay = speedMode ? 0 : getMoveInterval(countEmptyCells(cells));
  gameLoopTimer = setTimeout(runStep, delay);
}

// ─── Game loop ────────────────────────────────────────────────────────────────

async function runStep() {
  gameLoopTimer = null;
  if (!agent || !running) return;

  // Snapshot pre-move state for experience collection.
  const prevCells = cells.slice();
  const prevScore = score;

  // Pick an action.
  // During the demo phase the pure lookahead solver acts as teacher so that
  // the replay buffer is seeded with high-quality expert demonstrations.
  // After the demo phase the normal blended epsilon-greedy policy takes over.
  const flat = encodeBoardFlat(cells);
  const lookaheadScores = computeLookaheadScores(cells);
  const actionIndex =
    trainStepCount < DEMO_PHASE_STEPS
      ? selectLookaheadAction(lookaheadScores)
      : agent.selectActionBlended(flat, lookaheadScores, LOOKAHEAD_WEIGHT);
  const direction = ACTIONS[actionIndex];
  const vector = get2DVectorByTiltDirection(direction);

  // Apply tilt to the active (non-consumed) cells.
  const cleanCells = cells.filter((c) => !c.consumedBy);
  let nextCells: Cell[];
  try {
    nextCells = tilt(vector, cleanCells);
  } catch {
    scheduleStep();
    return;
  }

  // Detect no-op moves: no cell moved and nothing was consumed.
  const noOp =
    !nextCells.some((c) => c.consumedBy) &&
    (() => {
      const prevById = new Map(cleanCells.map((c) => [c.id, c]));
      return nextCells.every((c) => {
        const prev = prevById.get(c.id);
        return prev !== undefined && prev.x === c.x && prev.y === c.y;
      });
    })();

  if (!noOp) {
    // Accumulate score from merged tiles.
    score = nextCells
      .filter((c) => c.consumedBy)
      .reduce((s, c) => s + c.value * 2, prevScore);

    // Spawn a new tile.
    try {
      cells = addNewCell(nextCells);
    } catch {
      cells = nextCells;
    }
  }

  const done = isGameOver(cells);

  // Build and store the experience transition.
  const reward = calculateReward(prevCells, cells, prevScore, score, done, rewardWeights);
  const state = encodeBoardFlat(prevCells);
  const nextState = encodeBoardFlat(cells);
  agent.remember({ state, action: actionIndex, reward, nextState, done });

  // Train and report.
  let loss: number | null = null;
  try {
    loss = await agent.trainStep();
  } catch {
    // Training errors are non-fatal; keep the loop alive.
  }
  trainStepCount++;
  self.postMessage({ type: "TRAIN_RESULT", loss } satisfies WorkerOutMessage);

  // Periodic policy-model auto-save.
  if (trainStepCount % SAVE_EVERY === 0) {
    try {
      await agent.saveModel(POLICY_MODEL_KEY);
      self.postMessage({ type: "SAVE_DONE" } satisfies WorkerOutMessage);
    } catch {
      // Save errors are non-fatal.
    }
  }

  // Throttled display update: always send in normal mode or on game-over;
  // in speed mode only send when DISPLAY_THROTTLE_MS has elapsed.
  if (!speedMode || done || Date.now() - lastDisplayMs >= DISPLAY_THROTTLE_MS) {
    sendDisplay(done);
  }

  if (done) {
    running = false;
    self.postMessage({ type: "GAME_OVER", score } satisfies WorkerOutMessage);
    return;
  }

  scheduleStep();
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "INIT":
        // Prefer GPU acceleration via WebGL; fall back to CPU automatically.
        try {
          await tf.setBackend("webgl");
        } catch {
          // WebGL not available – CPU fallback is fine.
        }
        await tf.ready();
        agent = new DQNAgent(msg.config);
        self.postMessage({
          type: "READY",
          backend: tf.getBackend(),
        } satisfies WorkerOutMessage);
        break;

      case "START_GAME":
        if (msg.speedMode !== undefined) speedMode = msg.speedMode;
        if (msg.rewardWeights) rewardWeights = msg.rewardWeights;
        cancelLoop();
        startFreshBoard();
        running = true;
        sendDisplay(false);
        scheduleStep();
        break;

      case "RESET_GAME":
        if (msg.speedMode !== undefined) speedMode = msg.speedMode;
        if (msg.rewardWeights) rewardWeights = msg.rewardWeights;
        cancelLoop();
        startFreshBoard();
        running = true;
        sendDisplay(false);
        scheduleStep();
        break;

      case "STOP_GAME":
        running = false;
        cancelLoop();
        break;

      case "SET_SPEED_MODE":
        speedMode = msg.speedMode;
        if (running) {
          // Reschedule with the updated delay.
          cancelLoop();
          scheduleStep();
        }
        break;

      case "SET_REWARD_WEIGHTS":
        rewardWeights = msg.weights;
        break;

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
