// Tremor Badge [v1.0.0]

import React from "react"
import { tv, type VariantProps } from "tailwind-variants"

import { cx } from "./utils"

const badgeVariants = tv({
  base: cx(
    "inline-flex items-center gap-x-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset",
  ),
  variants: {
    variant: {
      // Informational / medium confidence
      default: [
        "bg-gray-100 text-gray-700 ring-gray-500/20",
        "dark:bg-gray-500/15 dark:text-gray-300 dark:ring-gray-400/20",
      ],
      // Quiet neutral
      neutral: [
        "bg-gray-50 text-gray-600 ring-gray-500/20",
        "dark:bg-white/5 dark:text-gray-400 dark:ring-white/10",
      ],
      // Positive / healthy / confident
      success: [
        "bg-brand-green/10 text-brand-green ring-brand-green/25",
        "dark:bg-brand-green/15 dark:text-brand-green dark:ring-brand-green/30",
      ],
      // Loss / costing you - dark teal, never red
      error: [
        "bg-brand-dark/10 text-brand-dark ring-brand-dark/25",
        "dark:bg-brand-dark/60 dark:text-gray-50 dark:ring-brand-green/35",
      ],
      // Caution / watch / needs a check
      warning: [
        "bg-brand-mid/10 text-brand-mid ring-brand-mid/25",
        "dark:bg-brand-mid/20 dark:text-brand-green dark:ring-brand-mid/30",
      ],
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

interface BadgeProps
  extends React.ComponentPropsWithoutRef<"span">,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }: BadgeProps, forwardedRef) => {
    return (
      <span
        ref={forwardedRef}
        className={cx(badgeVariants({ variant }), className)}
        tremor-id="tremor-raw"
        {...props}
      />
    )
  },
)

Badge.displayName = "Badge"

export { Badge, badgeVariants, type BadgeProps }
