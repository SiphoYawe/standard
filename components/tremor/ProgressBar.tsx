// Tremor ProgressBar [v0.0.3]

import React from "react"
import { tv, type VariantProps } from "tailwind-variants"

import { cx } from "./utils"

const progressBarVariants = tv({
  slots: {
    background: "",
    bar: "",
  },
  variants: {
    variant: {
      default: {
        background: "bg-brand-green/20 dark:bg-brand-green/25",
        bar: "bg-brand-green dark:bg-brand-green",
      },
      neutral: {
        background: "bg-gray-200 dark:bg-gray-500/40",
        bar: "bg-gray-500 dark:bg-gray-400",
      },
      warning: {
        background: "bg-brand-mid/20 dark:bg-brand-mid/30",
        bar: "bg-brand-mid dark:bg-brand-mid",
      },
      error: {
        background: "bg-brand-dark/20 dark:bg-brand-mid/25",
        bar: "bg-brand-dark dark:bg-brand-mid",
      },
      success: {
        background: "bg-brand-green/20 dark:bg-brand-green/25",
        bar: "bg-brand-green dark:bg-brand-green",
      },
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

interface ProgressBarProps
  extends React.HTMLProps<HTMLDivElement>,
    VariantProps<typeof progressBarVariants> {
  value?: number
  max?: number
  showAnimation?: boolean
  label?: string
}

const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  (
    {
      value = 0,
      max = 100,
      label,
      showAnimation = false,
      variant,
      className,
      ...props
    }: ProgressBarProps,
    forwardedRef,
  ) => {
    const safeValue = Math.min(max, Math.max(value, 0))
    const { background, bar } = progressBarVariants({ variant })
    return (
      <div
        ref={forwardedRef}
        className={cx("flex w-full items-center", className)}
        role="progressbar"
        aria-label="Progress bar"
        aria-valuenow={value}
        aria-valuemax={max}
        tremor-id="tremor-raw"
        {...props}
      >
        <div
          className={cx(
            "relative flex h-2 w-full items-center rounded-full",
            background(),
          )}
        >
          <div
            className={cx(
              "h-full flex-col rounded-full",
              bar(),
              showAnimation &&
                "transform-gpu transition-all duration-300 ease-in-out",
            )}
            style={{
              width: max ? `${(safeValue / max) * 100}%` : `${safeValue}%`,
            }}
          />
        </div>
        {label ? (
          <span
            className={cx(
              "ml-2 whitespace-nowrap text-sm font-medium leading-none",
              "text-gray-900 dark:text-gray-50",
            )}
          >
            {label}
          </span>
        ) : null}
      </div>
    )
  },
)

ProgressBar.displayName = "ProgressBar"

export { ProgressBar, progressBarVariants, type ProgressBarProps }
