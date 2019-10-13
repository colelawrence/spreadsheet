import { BehaviorSubject, combineLatest, Observable, throwError } from "rxjs"
import { map, mergeMap } from "rxjs/operators"
import { ColumnLocation, ExprNode, parseCell, RowLocation } from "./parser"
import { CellProperties, CellValue, CellView, ColRef, RowRef } from "./sheet"

export type EvaluatorFn = (
  fromCol: ColRef,
  fromRow: RowRef,
  lookupColumn: (from: ColRef, to: ColumnLocation) => Observable<ColRef>,
  lookupRow: (from: RowRef, to: RowLocation) => Observable<RowRef>,
  getCell: (col: ColRef, row: RowRef) => Observable<CellView>,
) => Observable<CellView>

/** no comment */
export function createEvaluator({ expression }: CellProperties): EvaluatorFn {
  try {
    let parsed = parseCell(expression)

    switch (parsed.kind) {
      case "empty":
        return createEmptyEvaluatorFn()
      case "number":
      case "text":
        return createSimpleEvaluatorFn(parsed.value)
      case "expression":
        return createExprEvaluatorFn(parsed.expression)
      default:
        const _exhaust: never = parsed
        return _exhaust // exhaustive check
    }
  } catch (err) {
    const message = `Failed to parse: [${expression}]`
    console.error(message, err)
    //@ts-ignore
    return () => throwError(message)
  }
}

function createSimpleEvaluatorFn(value: number | string): EvaluatorFn {
  const $value = new BehaviorSubject<CellView>({
    value,
    display: String(value),
    calculated: false,
  })
  return () => $value.asObservable()
}

function createEmptyEvaluatorFn(): EvaluatorFn {
  const $value = new BehaviorSubject<CellView>({
    value: 0,
    display: "",
    calculated: false,
  })
  return () => $value.asObservable()
}

type BuildContext = {
  nextId(): string
}

const r = {
  BehaviorSubject,
  combineLatest,
  mergeMap,
  map,
}

function createExprEvaluatorFn(expression: ExprNode): EvaluatorFn {
  let i = 0
  const buildCtx = {
    nextId: () => `_${++i}`,
  }
  const { body, id } = buildExprEvalBody(buildCtx, expression)
  //@ts-ignore no comment...
  return new Function(
    "r",
    "$fromCol",
    "$fromRow",
    "$lookupColumn",
    "$lookupRow",
    "$getCell",
    `${body};\nreturn ${id}.pipe(r.map(cellView => ({ ...cellView, calculated: true })));`,
  ).bind(null, r)
}

function buildExprEvalBody(ctx: BuildContext, expr: ExprNode): EvalBodyPart {
  switch (expr.kind) {
    case "literal": {
      const id = "lit" + ctx.nextId()
      return {
        id,
        body: `let ${id} = (new r.BehaviorSubject(${expr.jsEvalLiteral})).asObservable();`,
      }
    }
    case "reference": {
      const id = "ref" + ctx.nextId()
      return {
        id,
        body: `
let ${id} = r.combineLatest(
  $lookupColumn($fromCol, ${JSON.stringify(expr.column)}),
  $lookupRow($fromRow, ${JSON.stringify(expr.row)}),
)
  .pipe(r.mergeMap(([col, row]) => $getCell(col, row)))
  .pipe(r.map(cellView => cellView.value));`,
      }
    }
    case "op": {
      const id = "op" + ctx.nextId()
      const left = buildExprEvalBody(ctx, expr.left)
      const right = buildExprEvalBody(ctx, expr.left)
      return {
        id,
        body: `
${left.body}
${right.body}
let ${id} = r.combineLatest(${left.id}, ${right.id})
  .pipe(r.map(([left, right]) => left ${expr.jsEvalOp} right));
`,
      }
    }
    default:
      const exhaust: never = expr
      return exhaust
  }
}

// example of a expression built
function testExprEvaluatorFn(expression: ExprNode): EvaluatorFn {
  return (
    fromCol: ColRef,
    fromRow: RowRef,
    lookupColumn: (from: ColRef, to: ColumnLocation) => Observable<ColRef>,
    lookupRow: (from: RowRef, to: RowLocation) => Observable<RowRef>,
    getCell: (col: ColRef, row: RowRef) => Observable<CellView>,
  ): Observable<CellView> => {
    // let's say we were building the operators for $A1 + $B1
    let __1: Observable<CellValue>
    {
      const _refCol: ColumnLocation = [0, "A"]
      const _refRow: RowLocation = [1, 1]
      //
      __1 = combineLatest(
        lookupColumn(fromCol, _refCol),
        lookupRow(fromRow, _refRow),
      )
        .pipe(mergeMap(([col, row]) => getCell(col, row)))
        .pipe(map(cellView => cellView.value))
    }

    let __2: Observable<CellValue>
    {
      const _refCol: ColumnLocation = [0, "A"]
      const _refRow: RowLocation = [1, 1]
      //
      __2 = combineLatest(
        lookupColumn(fromCol, _refCol),
        lookupRow(fromRow, _refRow),
      )
        .pipe(mergeMap(([col, row]) => getCell(col, row)))
        .pipe(map(cellView => cellView.value))
    }

    // @ts-ignore __1, __2
    let __0 = combineLatest(__1, __2).pipe(map(([__1, __2]) => __1 + __2))

    return __0
  }
}

type EvalBodyPart = {
  id: string
  body: string
}
