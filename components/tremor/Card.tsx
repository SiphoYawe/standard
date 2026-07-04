// Tremor Card [v1.0.0] — Slot dependency removed (no @radix-ui in this project).

import React from "react"

import { cx } from "./utils"

interface CardProps extends React.ComponentPropsWithoutRef<"div"> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, forwardedRef) => {
    return (
      <div
        ref={forwardedRef}
        className={cx(
          // base
          "relative w-full rounded-lg border p-6 text-left shadow-xs",
          // background color
          "bg-white dark:bg-[#090E1A]",
          // border color
          "border-gray-200 dark:border-gray-900",
          className,
        )}
        tremor-id="tremor-raw"
        {...props}
      />
    )
  },
)

Card.displayName = "Card"

export { Card, type CardProps }
