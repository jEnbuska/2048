/**
 * Deep Q-Network (DQN) Agent for 2048.
 *
 * Architecture
 * ──────────────────────────────────────────────────────────────────────────
 * • Input  : One-hot encoded board  [NUM_CHANNELS × 4 × 4] = 17×4×4 = 272 values
 * • Conv1  : 32 filters, 2×2 kernel, ReLU
 * • Conv2  : 64 filters, 2×2 kernel, ReLU
 * • Flatten → Dense(256, ReLU) → Dense(4, Linear)  [Q-values for Up/Down/Left/Right]
 *
 * Training uses:
 * • Experience Replay  – random mini-batch sampling from a circular memory buffer
 * • Target Network     – separate frozen network for stable Bellman targets
 *   (synced every `targetUpdateFrequency` gradient steps)
 */

import * as tf from "@tensorflow/tfjs";
import { encodeBoardFlat, NUM_CHANNELS } from "./encoding";
import { GRID_SIZE } from "../constants";
import type { Cell, TiltDirection } from "../types";

// ─── Constants ───────────────────────────────────────────────────────────────

export const ACTIONS: TiltDirection[] = ["Up", "Down", "Left", "Right"];
export const NUM_ACTIONS = ACTIONS.length;

const INPUT_SHAPE: [number, number, number] = [GRID_SIZE, GRID_SIZE, NUM_CHANNELS];

// ─── Experience Replay Memory ────────────────────────────────────────────────

export interface Experience {
  state: Float32Array;
  action: number;
  reward: number;
  nextState: Float32Array;
  done: boolean;
}

export class ReplayMemory {
  private buffer: Experience[] = [];
  private index = 0;
  readonly capacity: number;

  constructor(capacity: number = 10_000) {
    this.capacity = capacity;
  }

  push(experience: Experience): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(experience);
    } else {
      this.buffer[this.index] = experience;
    }
    this.index = (this.index + 1) % this.capacity;
  }

  sample(batchSize: number): Experience[] {
    const sampled: Experience[] = [];
    for (let i = 0; i < batchSize; i++) {
      const idx = Math.floor(Math.random() * this.buffer.length);
      sampled.push(this.buffer[idx]);
    }
    return sampled;
  }

  get size(): number {
    return this.buffer.length;
  }
}

// ─── Model factory ───────────────────────────────────────────────────────────

/** Build and return a new CNN model. */
function buildModel(): tf.Sequential {
  const model = tf.sequential();
  model.add(
    tf.layers.conv2d({
      filters: 32,
      kernelSize: 2,
      activation: "relu",
      padding: "same",
      inputShape: INPUT_SHAPE,
    }),
  );
  model.add(
    tf.layers.conv2d({
      filters: 64,
      kernelSize: 2,
      activation: "relu",
      padding: "same",
    }),
  );
  model.add(tf.layers.flatten());
  model.add(tf.layers.dense({ units: 256, activation: "relu" }));
  model.add(tf.layers.dense({ units: NUM_ACTIONS, activation: "linear" }));

  model.compile({
    optimizer: tf.train.adam(1e-4),
    loss: "meanSquaredError",
  });

  return model;
}

// ─── DQN Agent ───────────────────────────────────────────────────────────────

export interface DQNConfig {
  /** Max transitions stored in replay memory. */
  memoryCapacity?: number;
  /** Number of transitions per training step. */
  batchSize?: number;
  /** Discount factor γ for future rewards. */
  gamma?: number;
  /** Initial exploration rate ε (default 1.0 – fully random at start). */
  epsilonStart?: number;
  /**
   * Number of gradient steps over which ε is linearly annealed from
   * `epsilonStart` to `epsilonMin`.  After this many steps the agent acts
   * with minimal exploration, having exhausted its main exploration budget.
   * Default: 50 000.
   */
  epsilonDecaySteps?: number;
  /**
   * Minimum exploration rate ε that the agent never falls below.
   * Keeping a small floor (default 0.05) prevents the agent from converging
   * to a fully greedy policy that can no longer escape local optima.
   */
  epsilonMin?: number;
  /** Copy policy → target network every N steps. */
  targetUpdateFrequency?: number;
}

export class DQNAgent {
  private readonly policy: tf.Sequential;
  private readonly target: tf.Sequential;
  private readonly memory: ReplayMemory;

  private epsilon: number;
  private steps = 0;

  readonly batchSize: number;
  readonly gamma: number;
  readonly epsilonStart: number;
  readonly epsilonMin: number;
  readonly epsilonDecaySteps: number;
  readonly targetUpdateFrequency: number;

