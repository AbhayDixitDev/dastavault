import { useIsDesktop } from '@/hooks/useMediaQuery'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Bottom sheet on phones, centred dialog on desktop. Same props either way:
 * { open, onOpenChange, title, description, footer, children, className }
 */
export function ResponsiveDialog({ open, onOpenChange, title, description, footer, children, className, bodyClassName }) {
  const desktop = useIsDesktop()

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn('sm:max-w-xl', className)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          <DialogBody className={bodyClassName}>{children}</DialogBody>
          {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={cn('max-h-[92svh] gap-0', className)}>
        <SheetHeader className="pb-2">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
        </SheetHeader>
        <div className={cn('scroll-inside min-h-0 flex-1 px-4 pb-4', bodyClassName)}>{children}</div>
        {footer ? <SheetFooter className="border-t pt-3">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}
