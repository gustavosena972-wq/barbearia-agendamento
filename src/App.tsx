import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PainelLayout } from './components/PainelLayout'
import { BookingPage } from './pages/BookingPage'
import { ManageBookingPage } from './pages/ManageBookingPage'
import { LoginPage } from './pages/painel/LoginPage'
import { SetupEnvPage } from './pages/painel/SetupEnvPage'
import { SetupWizardPage } from './pages/painel/SetupWizardPage'
import { DashboardPage } from './pages/painel/DashboardPage'
import { AgendaPage } from './pages/painel/AgendaPage'
import { ClientesPage } from './pages/painel/ClientesPage'
import { ConfigPage } from './pages/painel/ConfigPage'
import { IaPage } from './pages/painel/IaPage'
import { RelatoriosPage } from './pages/painel/RelatoriosPage'

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<BookingPage />} />
          <Route path="/agendamento/:id/:token" element={<ManageBookingPage />} />
          <Route path="/agendamento/:id" element={<ManageBookingPage />} />
          <Route path="/setup" element={<SetupEnvPage />} />
          <Route path="/painel/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/painel/setup" element={<SetupWizardPage />} />
            <Route path="/painel" element={<PainelLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="agenda" element={<AgendaPage />} />
              <Route path="ia" element={<IaPage />} />
              <Route path="clientes" element={<ClientesPage />} />
              <Route path="relatorios" element={<RelatoriosPage />} />
              <Route path="config" element={<ConfigPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
