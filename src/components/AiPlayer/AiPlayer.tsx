import styles from "./styles.module.css";

type OwnProps = {
  aiEnabled: boolean;
  toggleAi: () => void;
  workerReady: boolean;
};

export default function AiPlayer({ aiEnabled, toggleAi, workerReady }: OwnProps) {
  return (
    <button
      className={styles.aiPlayer}
      onClick={toggleAi}
      disabled={!workerReady}
      title={
        !workerReady
          ? "AI loading…"
          : aiEnabled
            ? "Stop AI player"
            : "Start AI player"
      }
      aria-pressed={aiEnabled}
    >
      {aiEnabled ? "Stop AI" : "Auto"}
      {/* Robot icon */}
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
      >
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h3a3 3 0 0 1 3 3v1h.5a1.5 1.5 0 0 1 0 3H19v3a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-3h-.5a1.5 1.5 0 0 1 0-3H5v-1a3 3 0 0 1 3-3h3V5.73A2 2 0 0 1 10 4a2 2 0 0 1 2-2zm-2 9a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0-3z" />
      </svg>
    </button>
  );
}
