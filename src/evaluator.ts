import { BehaviorSubject, combineLatest, Observable, throwError } from "rxjs"
import { map, mergeMap } from "rxjs/operators"
import { ColumnLocation, ExprNode, parseCell, RowLocation } from "./parser"
import { CellProperties, CellValue, CellView, ColRef, RowRef } from "./sheet"
import { dbg } from "./helpers"

export type EvaluatorFn = (
  fromCol: ColRef,
  fromRow: RowRef,
  lookupColumn: (from: ColRef, to: ColumnLocation) => Observable<ColRef>,
  lookupRow: (from: RowRef, to: RowLocation) => Observable<RowRef>,
  getCell: (col: ColRef, row: RowRef) => Observable<CellView>,
) => Observable<CellView>

/** @throws / no comment */
export function createEvaluator({ expression }: CellProperties): EvaluatorFn {
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
}

function createSimpleEvaluatorFn(value: number | string): EvaluatorFn {
  const $value = new BehaviorSubject<CellView>({
    ok: true,
    value,
    display: String(value),
    formula: false,
  })
  return () => $value.asObservable()
}

function createEmptyEvaluatorFn(): EvaluatorFn {
  const $value = new BehaviorSubject<CellView>({
    ok: true,
    value: 0,
    display: "",
    formula: false,
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
  const { body, id, refs } = buildExprEvalBody(buildCtx, expression)
  dbg({ expression, id }, body)
  //@ts-ignore powerful, but dangerous
  return new Function(
    "r",
    "$fromCol",
    "$fromRow",
    "$lookupColumn",
    "$lookupRow",
    "$getCell",
    `${body};\nreturn ${id}.pipe(r.map(res => {
      if (res.ok) {
        return {
          ok: true,
          value: res.value,
          display: String(res.value),
          formula: true
        }
      } else {
        return {
          ok: false,
          error: res.error,
          formula: true
        }
      }
    }));`,
  ).bind(null, r)
}

// Hypothetically, this would be the type that is shared between stages
// it intentionally has overlap with CellView
type ExprValue =
  | {
      ok: true
      value: CellValue
    }
  | {
      ok: false
      error: string
    }

function buildExprEvalBody(ctx: BuildContext, expr: ExprNode): EvalBodyPart {
  switch (expr.kind) {
    case "literal": {
      const id = "lit" + ctx.nextId()
      return {
        id,
        refs: 0,
        body: `let ${id} = new r.BehaviorSubject({ value: ${expr.jsEvalLiteral}, ok: true });`,
      }
    }
    case "reference": {
      const id = "ref" + ctx.nextId()
      return {
        id,
        refs: 1,
        body: `
let ${id} = r.combineLatest(
  $lookupColumn($fromCol, ${JSON.stringify(expr.column)}),
  $lookupRow($fromRow, ${JSON.stringify(expr.row)}),
)
  .pipe(r.mergeMap(([col, row]) =>
    (col === $fromCol && row === $fromRow)
    ? new r.BehaviorSubject({
      ok: false,
      error: "Self-Reference\\nCells may not refer to its own value",
    })
    : $getCell(col, row)
      .pipe(r.map(cellView => {
        if (cellView.ok) {
          return cellView
        } else {
          return {
            ok: false,
            error: 'Reference has error\\n' + cellView.error,
          }
        }
      }))
    
  ));`,
      }
    }
    case "op": {
      const id = "op" + ctx.nextId()
      const left = buildExprEvalBody(ctx, expr.left)
      const right = buildExprEvalBody(ctx, expr.right)
      return {
        id,
        refs: left.refs + right.refs,
        body: `
${left.body}
${right.body}
let ${id} = r.combineLatest(${left.id}, ${right.id})
  .pipe(r.map(([left, right]) => {
    if (left.ok && right.ok) {
      try {
        return {
          ok: true,
          value: left.value ${expr.jsEvalOp} right.value
        }
      } catch {
        return {
          ok: false,
          error: "${expr.jsEvalOp} error\nCould not evaluate (" + left.value + " ${expr.jsEvalOp} " + right.value + ")"
        }
      }
    } else {
      return {
        ok: false,
        error: "Dependency has error"
      }
    }
  }));
`,
      }
    }
    default:
      const exhaust: never = expr
      return exhaust
  }
}

type EvalBodyPart = {
  id: string
  refs: number
  body: string
}
