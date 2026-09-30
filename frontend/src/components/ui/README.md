# UI components

Plain-JSX ports of the shadcn/ui "new-york" (Tailwind v4) components, built on the unified `radix-ui` package, `class-variance-authority`, `lucide-react`, `sonner` and `motion`. No TypeScript, no `forwardRef` (React 19 passes `ref` as a prop). Every component spreads `...props` and sets a `data-slot` attribute.

Import with the `@/` alias: `import { Button } from "@/components/ui/button"`.

Theme tokens live in `src/index.css` (oklch CSS variables on `:root` / `.dark`, exposed through `@theme inline`). Dark mode is toggled by adding the `dark` class to `<html>`; `html.large-text` bumps the base font size to 112.5%. Extra utilities: `safe-bottom`, `safe-top`, `tap-target`.

| File | Exports |
| --- | --- |
| `alert.jsx` | `Alert`, `AlertTitle`, `AlertDescription`, `alertVariants` (variants: default, destructive, success, warning, info) |
| `alert-dialog.jsx` | `AlertDialog`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` |
| `avatar.jsx` | `Avatar`, `AvatarImage`, `AvatarFallback` |
| `badge.jsx` | `Badge`, `badgeVariants` (variants: default, secondary, destructive, outline, success, warning) |
| `button.jsx` | `Button`, `buttonVariants` (variants: default, destructive, outline, secondary, ghost, link; sizes: default, sm, lg, xl (52px), icon, icon-sm, icon-lg, icon-xl) |
| `card.jsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` |
| `checkbox.jsx` | `Checkbox` |
| `dialog.jsx` | `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogOverlay`, `DialogContent` (`showCloseButton` prop), `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose` |
| `dropdown-menu.jsx` | `DropdownMenu`, `DropdownMenuPortal`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuLabel`, `DropdownMenuItem` (`inset`, `variant="destructive"`), `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent` |
| `empty-state.jsx` | `EmptyState` (props: `icon` (lucide component or element), `title`, `description`, `action`; fades in with `motion/react`) |
| `form.jsx` | `Form`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `FormField`, `useFormField` (react-hook-form) |
| `input.jsx` | `Input` |
| `label.jsx` | `Label` |
| `page-header.jsx` | `PageHeader` (props: `title`, `description`, `actions`) |
| `popover.jsx` | `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` |
| `progress.jsx` | `Progress` (`value`, `indicatorClassName`) |
| `scroll-area.jsx` | `ScrollArea`, `ScrollBar` |
| `select.jsx` | `Select`, `SelectTrigger` (`size="default" \| "sm"`), `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` |
| `separator.jsx` | `Separator` |
| `sheet.jsx` | `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent` (`side="right" \| "left" \| "top" \| "bottom"`, `showCloseButton`), `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription` |
| `skeleton.jsx` | `Skeleton` |
| `sonner.jsx` | `Toaster` (reads theme from `document.documentElement.classList` and follows changes; use `toast` from `sonner` to fire toasts) |
| `spinner.jsx` | `Spinner` (`size="sm" \| "default" \| "lg"`, `label`) |
| `switch.jsx` | `Switch` |
| `tabs.jsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| `textarea.jsx` | `Textarea` |
| `tooltip.jsx` | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` |

## Notes

- `Tooltip` wraps itself in a `TooltipProvider`, so a global provider is optional.
- `AlertDialogAction` / `AlertDialogCancel` reuse `buttonVariants` from `button.jsx`.
- `SheetContent side="bottom"` applies `safe-bottom` and a rounded top for mobile bottom sheets.
- Mount `<Toaster />` once (for example in `App.jsx`) and call `toast("...")` anywhere.
