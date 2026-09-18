import type { ReactNode } from 'react'

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="fade" role="status" aria-live="polite" style={{ display: 'grid', placeItems: 'center', gap: '0.75rem', padding: '2rem' }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '3px solid var(--line)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <span className="sr-only">{label}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="card rise" style={{ padding: '1.5rem', textAlign: 'center', display: 'grid', gap: '0.6rem' }}>
      <h3 style={{ fontSize: '1.15rem' }}>{title}</h3>
      <p style={{ color: 'var(--ink-muted)' }}>{text}</p>
      {action}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header
      className="rise"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        justifyContent: 'space-between',
        alignItems: 'end',
        marginBottom: '1.25rem',
      }}
    >
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        {eyebrow ? (
          <p style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-deep)' }}>
            {eyebrow}
          </p>
        ) : null}
        <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.2rem)' }}>{title}</h1>
        {subtitle ? <p style={{ color: 'var(--ink-muted)', maxWidth: 52 * 8 }}>{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  )
}
