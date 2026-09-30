import { isValidElement } from "react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}) {
  return (
    <motion.div
      data-slot="empty-state"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon ? (
        <div
          data-slot="empty-state-icon"
          className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full [&_svg:not([class*='size-'])]:size-7"
        >
          {isValidElement(Icon) ? Icon : <Icon aria-hidden="true" />}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1.5">
        {title ? (
          <h3
            data-slot="empty-state-title"
            className="text-foreground text-base font-semibold"
          >
            {title}
          </h3>
        ) : null}
        {description ? (
          <p
            data-slot="empty-state-description"
            className="text-muted-foreground text-sm text-balance"
          >
            {description}
          </p>
        ) : null}
      </div>
      {children}
      {action ? (
        <div data-slot="empty-state-action" className="mt-2 flex flex-wrap justify-center gap-2">
          {action}
        </div>
      ) : null}
    </motion.div>
  )
}

export { EmptyState }
