export const COLUMNS_BY_INDEX = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
export const COLUMN_TO_INDEX = new Map<string, number>()
COLUMNS_BY_INDEX.forEach((colLabel, idx) => COLUMN_TO_INDEX.set(colLabel, idx))
