import styles from "./styles.module.css";

type OwnProps = {
  score: number;
};
export default function GameScore({ score }: OwnProps) {
  return (
    <div className={styles.gameScore}>
      <small>Score</small>
      <b className={styles.gameScore}>{score}</b>
    </div>
  );
}
