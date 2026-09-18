import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui'

export function ProtectedRoute() {
  const { session, usuario, loading, configured } = useAuth()
  const location = useLocation()

  if (!configured) {
    return <Navigate to="/setup" replace />
  }

  if (loading) {
    return <Spinner label="Verificando sessão" />
  }

  if (!session) {
    return <Navigate to="/painel/login" replace state={{ from: location.pathname }} />
  }

  if (!usuario) {
    return (
      <div className="app-shell" style={{ padding: '3rem 0' }}>
        <div className="card alert alert-error" style={{ padding: '1.25rem' }}>
          Sua conta Auth existe, mas não há perfil em <code>usuarios</code>. Peça ao dono para vincular o e-mail.
        </div>
      </div>
    )
  }

  return <Outlet />
}
