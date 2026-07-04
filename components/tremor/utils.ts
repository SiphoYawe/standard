// Vendored Tremor Raw utilities (cx, focus rings, chart colors, helpers).
// Adjusted for Standard's flat components/tremor/ layout.

import clsx, { type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cx(...args: ClassValue[]) {
  return twMerge(clsx(...args))
}

// Tremor focusRing [v0.0.1] - Standard brand green
export const focusRing = [
  "outline outline-offset-2 outline-0 focus-visible:outline-2",
  "outline-brand-green dark:outline-brand-green",
]

// Tremor focusInput [v0.0.2] - Standard brand green
export const focusInput = [
  "focus:ring-2",
  "focus:ring-brand-green/30 dark:focus:ring-brand-green/40",
  "focus:border-brand-green dark:focus:border-brand-green",
]

// Tremor hasErrorInput [v0.0.1] - negatives use dark teal, never red
export const hasErrorInput = [
  "ring-2",
  "border-brand-dark dark:border-brand-mid",
  "ring-brand-dark/20 dark:ring-brand-mid/30",
]

// Tremor getYAxisDomain [v0.0.0]
export const getYAxisDomain = (
  autoMinValue: boolean,
  minValue: number | undefined,
  maxValue: number | undefined,
) => {
  const minDomain = autoMinValue ? "auto" : (minValue ?? 0)
  const maxDomain = maxValue ?? "auto"
  return [minDomain, maxDomain]
}

// Tremor chartColors [v0.1.0] - Standard brand palette only.
// Every key maps to one of the three brand hues (green / mid / dark). Series
// whose light-mode tone is dark teal carry a dark-mode variant so they stay
// readable on the dark-teal card surface.
export type ColorUtility = "bg" | "stroke" | "fill" | "text"

export const chartColors = {
  // Healthy / positive / revenue
  green: {
    bg: "bg-brand-green",
    stroke: "stroke-brand-green",
    fill: "fill-brand-green",
    text: "text-brand-green",
  },
  // Secondary
  mid: {
    bg: "bg-brand-mid",
    stroke: "stroke-brand-mid",
    fill: "fill-brand-mid",
    text: "text-brand-mid",
  },
  // Loss / cost / negative - dark teal on light, lifted to mid on dark surfaces
  dark: {
    bg: "bg-brand-dark dark:bg-brand-mid",
    stroke: "stroke-brand-dark dark:stroke-brand-mid",
    fill: "fill-brand-dark dark:fill-brand-mid",
    text: "text-brand-dark dark:text-brand-mid",
  },
  // Donut slices (all profitable accounts) - three distinct on-brand tones
  slice1: {
    bg: "bg-brand-green",
    stroke: "stroke-brand-green",
    fill: "fill-brand-green",
    text: "text-brand-green",
  },
  slice2: {
    bg: "bg-brand-mid",
    stroke: "stroke-brand-mid",
    fill: "fill-brand-mid",
    text: "text-brand-mid",
  },
  slice3: {
    bg: "bg-brand-dark dark:bg-brand-green/45",
    stroke: "stroke-brand-dark dark:stroke-brand-green/45",
    fill: "fill-brand-dark dark:fill-brand-green/45",
    text: "text-brand-dark dark:text-brand-green",
  },
  gray: {
    bg: "bg-gray-400",
    stroke: "stroke-gray-400",
    fill: "fill-gray-400",
    text: "text-gray-400",
  },
} as const satisfies {
  [color: string]: {
    [key in ColorUtility]: string
  }
}

export type AvailableChartColorsKeys = keyof typeof chartColors

export const AvailableChartColors: AvailableChartColorsKeys[] = Object.keys(
  chartColors,
) as Array<AvailableChartColorsKeys>

export const constructCategoryColors = (
  categories: string[],
  colors: AvailableChartColorsKeys[],
): Map<string, AvailableChartColorsKeys> => {
  const categoryColors = new Map<string, AvailableChartColorsKeys>()
  categories.forEach((category, index) => {
    categoryColors.set(category, colors[index % colors.length])
  })
  return categoryColors
}

export const getColorClassName = (
  color: AvailableChartColorsKeys,
  type: ColorUtility,
): string => {
  const fallbackColor = {
    bg: "bg-gray-500",
    stroke: "stroke-gray-500",
    fill: "fill-gray-500",
    text: "text-gray-500",
  }
  return chartColors[color]?.[type] ?? fallbackColor[type]
}
