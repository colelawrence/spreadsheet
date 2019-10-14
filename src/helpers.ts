import React from "react"

export const genId = (suffix: string) =>
  Math.random()
    .toString(36)
    .slice(2) +
  "@" +
  suffix

export const expectNotNull = <T> (element: T | null | undefined, message: string): T => {
  if (element == null) {
    throw new Error(message)
  } else {
    return element
  }
}

/** helper for use with onChange functions */
export function changeValue(
  handler: (value: string) => void,
): (evt: React.ChangeEvent<HTMLFormElement | HTMLInputElement>) => void {
  return evt => handler(evt.currentTarget.value)
}

/** helper for canceling default behaviors in functions */
export function preventDefaultThen(
  handler: () => void,
): (evt: { preventDefault: () => void }) => void {
  return evt => {
    evt.preventDefault()
    handler()
  }
}

/** helper for responding to enter key and click events */
export function onEnterOrClick(
  fn: (
    event: React.MouseEvent<unknown, MouseEvent> | React.KeyboardEvent<unknown>,
  ) => void,
): React.HTMLAttributes<unknown> {
  return {
    tabIndex: 0,
    onClickCapture: fn,
    onKeyDown: evt => {
      if (evt.key === "Enter") {
        evt.stopPropagation()
        if (
          !(
            evt.currentTarget instanceof HTMLButtonElement ||
            evt.currentTarget instanceof HTMLAnchorElement
          )
        ) {
          // onClick will handle others
          fn(evt)
        }
      }
    },
  }
}

/** helper for responding to enter key events */
export function onEnterOrDoubleClick(
  fn: (
    event: React.MouseEvent<unknown, MouseEvent> | React.KeyboardEvent<unknown>,
  ) => void,
): React.HTMLAttributes<unknown> {
  return {
    tabIndex: 0,
    onDoubleClickCapture: fn,
    onKeyDown: evt => {
      if (evt.key === "Enter") {
        evt.stopPropagation()
        fn(evt)
      }
    },
  }
}

export function classnames(
  ...names: (string | null | undefined | void | false)[]
): string {
  return names.filter(a => !!a).join(" ")
}

export function moveAfter<T>(arr: T[], move: T, after: T): T[] {
  const head = arr.filter(existing => existing !== move)
  const tail = head.splice(head.indexOf(after) + 1)
  return [...head, move, ...tail]
}

export function moveBefore<T>(arr: T[], move: T, before: T): T[] {
  const head = arr.filter(existing => existing !== move)
  const tail = head.splice(head.indexOf(before))
  return [...head, move, ...tail]
}

export const dbg = console.info.bind(console, "%cDebug", "color: green")
