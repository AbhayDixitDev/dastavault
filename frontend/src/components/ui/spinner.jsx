import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, size = "default", label = "Loading", ...props }) {
  const sizeClass =
    size === "sm" ? "size-3.5" : size === "lg" ? "size-8" : "size-5"

  return (
    <span
      data-slot="spinner"
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <Loader2Icon
        aria-hidden="true"
        className={cn("animate-spin text-current", sizeClass)}
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export { Spinner }
