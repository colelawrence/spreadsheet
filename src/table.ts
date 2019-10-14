import {
  BehaviorSubject,
  Observable,
  of,
  throwError,
  combineLatest,
} from "rxjs"
import {
  debounceTime,
  map,
  mergeMap,
  distinctUntilChanged,
} from "rxjs/operators"
import { COLUMN_TO_INDEX, COLUMNS_BY_INDEX } from "./columns"
import { createExprEvaluatorFn } from "./evaluator/createEvaluator"
import { dbg, genId, moveAfter, moveBefore } from "./helpers"
import {
  ParsedColumnLocation,
  ParsedRowLocation,
  TablePosition,
  CellNode,
  ParserCellRef,
  ExprNode,
  parsedReferenceToString,
  parseCell,
} from "./parser/parseCell"
import { mapExprReferences } from "./parser/mapExprReferences"

type TableRowLocation =
  | [TablePosition.Relative, number]
  | [TablePosition.Static, RowRef]

type TableColumnLocation =
  | [TablePosition.Relative, number]
  | [TablePosition.Static, ColRef]

/** This is the calculated CellRef, it is what we get after converting letters and numbers to Table static and relative references */
type TableCellLocation = {
  column: TableColumnLocation
  row: TableRowLocation
}

interface CellExpressionValid {
  state: "valid"
  valid: CellNode<TableCellLocation>
}

interface CellExpressionInvalid {
  state: "invalid"
  value: string
  error: string
}

export type CellProperties = {
  expression: CellExpressionValid | CellExpressionInvalid
}

const EMPTY_CELL: CellProperties = {
  expression: {
    state: "valid",
    valid: {
      kind: "empty",
    },
  },
}

export type CellValue = string | number | undefined
export type CellView = {
  formula: boolean
} & (
  | {
      ok: true
      display: string
      value: CellValue
    }
  | {
      ok: false
      error: string
    })

type CellEditor = {
  $expressionValue: Observable<string>
  /** might return null if there is no preview */
  $expressionPreview: Observable<CellView | null>
  updateExpressionValue: (next: string) => void
  apply: () => Promise<boolean>
}

export class ColRef {
  public id = genId("Col")
}
export class RowRef {
  public id = genId("Row")
}

export interface Cell {
  $properties: Observable<CellProperties>
  $view: Observable<CellView>
  editCell(): CellEditor
}

export class Table {
  $columnOrder = new BehaviorSubject<ColRef[]>([])
  $rowOrder = new BehaviorSubject<RowRef[]>([])
  private cells = new WeakMap<ColRef, WeakMap<RowRef, Cell>>()

  constructor(size: { rows: number; cols: number }) {
    const cols = new Array(size.cols).fill(undefined).map(_ => new ColRef())
    const rows = new Array(size.rows).fill(undefined).map(_ => new RowRef())
    for (const col of cols) {
      const rowCellMap = new WeakMap<RowRef, Cell>()
      for (const row of rows) {
        rowCellMap.set(row, this.createCell(col, row))
      }
      this.cells.set(col, rowCellMap)
    }
    this.$columnOrder.next(cols)
    this.$rowOrder.next(rows)
  }

  moveColumnAfter(colRef: ColRef, after: ColRef) {
    this.$columnOrder.next(moveAfter(this.$columnOrder.value, colRef, after))
  }

  moveColumnBefore(colRef: ColRef, before: ColRef) {
    this.$columnOrder.next(moveBefore(this.$columnOrder.value, colRef, before))
  }

  private mapParsedExprRefsToTableCellRefs(
    contextCol: ColRef,
    contextRow: RowRef,
    parsed: ExprNode<ParserCellRef>,
  ): ExprNode<TableCellLocation> {
    return mapExprReferences(
      parserReference => ({
        column: this.lookupParsedColumnLocation(
          contextCol,
          parserReference.column,
        ),
        row: this.lookupParsedRowLocation(contextRow, parserReference.row),
      }),
      parsed,
    )
  }

  private parseCellInput(
    col: ColRef,
    row: RowRef,
    cellInput: string,
  ): CellProperties["expression"] {
    // TODO: Rename CellProperties "expression" to something like "value" / "input"
    try {
      const parsedCellNode = parseCell(cellInput)
      switch (parsedCellNode.kind) {
        case "expression":
          return {
            state: "valid",
            valid: {
              kind: "expression",
              expression: this.mapParsedExprRefsToTableCellRefs(
                col,
                row,
                parsedCellNode.expression,
              ),
            },
          }
        case "empty":
        case "number":
        case "text":
          // non-expression values are simple
          return {
            state: "valid",
            valid: parsedCellNode,
          }
        default:
          const exhaust: never = parsedCellNode
          return exhaust // exhaustive check
      }
    } catch (err) {
      const message = `Parse error\nFailed to parse [${cellInput}]`
      console.error(message, err)
      return {
        state: "invalid",
        value: cellInput,
        error: message,
      }
    }
  }

