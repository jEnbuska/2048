import { isEqual } from "lodash";
import { useEffect, useState } from "react";
import useDocumentEventListener from "../../hooks/useDocumentEventListener";
import { Cell } from "../../types";
import addNewCell from "../../utils/addNewCell";
import getVectorByKey from "../../utils/getVectorByKey";

import tilt from "../../utils/tilt";
import Grid from "../Grid/Grid";
import styles from "./styles.module.css";

const Game = () => {
  const [cells, setCells] = useState<Cell[]>(() => {
    const initialCells = addNewCell([]);
    return addNewCell(initialCells);
  });
  useDocumentEventListener(
    {
      type: "keydown",
      listener: (e) => {
        const vector = getVectorByKey(e.key);
        if (!vector) return;
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
      },
    },
    []
  );
  return (
    <div className={styles.game}>
      <Grid cells={cells.slice().sort((a, b) => a.id - b.id)} />
    </div>
  );
};

export default Game;
