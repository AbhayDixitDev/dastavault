/** Note colours: stored as a key; rendered with soft tints that work in light and dark. */
export const NOTE_COLORS = [
  { key: 'default', label: 'None', className: 'bg-card' },
  { key: 'yellow', label: 'Yellow', className: 'bg-amber-100 dark:bg-amber-950/50' },
  { key: 'green', label: 'Green', className: 'bg-emerald-100 dark:bg-emerald-950/50' },
  { key: 'blue', label: 'Blue', className: 'bg-sky-100 dark:bg-sky-950/50' },
  { key: 'purple', label: 'Purple', className: 'bg-violet-100 dark:bg-violet-950/50' },
  { key: 'pink', label: 'Pink', className: 'bg-pink-100 dark:bg-pink-950/50' },
  { key: 'orange', label: 'Orange', className: 'bg-orange-100 dark:bg-orange-950/50' },
  { key: 'grey', label: 'Grey', className: 'bg-zinc-200 dark:bg-zinc-800' },
]

export function noteColorClass(key) {
  return (NOTE_COLORS.find((c) => c.key === key) || NOTE_COLORS[0]).className
}
