import GameScore from "../GameScore/GameScore.tsx";
import styles from "./styles.module.css";
import RestartGame from "../RestartGame/RestartGame.tsx";
import AiPlayer from "../AiPlayer/AiPlayer.tsx";

type OwnProps = {
  score: number;
  restartGame: () => void;
  aiEnabled: boolean;
  toggleAi: () => void;
  aiWorkerReady: boolean;
};
export default function GameMenu({
  score,
  restartGame,
  aiEnabled,
  toggleAi,
  aiWorkerReady,
}: OwnProps) {
  return (
    <div className={styles.gameMenu}>
      <GameScore score={score} />
      <RestartGame restartGame={restartGame} />
      <AiPlayer
        aiEnabled={aiEnabled}
        toggleAi={toggleAi}
        workerReady={aiWorkerReady}
      />
    </div>
  );
}
