/** URL pública do app (funciona com HashRouter + GitHub Pages). */
export function appHref(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${base}#${clean}`
}
