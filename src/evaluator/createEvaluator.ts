import { BehaviorSubject, combineLatest, Observable } from "rxjs"
import { map, mergeMap } from "rxjs/operators"
import { dbg } from "../helpers"
import { CellNode, ExprNode } from "../parser/parseCell"
import { CellValue, CellView } from "../table"

export type EvaluatorFn = () => Observable<CellView>

type BuildContext = {
  nextId(): string
}

// used in evaluator to prevent mangling
const r = {
  BehaviorSubject,
  combineLatest,
  mergeMap,
  map,
}

export function createExprEvaluatorFn(expression: EvalExprNode): EvaluatorFn {
  let i = 0
  const buildCtx = {
    nextId: () => `_${++i}`,
  }
  const { body, id, refs, injects } = buildExprEvalBody(buildCtx, expression)
  dbg({ expression, id, refs, injects }, body)
  const injectVarIds = Object.keys(injects)
  const injectVars = injectVarIds.map(id => injects[id])

  const newFunctionBinds = [...injectVars, r]
  const newFunctionArgs = [
    ...injectVarIds,
    "r",
    // args will start here:
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
  ]

  //@ts-ignore powerful, but dangerous
  return new Function(...newFunctionArgs).bind(null, ...newFunctionBinds)
}

// Hypothetically, if we were type checking the eval,
// this would be the type that is shared between stages
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

type EvalExprNode = ExprNode<Observable<CellView>>

function buildExprEvalBody(
  ctx: BuildContext,
  expr: EvalExprNode,
): EvalBodyPart {
  switch (expr.kind) {
    case "literal": {
      const id = "lit" + ctx.nextId()
      return {
        id,
        refs: 0,
        injects: {},
        body: `let ${id} = new r.BehaviorSubject({ value: ${expr.jsEvalLiteral}, ok: true });`,
      }
    }
    case "reference": {
      const id = "ref" + ctx.nextId()
      const cellRefId = "cell" + ctx.nextId()
      return {
        id,
        refs: 1,
        injects: { [cellRefId]: expr.ref },
        body: `
let ${id} = ${cellRefId}
  .pipe(r.map(cellView => {
    if (cellView.ok) {
      return cellView
    } else {
      return {
        ok: false,
        error: 'Reference has error\\n' + cellView.error,
      }
    }
  }));`,
      }
    }
    case "op": {
      const id = "op" + ctx.nextId()
      const left = buildExprEvalBody(ctx, expr.left)
      const right = buildExprEvalBody(ctx, expr.right)
      return {
        id,
        refs: left.refs + right.refs,
        injects: { ...left.injects, ...right.injects },
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
          error: "${expr.jsEvalOp} error\\nCould not evaluate (" + left.value + " ${expr.jsEvalOp} " + right.value + ")"
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
  injects: {
    [id: string]: any
  }
  refs: number
  body: string
}
