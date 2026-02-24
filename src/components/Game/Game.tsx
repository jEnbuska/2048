import { useCallback, useState } from "react";
import { useSwipeable } from "react-swipeable";
import useDocumentEventListener from "../../hooks/useDocumentEventListener";
import type { Cell, Coordinate } from "../../types";
import addNewCell from "../../utils/addNewCell";
import getTiltDirectionByKey from "../../utils/getTiltDirectionByKey";
import get2DVectorByTiltDirection from "../../utils/get2DVectorByTiltDirection.ts";
import tilt from "../../utils/tilt";
import Grid from "../Grid/Grid";
import styles from "./styles.module.css";
import GameScore from "../GameScore/GameScore.tsx";
import GameMenu from "../GameMenu/GameMenu.tsx";

function createGameState() {
  const initialCells = addNewCell([]);
  return { cells: addNewCell(initialCells), score: 0 };
}
const Game = () => {
  const [{ cells, score }, setState] = useState<{
    cells: Cell[];
    score: number;
  }>(createGameState);

  const updateStateByVector = (vector: Coordinate<-1 | 0 | 1>) => {
    setState((prevState) => {
      const { score } = prevState;
      const cells = prevState.cells.filter((it) => !it.consumedBy);
      try {
        const nextCells = tilt(vector, cells);
        const nextScore = nextCells
          .filter((cell: Cell) => cell.consumedBy)
          .map((cell) => cell.value)
          .reduce((a, b) => a + b * 2, score);
        if (JSON.stringify(nextCells) === JSON.stringify(cells)) {
          return prevState;
        }
        return { cells: addNewCell(nextCells), score: nextScore };
      } catch (_) {
        return prevState;
      }
    });
  };
  useDocumentEventListener({
    type: "keydown",
    listener: (e) => {
      const direction = getTiltDirectionByKey(e.key);
      if (!direction) return;
      const vector = get2DVectorByTiltDirection(direction);
      updateStateByVector(vector);
    },
  });
  const handlers = useSwipeable({
    preventScrollOnSwipe: true,
    onSwiped: ({ dir }) => {
      const vector = get2DVectorByTiltDirection(dir);
      updateStateByVector(vector);
    },
    delta: 20,
  });
  const restartGame = useCallback(() => {
    setState(createGameState());
  }, []);

  return (
    <div className={styles.game} {...handlers}>
      <GameMenu score={score} restartGame={restartGame} />
      <Grid cells={cells.slice().sort((a, b) => a.id - b.id)} />
    </div>
  );
};

export default Game;
