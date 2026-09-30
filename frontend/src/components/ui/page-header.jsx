import { cn } from "@/lib/utils"

function PageHeader({
  title,
  description,
  actions,
  className,
  children,
  ...props
}) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {title ? (
          <h1
            data-slot="page-header-title"
            className="text-foreground text-2xl font-semibold tracking-tight text-balance"
          >
            {title}
          </h1>
        ) : null}
        {description ? (
          <p
            data-slot="page-header-description"
            className="text-muted-foreground text-sm text-pretty"
          >
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div
          data-slot="page-header-actions"
          className="flex shrink-0 flex-wrap items-center gap-2"
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export { PageHeader }
