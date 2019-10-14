const COLUMNS_BY_INDEX = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
const COLUMN_TO_INDEX = new Map<string, number>()
COLUMNS_BY_INDEX.forEach((colLabel, idx) => COLUMN_TO_INDEX.set(colLabel, idx))

export const axisNames = {
  columnNameToIndex(columnName: string): number | undefined {
    return COLUMN_TO_INDEX.get(columnName)!
  },
  columnIndexToName(columnIndex: number): string | undefined {
    return COLUMNS_BY_INDEX[columnIndex]
  },
  rowNameToIndex(rowName: string): number | undefined {
    return parseInt(rowName) - 1
  },
  rowIndexToName(rowIndex: number): string {
    return String(rowIndex + 1)
  }
}