  private createCell(
    col: ColRef,
    row: RowRef,
    properties?: CellProperties,
  ): Cell {
    const $properties = new BehaviorSubject<CellProperties>(
      properties || EMPTY_CELL,
    )

    const evaluateThisCell = this.evaluateCell.bind(this, col, row)
    const $view = $properties.pipe(mergeMap(evaluateThisCell))

    const parseThisCellInput = this.parseCellInput.bind(this, col, row)
    return {
      $properties: $properties.asObservable(),
      $view,
      editCell: () => {
        const $expressionValue = new BehaviorSubject<string>(
          this.getCellInputValueFromProperties(col, row, $properties.value),
        )

        const $preview = $expressionValue.pipe(debounceTime(500)).pipe(
          mergeMap(expression => {
            if (expression[0] === "=") {
              return evaluateThisCell({
                ...$properties.value,
                expression: parseThisCellInput(expression),
              })
            } else {
              return of(null)
            }
          }),
        )

        return <CellEditor>{
          $expressionValue: $expressionValue.asObservable(),
          $expressionPreview: $preview,
          updateExpressionValue: newValue => $expressionValue.next(newValue),
          apply: () => {
            $properties.next({
              ...$properties.value,
              expression: parseThisCellInput($expressionValue.value),
            })
            return Promise.resolve(true)
          },
        }
      },
    }
  }

  /**
   * This is the heart of the table calculation evaluator
   *
   * Responsibilites:
   *  1. Returns a Behavior with the value emitted from other cells.
   *  2. Based on properties.expression, if the expression depends on relative rows,
   *     we should recalculate and re-emit the next value.
   *  3. Similarly to #2, if column order changes, and our expression depends on
   *     values from relatively positioned columns, we re-calculate.
   *
   * Future:
   *  - properties.displayFormat could be a thing that changes the view display
   */
  evaluateCell(
    col: ColRef,
    row: RowRef,
    { expression }: CellProperties,
  ): Observable<CellView> {
    switch (expression.state) {
      case "invalid":
        return new BehaviorSubject<CellView>({
          ok: false,
          error: expression.error,
          formula: true,
        })
      case "valid":
        const cellNode = expression.valid
        switch (cellNode.kind) {
          case "empty":
            return new BehaviorSubject<CellView>({
              ok: true,
              display: "",
              value: 0,
              formula: false,
            })
          case "number":
          case "text":
            return new BehaviorSubject<CellView>({
              ok: true,
              display: String(cellNode.value),
              value: cellNode.value,
              formula: false,
            })
          case "expression":
            try {
              // TODO: Double check if this is as optimized as it can be,
              // or if we could be memoizing some things here
              const mappedExprCellView = mapExprReferences(
                this.lookupCellView.bind(this, col, row),
                cellNode.expression,
              )
              const fn = createExprEvaluatorFn(mappedExprCellView)
              return fn()
            } catch (err) {
              console.error("Failed to create evaluator", err)
              return new BehaviorSubject<CellView>({
                ok: false,
                error: `Parse error\nFailed to parse [${expression}]`,
                formula: true,
              })
            }
          default:
            const exhaust: never = cellNode
            return exhaust // exhaustive check
        }
    }
  }

  /**
   * Retrieve an observable of the latest CellView based on TableCellLocation,
   * When row order changes, and cell is relatively located, then a new value
   * may emit.
   */
  private lookupCellView = (
    contextCol: ColRef,
    contextRow: RowRef,
    tableLocation: TableCellLocation,
  ): Observable<CellView> => {
    return combineLatest(
      this.lookupColumn(contextCol, tableLocation.column),
      this.lookupRow(contextRow, tableLocation.row),
    ).pipe(mergeMap(([colRef, rowRef]) => this.getCellView(colRef, rowRef)))
  }

  private lookupColumn = (
    from: ColRef,
    tableLocation: TableColumnLocation,
  ): Observable<ColRef> => {
    if (tableLocation[0] === TablePosition.Relative) {
      const rel = tableLocation[1]
      return this.$columnOrder.pipe(
        map(cols => {
          const lastIndex = cols.length - 1
          const fromIndex = cols.indexOf(from)
          if (fromIndex < 0) {
            // TODO: we'll probably hit this until we fix GC
            throw new Error("Current column no longer exists")
          } else {
            return cols[Math.min(Math.max(0, fromIndex + rel), lastIndex)]
          }
        }),
        distinctUntilChanged(),
      )
    } else {
      const colRef = tableLocation[1]
      return new BehaviorSubject(colRef).asObservable()
    }
  }

  private lookupRow = (
    from: RowRef,
    tableLocation: TableRowLocation,
  ): Observable<RowRef> => {
    if (tableLocation[0] === TablePosition.Relative) {
      const rel = tableLocation[1]
      return this.$rowOrder.pipe(
        map(rows => {
          const lastIndex = rows.length - 1
          const fromIndex = rows.indexOf(from)
          if (fromIndex < 0) {
            // TODO: we'll probably hit this until we fix GC
            throw new Error("Current row no longer exists")
          } else {
            return rows[Math.min(Math.max(0, fromIndex + rel), lastIndex)]
          }
        }),
        distinctUntilChanged(),
      )
    } else {
      // position is static
      return new BehaviorSubject(tableLocation[1]).asObservable()
    }
  }

