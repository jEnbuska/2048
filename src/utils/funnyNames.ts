const FUNNY_NAMES: string[] = [
  "Turbo Toaster",
  "Block Buster",
  "Grid Gobbler",
  "Merge Master",
  "Tile Terminator",
  "Numb3r Cruncher",
  "Slidy McSlideface",
  "Count Blockula",
  "The Tilinator",
  "Double Trouble",
  "Quad Squad",
  "The Big Merge",
  "Speedy Gonzalez",
  "Mighty Merger",
  "Power Pusher",
  "Grid Genius",
  "Square Bear",
  "Merge Maniac",
  "Tile Whisperer",
  "Block Party",
  "Sliding Stan",
  "The Incrementor",
  "Board Destroyer",
  "Stack Attack",
  "Captain Combine",
  "Sir Slides-a-Lot",
  "El Mergador",
  "Flip Flopper",
  "Mr. Big Numbers",
  "Lady Luck",
  "Digital Dynamo",
  "The Grid Wizard",
  "Tile Terror",
  "Block Batman",
  "Merge Machine",
  "SwipeBot 3000",
  "Combo King",
  "Zero Hero",
  "Eight Master",
  "The Doubler",
  "Flash Merger",
  "Grid Commander",
  "Slide Rider",
  "Block Blitz",
  "Combo Crusader",
  "Merge Maestro",
  "Stack Master",
  "Tile Titan",
  "Grid Guardian",
  "The Accumulator",
];

let pool: string[] | null = null;
let poolIndex = 0;

/** Fisher-Yates shuffle in place. */
function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Returns a unique funny name, cycling through the list (shuffled once). */
export function getRandomFunnyName(): string {
  if (!pool) {
    pool = shuffle([...FUNNY_NAMES]);
  }
  const name = pool[poolIndex % pool.length];
  poolIndex = (poolIndex + 1) % pool.length;
  return name;
}
