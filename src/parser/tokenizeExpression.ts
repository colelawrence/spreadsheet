import { TablePosition } from "./parseCell"
import { ColRef, RowRef } from "../table"

type ColumnLocationToken = {
  position: TablePosition.Static,
  columnStatic: ColRef,
} | {
  position: TablePosition.Relative,
  columnRelative: number,
}

type RowLocationToken = {
  position: TablePosition.Static,
  rowStatic: RowRef,
} | {
  position: TablePosition.Relative,
  rowRelative: number,
}

export type ExpressionToken =
  | { kind: "whitespace"; text: string }
  | { kind: "operator"; jsOperator: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "reference"; column: ColumnLocationToken; row: RowLocationToken }

export function tokenizeExpression(): ExpressionToken[] {

}
