import GameScore from "../GameScore/GameScore.tsx";
import styles from "./styles.module.css";
import RestartGame from "../RestartGame/RestartGame.tsx";

type OwnProps = {
  score: number;
  restartGame: () => void;
};
export default function GameMenu({ score, restartGame }: OwnProps) {
  return (
    <div className={styles.gameMenu}>
      <GameScore score={score} />
      <RestartGame restartGame={restartGame} />
    </div>
  );
}