  constructor(config: DQNConfig = {}) {
    this.batchSize = config.batchSize ?? 64;
    this.gamma = config.gamma ?? 0.99;
    this.epsilonStart = config.epsilonStart ?? 1.0;
    this.epsilonMin = config.epsilonMin ?? 0.05;
    this.epsilonDecaySteps = config.epsilonDecaySteps ?? 50_000;
    this.epsilon = this.epsilonStart;
    this.targetUpdateFrequency = config.targetUpdateFrequency ?? 500;

    this.policy = buildModel();
    this.target = buildModel();
    this.syncTargetNetwork();

    this.memory = new ReplayMemory(config.memoryCapacity ?? 50_000);
  }

  // ── Exploration ──────────────────────────────────────────────────────────

  /**
   * Epsilon-greedy action selection.
   * @param stateTensor Pre-encoded board as Float32Array (length 272).
   * @returns Index into ACTIONS [0–3].
   */
  selectAction(stateTensor: Float32Array): number {
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * NUM_ACTIONS);
    }
    return tf.tidy(() => {
      const input = tf.tensor4d(stateTensor, [1, ...INPUT_SHAPE]);
      const qValues = this.policy.predict(input) as tf.Tensor;
      return (qValues.argMax(-1).dataSync()[0]) as number;
    });
  }

  /**
   * Convenience wrapper: select action from a Cell[] board.
   */
  selectActionFromCells(cells: Cell[]): TiltDirection {
    const flat = encodeBoardFlat(cells);
    const index = this.selectAction(flat);
    return ACTIONS[index];
  }

  /**
   * Blended epsilon-greedy action selection.
   *
   * Combines the DQN's Q-values with caller-supplied per-action scores
   * (e.g. from a lookahead search) using a configurable blend weight.
   *
   * During exploration (ε-greedy random phase) the selection is restricted to
   * actions that the external scores consider valid (finite score), so the
   * agent avoids obvious no-op moves even while exploring.
   *
   * During exploitation the DQN Q-values and the external scores are each
   * normalised independently to [0, 1] before being linearly combined:
   *
   *   combined[i] = (1 − blendWeight) × qNorm[i] + blendWeight × extNorm[i]
   *
   * The action with the highest combined score is returned.
   *
   * @param stateTensor    Pre-encoded board as Float32Array (length 272).
   * @param externalScores Per-action external scores (e.g. lookahead). Use
   *                       -Infinity for actions that should be avoided.
   * @param blendWeight    Weight of external scores in [0, 1]; 0 = pure DQN.
   * @returns Index into ACTIONS [0–3].
   */
  selectActionBlended(
    stateTensor: Float32Array,
    externalScores: number[],
    blendWeight = 0.6,
  ): number {
    if (Math.random() < this.epsilon) {
      // Prefer valid (non-no-op) actions during random exploration.
      const validIndices = externalScores
        .map((s, i) => (isFinite(s) ? i : -1))
        .filter((i) => i >= 0);
      if (validIndices.length > 0) {
        return validIndices[Math.floor(Math.random() * validIndices.length)];
      }
      return Math.floor(Math.random() * NUM_ACTIONS);
    }

    return tf.tidy(() => {
      const input = tf.tensor4d(stateTensor, [1, ...INPUT_SHAPE]);
      const qTensor = this.policy.predict(input) as tf.Tensor;
      const qValues = Array.from(qTensor.dataSync() as Float32Array);

      // Normalise Q-values to [0, 1].
      const qMin = Math.min(...qValues);
      const qMax = Math.max(...qValues);
      const qRange = qMax - qMin || 1;
      const qNorm = qValues.map((q) => (q - qMin) / qRange);

      // Normalise finite external scores to [0, 1]; invalid actions get -1.
      const finite = externalScores.filter((v) => isFinite(v));

      // If no valid actions exist (all no-ops, game stuck), fall back to pure
      // DQN greedy selection to avoid degenerate blending behaviour.
      if (finite.length === 0) {
        return qNorm.indexOf(Math.max(...qNorm));
      }

      const extMin = Math.min(...finite);
      const extMax = Math.max(...finite);
      const extRange = extMax - extMin || 1;
      const extNorm = externalScores.map((v) =>
        isFinite(v) ? (v - extMin) / extRange : -1,
      );

      // Blend and pick the best action.
      // Invalid actions (extNorm === -1) are set to -Infinity so they can
      // never be selected during exploitation, regardless of their Q-value.
      const combined = qNorm.map((q, i) =>
        isFinite(externalScores[i])
          ? (1 - blendWeight) * q + blendWeight * extNorm[i]
          : -Infinity,
      );
      return combined.indexOf(Math.max(...combined));
    });
  }

  // ── Memory ───────────────────────────────────────────────────────────────

  remember(exp: Experience): void {
    this.memory.push(exp);
  }

  // ── Training ─────────────────────────────────────────────────────────────

  /**
   * Sample a mini-batch and perform one gradient-descent step.
   * Returns the loss value, or null if there is not enough data yet.
   */
  async trainStep(): Promise<number | null> {
    if (this.memory.size < this.batchSize) return null;

    const batch = this.memory.sample(this.batchSize);

    // Build batch tensors
    const stateData = new Float32Array(
      this.batchSize * GRID_SIZE * GRID_SIZE * NUM_CHANNELS,
    );
    const nextStateData = new Float32Array(stateData.length);
    const actionIndices = new Int32Array(this.batchSize);
    const rewards = new Float32Array(this.batchSize);
    const dones = new Float32Array(this.batchSize);

    batch.forEach((exp, i) => {
      const offset = i * GRID_SIZE * GRID_SIZE * NUM_CHANNELS;
      stateData.set(exp.state, offset);
      nextStateData.set(exp.nextState, offset);
      actionIndices[i] = exp.action;
      rewards[i] = exp.reward;
      dones[i] = exp.done ? 1 : 0;
    });

    const loss = await tf.tidy(() => {
      const stateT = tf.tensor4d(stateData, [
        this.batchSize,
        ...INPUT_SHAPE,
      ]);
      const nextStateT = tf.tensor4d(nextStateData, [
        this.batchSize,
        ...INPUT_SHAPE,
      ]);
      const rewardT = tf.tensor1d(rewards);
      const doneT = tf.tensor1d(dones);

      // Bellman target: r + γ * max_a Q_target(s', a)
      const nextQValues = this.target.predict(nextStateT) as tf.Tensor;
      const maxNextQ = nextQValues.max(1); // [batchSize]
      const targets = rewardT.add(
        tf.scalar(this.gamma).mul(maxNextQ).mul(tf.scalar(1).sub(doneT)),
      );

      // Current Q-values from policy network
      const currentQ = this.policy.predict(stateT) as tf.Tensor;

      // Build updated Q target: only change the Q-value for the taken action
      const oneHot = tf.oneHot(
        tf.tensor1d(Array.from(actionIndices), "int32"),
        NUM_ACTIONS,
      );
      const selectedQ = currentQ.mul(oneHot).sum(1); // [batchSize]

      return tf.losses.meanSquaredError(targets, selectedQ);
    }) as tf.Scalar;

    // Perform gradient update (separate tidy avoids variable disposal issues)
    const lossValue = (await loss.data())[0];

    // Manual gradient step on the policy network
    const grads = tf.variableGrads(() => {
      const stateT = tf.tensor4d(stateData, [this.batchSize, ...INPUT_SHAPE]);
      const nextStateT = tf.tensor4d(nextStateData, [
        this.batchSize,
        ...INPUT_SHAPE,
      ]);
      const rewardT = tf.tensor1d(rewards);
      const doneT = tf.tensor1d(dones);

      const nextQValues = this.target.predict(nextStateT) as tf.Tensor;
      const maxNextQ = nextQValues.max(1);
      const targetValues = rewardT.add(
        tf.scalar(this.gamma).mul(maxNextQ).mul(tf.scalar(1).sub(doneT)),
      );

      const currentQ = this.policy.predict(stateT) as tf.Tensor;
      const oneHot = tf.oneHot(
        tf.tensor1d(Array.from(actionIndices), "int32"),
        NUM_ACTIONS,
      );
      const selectedQ = currentQ.mul(oneHot).sum(1);
      return tf.losses.meanSquaredError(targetValues, selectedQ) as tf.Scalar;
    });

    (this.policy.optimizer as tf.Optimizer).applyGradients(grads.grads);
    tf.dispose(grads.grads);
    loss.dispose();

    // Linear epsilon decay: ε decays from epsilonStart down to epsilonMin
    // over epsilonDecaySteps gradient updates.  The floor ensures the agent
    // never stops exploring entirely, preventing it from getting stuck in a
    // local greedy policy after the main exploration budget is exhausted.
    this.steps++;
    this.epsilon = Math.max(
      this.epsilonMin,
      this.epsilonStart * (1 - this.steps / this.epsilonDecaySteps),
    );

    // Periodically sync target network
    if (this.steps % this.targetUpdateFrequency === 0) {
      this.syncTargetNetwork();
    }

    return lossValue;
  }

  // ── Target Network sync ──────────────────────────────────────────────────

  syncTargetNetwork(): void {
    const pWeights = this.policy.getWeights();
    this.target.setWeights(pWeights);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /** Save the policy network to IndexedDB under the given key. */
  async saveModel(key = "2048-dqn-policy"): Promise<void> {
    await this.policy.save(`indexeddb://${key}`);
  }

  /** Load weights from IndexedDB into the policy (and sync target). */
  async loadModel(key = "2048-dqn-policy"): Promise<void> {
    const loaded = (await tf.loadLayersModel(
      `indexeddb://${key}`,
    )) as tf.Sequential;
    this.policy.setWeights(loaded.getWeights());
    this.syncTargetNetwork();
    loaded.dispose();
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get currentEpsilon(): number {
    return this.epsilon;
  }

  get totalSteps(): number {
    return this.steps;
  }

  dispose(): void {
    this.policy.dispose();
    this.target.dispose();
  }
}
