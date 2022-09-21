import { isEqual } from "lodash";
import { useEffect, useState } from "react";
import { useSwipeable } from "react-swipeable";
import useDocumentEventListener from "../../hooks/useDocumentEventListener";
import { Cell, Coordinate } from "../../types";
import addNewCell from "../../utils/addNewCell";
import getTiltDirectionByKey from "../../utils/getTiltDirectionByKey";
import getVectorByTiltDirection from "../../utils/getVectorByTiltDirection";

import tilt from "../../utils/tilt";
import Grid from "../Grid/Grid";
import styles from "./styles.module.css";

const Game = () => {
  const [cells, setCells] = useState<Cell[]>(() => {
    const initialCells = addNewCell([]);
    return addNewCell(initialCells);
  });
  const updateStateByVector = (vector: Coordinate<-1 | 0 | 1>) => {
    setCells((prevState) => {
      prevState = prevState.filter((cell) => !cell.consumedBy);
      try {
        const nextState = tilt(vector, prevState);
        if (isEqual(nextState, prevState)) {
          return prevState;
        }
        return addNewCell(nextState);
      } catch (e: any) {
        return prevState;
      }
    });
  };
  useDocumentEventListener(
    {
      type: "keydown",
      listener: (e) => {
        const direction = getTiltDirectionByKey(e.key);
        if (!direction) return;
        const vector = getVectorByTiltDirection(direction);
        updateStateByVector(vector);
      },
    },
    []
  );
  const handlers = useSwipeable({
    preventScrollOnSwipe: true,
    onSwiped: ({ dir }) => {
      const vector = getVectorByTiltDirection(dir);
      updateStateByVector(vector);
    },
    delta: 20,
  });

  return (
    <div className={styles.game} {...handlers}>
      <Grid cells={cells.slice().sort((a, b) => a.id - b.id)} />
    </div>
  );
};

export default Game;
