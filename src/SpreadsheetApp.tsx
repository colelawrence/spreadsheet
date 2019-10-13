import "behavior-state/react"
import React, { useMemo, useState } from "react"
import { combineLatest } from "rxjs"
import { COLUMNS_BY_INDEX } from "./columns"
import {
  changeValue,
  onEnterOrClick,
  preventDefaultThen,
  classnames,
} from "./helpers"
import { Cell, CellView, ColRef, RowRef, Table } from "./sheet"

export function SpreadsheetApp({ table }: { table: Table }) {
  const $rowsAndColumns = combineLatest(table.$rowOrder, table.$columnOrder)
  const CellViewMemo = React.memo(
    (props: { rowRef: RowRef; colRef: ColRef }) => {
      try {
        const cell = table.getCell(props.colRef, props.rowRef)
        return <CellController cell={cell} />
      } catch (err) {
        return <td className="cell cell-err">#NoCell</td>
      }
    },
  )

  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <table.$columnOrder.react
            next={colRefs =>
              COLUMNS_BY_INDEX.slice(0, colRefs.length).map(label => (
                <th key={label}>{label}</th>
              ))
            }
          />
        </tr>
      </thead>
      <tbody>
        <$rowsAndColumns.react
          next={([rowRefs, columnRefs]) =>
            rowRefs.map((rowRef, idx) => (
              <tr key={rowRef.id}>
                <td className="table-row-number">{idx}</td>
                {columnRefs.map(colRef => (
                  <CellViewMemo
                    key={colRef.id}
                    colRef={colRef}
                    rowRef={rowRef}
                  />
                ))}
              </tr>
            ))
          }
        />
      </tbody>
    </table>
  )
}

enum EditingState {
  Editing = 0,
  NotFocused = 1,
  Focused = 2,
}

function CellController({ cell }: { cell: Cell }) {
  const [editingState, setEditing] = useState(EditingState.NotFocused)

  return editingState === EditingState.Editing ? (
    <td className="cell cell-editing">
      <CellEditor
        cell={cell}
        close={(keepFocus: boolean) =>
          setEditing(keepFocus ? EditingState.Focused : EditingState.NotFocused)
        }
      />
    </td>
  ) : (
    <cell.$view.react
      next={cellView => (
        <td
          className={classnames(
            "cell",
            "cell-display",
            typeof cellView.value === "number" && "cell-display-number",
            cellView.calculated && "cell-display-calculated",
          )}
          {...onEnterOrClick(() => setEditing(EditingState.Editing))}
          ref={elt => {
            if (editingState === EditingState.Focused && elt != null) {
              setTimeout(() => elt.focus(), 10)
            }
          }}
        >
          {cellView.display}
        </td>
      )}
    />
  )
}

function CellEditor({
  cell,
  close,
}: {
  cell: Cell
  close: (keepFocus: boolean) => void
}) {
  // state store
  const edit = useMemo(() => cell.editCell(), [cell])

  return (
    <form
      className="cell-editor-container"
      onSubmit={preventDefaultThen(() => edit.apply().then(() => close(true)))}
    >
      <edit.$expressionValue.react
        next={exprValue => (
          <input
            alt="Update expression input"
            type="text"
            value={exprValue}
            onChange={changeValue(edit.updateExpressionValue)}
            onBlur={() => {
              edit.apply().then(() => close(false))
            }}
            ref={elt => {
              if (elt instanceof HTMLInputElement) {
                setTimeout(() => elt.focus(), 10)
              }
            }}
          />
        )}
      />
      <edit.$expressionPreview.react
        next={(previewCellView: CellView | null) =>
          previewCellView && (
            <div className="preview">
              <span className="cell-preview-value">
                {previewCellView.value}
              </span>
            </div>
          )
        }
      />
    </form>
  )
}
