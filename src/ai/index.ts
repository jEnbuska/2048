export { encodeBoard, encodeBoardFlat, countEmptyCells, NUM_CHANNELS, TILE_EXPONENTS } from "./encoding";
export { calculateReward, calculateMonotonicity, calculateCornerBonus, REWARD_WEIGHTS } from "./rewardUtils";
export { DQNAgent, ReplayMemory, ACTIONS, NUM_ACTIONS } from "./dqnAgent";
export type { DQNConfig, Experience } from "./dqnAgent";
export type { WorkerInMessage, WorkerOutMessage } from "./aiWorker";
