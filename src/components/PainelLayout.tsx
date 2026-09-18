import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { Notificacao } from '../types/database'

const links = [
  { to: '/painel', end: true, label: 'Início' },
  { to: '/painel/agenda', label: 'Agenda' },
  { to: '/painel/ia', label: 'IA' },
  { to: '/painel/clientes', label: 'Clientes' },
  { to: '/painel/relatorios', label: 'Relatórios' },
  { to: '/painel/config', label: 'Config' },
]

export function PainelLayout() {
  const { usuario, signOut } = useAuth()
  const navigate = useNavigate()
  const [bellOpen, setBellOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notificacao[]>([])

  useEffect(() => {
    if (!usuario) return
    let alive = true

    async function load() {
      const { data } = await supabase
        .from('notificacoes')
        .select('*')
        .eq('usuario_id', usuario!.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (alive) setNotifs((data as Notificacao[]) || [])
    }

    void load()
    const channel = supabase
      .channel(`notif-${usuario.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${usuario.id}` },
        (payload) => {
          setNotifs((prev) => [payload.new as Notificacao, ...prev].slice(0, 20))
        },
      )
      .subscribe()

    return () => {
      alive = false
      void supabase.removeChannel(channel)
    }
  }, [usuario])

  const unread = notifs.filter((n) => !n.lida).length

  async function markAllRead() {
    if (!usuario || unread === 0) return
    await supabase.from('notificacoes').update({ lida: true }).eq('usuario_id', usuario.id).eq('lida', false)
    setNotifs((prev) => prev.map((n) => ({ ...n, lida: true })))
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backdropFilter: 'blur(12px)',
          background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div
          className="app-shell"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '0.85rem 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-ghost painel-burger"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              style={{ padding: '0.45rem 0.7rem', display: 'none' }}
            >
              Menu
            </button>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem' }}>Painel</strong>
            <span className="badge">{usuario?.papel === 'dono' ? 'Dono' : 'Barbeiro'}</span>
          </div>

          <nav className="painel-nav-desktop" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                style={({ isActive }) => ({
                  padding: '0.45rem 0.8rem',
                  borderRadius: 999,
                  fontWeight: 650,
                  fontSize: '0.9rem',
                  background: isActive ? 'var(--ink)' : 'transparent',
                  color: isActive ? '#fff8ef' : 'var(--ink-muted)',
                })}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Notificações${unread ? `, ${unread} não lidas` : ''}`}
                onClick={() => {
                  setBellOpen((v) => !v)
                  void markAllRead()
                }}
                style={{ padding: '0.55rem 0.8rem', position: 'relative' }}
              >
                Sino
                {unread > 0 ? (
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 999,
                      background: 'var(--danger)',
                      color: 'white',
                      fontSize: 11,
                      fontWeight: 800,
                      display: 'grid',
                      placeItems: 'center',
                      padding: '0 4px',
                    }}
                  >
                    {unread}
                  </span>
                ) : null}
              </button>
              {bellOpen ? (
                <div
                  className="card rise"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 8px)',
                    width: Math.min(360, typeof window !== 'undefined' ? window.innerWidth - 24 : 320),
                    maxHeight: 360,
                    overflow: 'auto',
                    padding: '0.5rem',
                    zIndex: 30,
                  }}
                >
                  {notifs.length === 0 ? (
                    <p style={{ padding: '0.75rem', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>Nenhuma notificação.</p>
                  ) : (
                    notifs.map((n) => (
                      <div key={n.id} style={{ padding: '0.65rem 0.75rem', borderBottom: '1px solid var(--line)' }}>
                        <strong style={{ display: 'block', fontSize: '0.9rem' }}>{n.titulo}</strong>
                        <span style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>{n.texto}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.55rem 0.9rem' }}
              onClick={async () => {
                await signOut()
                navigate('/painel/login')
              }}
            >
              Sair
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            className="app-shell painel-nav-mobile"
            style={{ display: 'grid', gap: 4, paddingBottom: 12 }}
          >
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setMenuOpen(false)}
                style={({ isActive }) => ({
                  padding: '0.75rem 1rem',
                  borderRadius: 12,
                  fontWeight: 650,
                  background: isActive ? 'var(--ink)' : 'var(--bg-elevated)',
                  color: isActive ? '#fff8ef' : 'var(--ink)',
                  border: '1px solid var(--line)',
                })}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="app-shell" style={{ padding: '1.25rem 0 3rem' }}>
        <Outlet />
      </main>

      <style>{`
        @media (max-width: 860px) {
          .painel-nav-desktop { display: none !important; }
          .painel-burger { display: inline-flex !important; }
        }
      `}</style>
    </div>
  )
}
