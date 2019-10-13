export enum TablePosition {
  Static = 0,
  Relative = 1,
}

export type ColumnLocation = [TablePosition, string]
export type RowLocation = [TablePosition, number]

const JS_OPERATION_RE = /^(.+?)\s*([\+\-\/]|\*{1,2})\s*(.+)$/
function parseJsOperation(input: string): ExprNode | void {
  const match = JS_OPERATION_RE.exec(input)
  if (match != null) {
    return {
      kind: "op",
      left: parseExpression(match[1]),
      jsEvalOp: match[2],
      right: parseExpression(match[3]),
    }
  }
}

function parseExpression(input: string): ExprNode {
  // precedent set here
  let value = parseJsOperation(input)
  if (value == null) value = parseReference(input)
  if (value == null) value = parseLiteral(input)
  if (value == null) throw new ParseError("Unable to parse expression")
  else return value
}

class ParseError extends Error {}

/** @throws {ParseError} */
export function parseCell(input: string): CellNode {
  if (input.length === 0) {
    return {
      kind: "empty",
    }
  } else if (input[0] === "=") {
    return {
      kind: "expression",
      expression: parseExpression(input.slice(1)),
    }
  } else {
    const numberValue = Number(input)
    if (isNaN(numberValue)) {
      return {
        kind: "text",
        value: input,
      }
    } else {
      return {
        kind: "number",
        value: numberValue,
      }
    }
  }
}

const REFERENCE_RE = /^\s*(\$?)([A-Z]{1,3})(\$?)([0-9]+)\s*$/
const parseReference = (input: string): ExprNode | void => {
  const matches = REFERENCE_RE.exec(input)
  if (matches != null) {
    const [_, isStaticColumn, column, isStaticRow, row] = matches
    return {
      kind: "reference",
      column: [
        isStaticColumn ? TablePosition.Static : TablePosition.Relative,
        column,
      ],
      row: [
        isStaticRow ? TablePosition.Static : TablePosition.Relative,
        parseInt(row),
      ],
    }
  }
}

// extremely simple for now
const parseLiteral = (input: string): ExprNode | void => {
  try {
    const value = JSON.parse(input)
    return {
      kind: "literal",
      jsEvalLiteral: JSON.stringify(value),
    }
  } catch {}
}

export type CellNode =
  | {
      kind: "expression"
      expression: ExprNode
    }
  | {
      kind: "number"
      value: number
    }
  | {
      kind: "text"
      value: string
    }
  | {
      kind: "empty"
    }

export type ExprNode =
  | {
      kind: "op"
      left: ExprNode
      jsEvalOp: string
      right: ExprNode
    }
  | {
      kind: "literal"
      jsEvalLiteral: string
    }
  | {
      kind: "reference"
      column: ColumnLocation
      row: RowLocation
    }
