import { BehaviorSubject, Observable, throwError, of } from "rxjs"
import { map, mergeMap, take, debounceTime } from "rxjs/operators"
import { COLUMN_TO_INDEX } from "./columns"
import { createEvaluator } from "./evaluator"
import { ColumnLocation, RowLocation, TablePosition } from "./parser"
import { genId } from "./helpers"

export type CellProperties = {
  expression: string
}

export type CellValue = string | number | undefined
export type CellView = {
  display: string
  value: CellValue
  calculated: boolean
}

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

  private createCell(
    col: ColRef,
    row: RowRef,
    properties?: CellProperties,
  ): Cell {
    const $properties = new BehaviorSubject(
      properties || {
        expression: "",
      },
    )
    const calculate = this.evaluateCell.bind(this, col, row)
    const $view = $properties.pipe(mergeMap(calculate))

    $properties.subscribe(properties => console.log({ col, row, properties }))

    return {
      $properties: $properties.asObservable(),
      $view: $view,
      editCell: () => {
        const $expressionValue = new BehaviorSubject(
          $properties.value.expression,
        )

        const $preview = $expressionValue
          .pipe(debounceTime(500))
          .pipe(
            mergeMap(expression =>
              expression[0] === "="
                ? calculate({ ...$properties.value, expression })
                : of(null),
            ),
          )

        return {
          $expressionValue: $expressionValue.asObservable(),
          $expressionPreview: $preview,
          updateExpressionValue: newValue => $expressionValue.next(newValue),
          apply: () => {
            $properties.next({
              ...$properties.value,
              expression: $expressionValue.value,
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
    properties: CellProperties,
  ): Observable<CellView> {
    const fn = createEvaluator(properties)
    return fn(col, row, this.lookupColumn, this.lookupRow, this.getCellView)
  }

  lookupColumn = (
    from: ColRef,
    [pos, idx]: ColumnLocation,
  ): Observable<ColRef> => {
    if (pos === TablePosition.Relative) {
      const toIndex = COLUMN_TO_INDEX.get(idx)!
      const fromIndex = this.$columnOrder.value.indexOf(from)
      // make wrapping possible with double letters, TODO: fix typescript !
      const rel = toIndex - fromIndex

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
      )
    } else {
      // position is static
      const toIndex = COLUMN_TO_INDEX.get(idx)!
      return new BehaviorSubject(
        this.$columnOrder.value[toIndex],
      ).asObservable()
    }
  }
  lookupRow = (from: RowRef, [pos, idx]: RowLocation): Observable<RowRef> => {
    if (pos === TablePosition.Relative) {
      const fromIndex = this.$rowOrder.value.indexOf(from)
      const rel = idx - fromIndex

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
      )
    } else {
      // position is static
      return new BehaviorSubject(this.$rowOrder.value[idx]).asObservable()
    }
  }
  getCellView = (col: ColRef, row: RowRef): Observable<CellView> => {
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
