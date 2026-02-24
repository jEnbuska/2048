import classnames from "classnames";
import styles from "./styles.module.css";
import { range } from "../../utils/range.ts";

type OwnProps = {
  value: number;
};

const GridCellValue = ({ value }: OwnProps) => {
  return (
    <>
      {range(1, 20)
        .map((n) => 2 ** n)
        .map((n) => {
          return (
            <div
              className={classnames(
                styles.value,
                value === n && styles.valueActive,
                value < n && styles.valueLarger,
                value > n && styles.valueSmaller,
              )}
              key={`value-${n}`}
            >
              {n}
            </div>
          );
        })}
    </>
  );
};

export default GridCellValue;