  private getCellInputValueFromProperties(
    col: ColRef,
    row: RowRef,
    { expression }: CellProperties,
  ): string {
    switch (expression.state) {
      case "invalid":
        return expression.value
      case "valid":
        const cellNode = expression.valid
        switch (cellNode.kind) {
          case "empty":
            return ""
          case "number":
          case "text":
            return String(cellNode.value)
          case "expression":
            return "=" + this.convertExprToString(col, row, cellNode.expression)
          default:
            const exhaust: never = cellNode
            return exhaust
        }
      default:
        const exhaust: never = expression
        return exhaust
    }
  }

  private convertExprToString(
    ctxCol: ColRef,
    ctxRow: RowRef,
    expr: ExprNode<TableCellLocation>,
  ): string {
    switch (expr.kind) {
      case "literal":
        return expr.jsEvalLiteral
      case "op":
        const left = this.convertExprToString(ctxCol, ctxRow, expr.left)
        const right = this.convertExprToString(ctxCol, ctxRow, expr.right)
        return left + expr.jsEvalOp + right
      case "reference":
        return this.convertTableLocationToString(ctxCol, ctxRow, expr.ref)
      default:
        const exhaust: never = expr
        return exhaust
    }
  }

  /**
   * context { col, row } & table location => "$A1" | "B$2" | etc
   * An inverse and reverse parsing of both
   * {@link Table.lookupParsedColumnLocation} and
   * {@link Table.lookupParsedRowLocation}
   */
  private convertTableLocationToString(
    ctxCol: ColRef,
    ctxRow: RowRef,
    location: TableCellLocation,
  ): string {
    const parsedColRef: ParsedColumnLocation = this.tableColumnToParsedColumnLocation(
      ctxCol,
      location.column,
    )
    const parsedRowRef: ParsedRowLocation = this.tableRowToParsedRowLocation(
      ctxRow,
      location.row,
    )

    return parsedReferenceToString(parsedColRef, parsedRowRef)
  }

  // TODO: purify
  private tableColumnToParsedColumnLocation = (
    from: ColRef,
    location: TableColumnLocation,
  ): ParsedColumnLocation => {
    if (location[0] === TablePosition.Relative) {
      const rel = location[1]
      const fromIndex = this.$columnOrder.value.indexOf(from)
      const column = COLUMNS_BY_INDEX[fromIndex + rel]!
      return [TablePosition.Relative, column]
    } else {
      // position is static
      const index = this.$columnOrder.value.indexOf(location[1])
      return [TablePosition.Static, COLUMNS_BY_INDEX[index]!]
    }
  }

  // TODO: purify
  private lookupParsedColumnLocation = (
    from: ColRef,
    [pos, idx]: ParsedColumnLocation,
  ): TableColumnLocation => {
    if (pos === TablePosition.Relative) {
      const toIndex = COLUMN_TO_INDEX.get(idx)!
      const fromIndex = this.$columnOrder.value.indexOf(from)
      // make wrapping possible with double letters, TODO: fix typescript !
      const rel = toIndex - fromIndex
      return [TablePosition.Relative, rel]
    } else {
      // position is static
      const toIndex = COLUMN_TO_INDEX.get(idx)!
      return [TablePosition.Static, this.$columnOrder.value[toIndex]]
    }
  }

  // TODO: purify
  private lookupParsedRowLocation = (
    from: RowRef,
    [pos, idx]: ParsedRowLocation,
  ): TableRowLocation => {
    if (pos === TablePosition.Relative) {
      const fromIndex = this.$rowOrder.value.indexOf(from)
      const rel = idx - fromIndex
      return [TablePosition.Relative, rel]
    } else {
      return [TablePosition.Static, this.$rowOrder.value[idx]]
    }
  }

  // TODO: purify
  private tableRowToParsedRowLocation = (
    from: RowRef,
    location: TableRowLocation,
  ): ParsedRowLocation => {
    if (location[0] === TablePosition.Relative) {
      const rel = location[1]
      const fromIndex = this.$rowOrder.value.indexOf(from)
      const row = fromIndex + rel
      return [TablePosition.Relative, row]
    } else {
      // position is static
      const index = this.$rowOrder.value.indexOf(location[1])
      return [TablePosition.Static, index]
    }
  }

  private getCellView = (col: ColRef, row: RowRef): Observable<CellView> => {
    try {
      return this.getCell(col, row).$view
    } catch (error) {
      console.error(`getCell does not exist`, error)
      // @ts-ignore
      return throwError("Cell does not exist")
    }
  }

  /** @throws if cell does not exist */
  getCell = (col: ColRef, row: RowRef): Cell => {
    return this.cells.get(col)!.get(row)!
  }
}
