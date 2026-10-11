/** One hue per category, none in the teal/cyan band (165-225) or the volt accent's (105-140); lightness comes from --seg-l so light and dark both stay legible. */
const HUES: Record<string, number> = {
  messaging: 150,
  docs: 235,
  work: 260,
  dev: 285,
  ai: 310,
  meeting: 335,
  media: 0,
  social: 25,
  browsing: 50,
  email: 80
}
export function categoryColor(category: string): string {
  const h = HUES[category]
  return h === undefined ? 'oklch(var(--seg-l) 0.02 260)' : `oklch(var(--seg-l) 0.1 ${h})`
}
