// Tremor Button [v1.0.0] - Slot dependency removed (no @radix-ui in this project).

import React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { tv, type VariantProps } from "tailwind-variants"

import { cx, focusRing } from "./utils"

const buttonVariants = tv({
  base: [
    "relative inline-flex items-center justify-center whitespace-nowrap rounded-md border px-3 py-2 text-center text-sm font-medium shadow-xs transition-all duration-100 ease-in-out",
    "disabled:pointer-events-none disabled:shadow-none",
    focusRing,
  ],
  variants: {
    variant: {
      primary: [
        "border-transparent",
        "text-white dark:text-white",
        "bg-brand-green dark:bg-brand-green",
        "hover:bg-brand-green/90 dark:hover:bg-brand-green/90",
        "disabled:bg-brand-green/50 disabled:text-white",
        "dark:disabled:bg-brand-green/40 dark:disabled:text-white/70",
      ],
      secondary: [
        "border-gray-300 dark:border-gray-800",
        "text-gray-900 dark:text-gray-50",
        "bg-white dark:bg-gray-950",
        "hover:bg-gray-50 dark:hover:bg-gray-900/60",
        "disabled:text-gray-400",
        "dark:disabled:text-gray-600",
      ],
      light: [
        "shadow-none",
        "border-transparent",
        "text-gray-900 dark:text-gray-50",
        "bg-gray-200 dark:bg-gray-900",
        "hover:bg-gray-300/70 dark:hover:bg-gray-800/80",
        "disabled:bg-gray-100 disabled:text-gray-400",
        "dark:disabled:bg-gray-800 dark:disabled:text-gray-600",
      ],
      ghost: [
        "shadow-none",
        "border-transparent",
        "text-gray-900 dark:text-gray-50",
        "bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800/80",
        "disabled:text-gray-400",
        "dark:disabled:text-gray-600",
      ],
      destructive: [
        "text-white",
        "border-transparent",
        "bg-brand-dark dark:bg-brand-dark",
        "hover:bg-brand-dark/90 dark:hover:bg-brand-dark/80",
        "disabled:bg-brand-dark/40 disabled:text-white",
        "dark:disabled:bg-brand-dark/50 dark:disabled:text-white/70",
      ],
    },
  },
  defaultVariants: {
    variant: "primary",
  },
})

interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      isLoading = false,
      loadingText,
      className,
      disabled,
      variant,
      children,
      ...props
    }: ButtonProps,
    forwardedRef,
  ) => {
    return (
      <button
        ref={forwardedRef}
        className={cx(buttonVariants({ variant }), className)}
        disabled={disabled || isLoading}
        tremor-id="tremor-raw"
        {...props}
      >
        {isLoading ? (
          <span className="pointer-events-none flex shrink-0 items-center justify-center gap-1.5">
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
            <span className="sr-only">
              {loadingText ? loadingText : "Loading"}
            </span>
            {loadingText ? loadingText : children}
          </span>
        ) : (
          children
        )}
      </button>
    )
  },
)

Button.displayName = "Button"

export { Button, buttonVariants, type ButtonProps }
