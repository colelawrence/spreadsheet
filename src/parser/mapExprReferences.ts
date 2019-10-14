import { ExprNode } from "./parseCell"

// at the expression level
export function mapExprReferences<A, B>(
  /** Called for every reference */
  mapFn: (from: A) => B,
  expr: ExprNode<A>,
): ExprNode<B> {
  switch (expr.kind) {
    case "op":
      return {
        ...expr,
        left: mapExprReferences(mapFn, expr.left),
        right: mapExprReferences(mapFn, expr.right),
      }
    case "reference":
      return {
        ...expr,
        ref: mapFn(expr.ref),
      }
    default:
      return expr
  }
}
