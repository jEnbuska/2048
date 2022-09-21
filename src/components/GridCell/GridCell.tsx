import React, { memo } from "react";
import { Cell } from "../../types";
import GridCellValue from "../GridCellValue/GridCellValue";
import styles from "./styles.module.css";
import classnames from "classnames";

type OwnProps = Cell;
const GridCell = memo(({ value, y, x, consumedBy }: OwnProps) => {
  const top = `calc(var(--gap-s) + (var(--cell-size) + var(--gap-s)) * ${y})`;
  const left = `calc(var(--gap-s) + (var(--cell-size) + var(--gap-s)) * ${x})`;
  return (
    <div
      className={classnames(
        styles.cell,
        styles[`cell-${value}`],
        consumedBy && styles.cellConsumed
      )}
      style={{ left, top }}
    >
      <GridCellValue value={value} />
    </div>
  );
});

export default GridCell;
