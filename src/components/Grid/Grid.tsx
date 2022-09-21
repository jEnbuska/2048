import { range } from "lodash";
import { Cell } from "../../types";
import styles from "./styles.module.css";
import GridCell from "../GridCell/GridCell";

type OwnProps = {
  cells: Cell[];
};

const Grid = ({ cells }: OwnProps) => {
  return (
    <div className={styles.grid}>
      {range(4 ** 2).map((n) => (
        <div className={styles.cell} key={n} />
      ))}
      {cells.map((cell) => {
        return <GridCell key={`cell-${cell.id}`} {...cell} />;
      })}
    </div>
  );
};

export default Grid;
