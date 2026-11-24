"use client"

import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type IconButtonProps = Omit<ComponentProps<typeof Button>, "size"> & {
  /**
   * The action the button triggers, e.g. "Close details". Shown in the
   * tooltip and used as the accessible name unless `aria-label` is set.
   */
  label: string
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg"
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"]
}

/**
 * A button that shows only an icon. The project rule is that every icon-only
 * button tells the user what it does with a tooltip, so `label` is required
 * and ESLint rejects `<Button size="icon…">` everywhere else.
 */
function IconButton({
  label,
  size = "icon",
  tooltipSide,
  "aria-label": ariaLabel,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size={size} aria-label={ariaLabel ?? label} {...props} />}
      />
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  )
}

export { IconButton }
