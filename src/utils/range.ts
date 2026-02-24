export function range(start: number, end: number, step: number): number[];
export function range(start: number, end: number): number[];
export function range(end: number): number[];
export function range(...args: number[]): number[] {
  let from = 0;
  let to = 0;
  if (args.length === 1) {
    to = args[0];
  } else if (args.length >= 2) {
    from = args[0];
    to = args[1];
  }
  const step = args.length > 3 ? args[2] : from < to ? 1 : -1;
  const acc: number[] = [];
  for (let i = from; i < to; i += step) {
    acc.push(i);
  }
  return acc;
}
