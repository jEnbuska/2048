import type { Cell } from "../../types";
import styles from "./styles.module.css";
import GridCell from "../GridCell/GridCell";
import { range } from "../../utils/range.ts";
import { GRID_SIZE } from "../../constants.ts";

type OwnProps = {
  cells: Cell[];
};

const Grid = ({ cells }: OwnProps) => {
  return (
    <div className={styles.grid}>
      {range(GRID_SIZE ** 2).map((n) => (
        <div className={styles.cell} key={n} />
      ))}
      {cells.map((cell) => {
        return <GridCell key={`cell-${cell.id}`} {...cell} />;
      })}
    </div>
  );
};

export default Grid;
