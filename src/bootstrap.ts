import { render } from "react-dom"
import React from "react"
import { SpreadsheetApp } from "./SpreadsheetApp"
import { Table } from "./sheet"

const appElt = document.getElementById("app-container")

if (appElt instanceof HTMLElement) {
  const table = new Table({ rows: 2, cols: 4 })
  render(React.createElement(SpreadsheetApp, { table }), appElt)
}
