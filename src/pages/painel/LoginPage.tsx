import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { PageHeader, Spinner } from '../../components/ui'

export function LoginPage() {
  const { signIn, session, usuario, loading, configured } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from || '/painel'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && session && usuario) {
      navigate(from, { replace: true })
    }
  }, [loading, session, usuario, navigate, from])

  if (!configured) {
    return (
      <div className="app-shell" style={{ padding: '3rem 0' }}>
        <PageHeader title="Configure o ambiente" subtitle="Falta o .env do Supabase." />
        <Link className="btn btn-primary" to="/setup">
          Instruções
        </Link>
      </div>
    )
  }

  if (loading) return <Spinner />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await signIn(email, password)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="app-shell" style={{ padding: '2.5rem 0', maxWidth: 480 }}>
      <PageHeader
        eyebrow="Equipe"
        title="Entrar no painel"
        subtitle="Acesso só para dono e barbeiros."
      />
      <form className="card" style={{ padding: '1.25rem', display: 'grid', gap: '0.9rem' }} onSubmit={(e) => void onSubmit(e)}>
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <Link to="/" style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
          Voltar ao agendamento
        </Link>
      </form>
    </div>
  )
}
