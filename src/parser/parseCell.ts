export enum TablePosition {
  Static = 0,
  Relative = 1,
}

/** Positioning kind, column name */
export type ParsedColumnLocation = [TablePosition, string]
/** Positioning kind, row name */
export type ParsedRowLocation = [TablePosition, string]

// TODO: Reference regexp is tied to axisNames... perhaps these pieces deserve to be grouped
const REFERENCE_RE = /^\s*(\$?)([A-Z]{1,3})(\$?)([0-9]+)\s*$/

const JS_OPERATION_RE = /^(.+?)\s*([\+\-\/]|\*{1,2})\s*(.+)$/

/** Top level cell text entry */
export type CellNode<Ref> =
  | {
      kind: "expression"
      expression: ExprNode<Ref>
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

/** Expression level */
export type ExprNode<Ref> =
  | {
      kind: "op"
      left: ExprNode<Ref>
      /** example "+", "-", etc */
      jsEvalOp: string
      right: ExprNode<Ref>
    }
  | {
      kind: "literal"
      jsEvalLiteral: string
    }
  | ({
      kind: "reference"
      ref: Ref
    })

export type ParserCellRef = {
  column: ParsedColumnLocation
  row: ParsedRowLocation
}

export class ParseError extends Error {}

/** @throws {ParseError} */
export function parseCell(input: string): CellNode<ParserCellRef> {
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

type ParserExprNode = ExprNode<ParserCellRef>

function parseJsOperation(input: string): ParserExprNode | void {
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

/** @throws {ParseError} */
function parseExpression(input: string): ParserExprNode {
  // precedent set here
  let value = parseJsOperation(input)
  if (value == null) value = parseReference(input)
  if (value == null) value = parseLiteral(input)
  if (value == null) throw new ParseError("Unable to parse expression")
  else return value
}

function parseLiteral(input: string): ParserExprNode | void {
  try {
    const value = JSON.parse(input)
    return {
      kind: "literal",
      jsEvalLiteral: JSON.stringify(value),
    }
  } catch {}
}

function parseReference(input: string): ParserExprNode | void {
  const matches = REFERENCE_RE.exec(input)
  if (matches != null) {
    const [_, isStaticColumn, columnName, isStaticRow, rowName] = matches
    return {
      kind: "reference",
      ref: {
        column: [
          isStaticColumn ? TablePosition.Static : TablePosition.Relative,
          columnName,
        ],
        row: [
          isStaticRow ? TablePosition.Static : TablePosition.Relative,
          rowName,
        ],
      },
    }
  }
}

export function parsedReferenceToString(
  col: ParsedColumnLocation,
  row: ParsedRowLocation,
): string {
  const colPrefix = col[0] === TablePosition.Static ? "$" : ""
  const colPart = colPrefix + col[1]
  const rowPrefix = row[0] === TablePosition.Static ? "$" : ""
  const rowPart = rowPrefix + row[1]
  return colPart + rowPart
}
