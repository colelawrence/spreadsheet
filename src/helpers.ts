import React from "react"

export const genId = (suffix: string) =>
  Math.random()
    .toString(36)
    .slice(2) +
  "@" +
  suffix

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
export function onEnterOrClick(fn: () => void): React.HTMLAttributes<unknown> {
  return {
    tabIndex: 0,
    onClick: evt => {
      evt.stopPropagation()
      fn()
    },
    onKeyDown: evt => {
      if (evt.key === "Enter") {
        evt.stopPropagation()
        if (
          !(
            evt.currentTarget instanceof HTMLButtonElement ||
            evt.currentTarget instanceof HTMLAnchorElement
          )
        ) {
          // onClick will handle this one
          fn()
        }
      }
    },
  }
}

export function classnames(
  ...names: (string | null | undefined | void | false)[]
): string {
  return names.filter(a => !!a).join(" ")
}
