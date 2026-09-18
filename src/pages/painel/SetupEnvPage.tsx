import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/ui'

export function SetupEnvPage() {
  return (
    <div className="app-shell" style={{ padding: '2rem 0 3rem', maxWidth: 720 }}>
      <PageHeader
        eyebrow="Setup"
        title="Ligar o Supabase"
        subtitle="Projeto dedicado — não use o banco do CodeCraft."
      />
      <div className="card" style={{ padding: '1.25rem', display: 'grid', gap: '1rem', lineHeight: 1.55 }}>
        <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.65rem' }}>
          <li>
            Crie um projeto no Supabase e rode, nesta ordem:
            <code>supabase/schema.sql</code> → <code>supabase/schema-fase2.sql</code> →
            <code>supabase/realtime.sql</code> (opcional).
          </li>
          <li>
            Em Authentication → Users, crie o usuário dono (e-mail + senha forte).
          </li>
          <li>
            No SQL Editor, vincule o perfil:
            <pre style={preStyle}>{`insert into public.usuarios (auth_user_id, nome, email, papel)
select id, 'Dono', email, 'dono'
from auth.users
where email = 'seu@email.com'
on conflict (auth_user_id) do nothing;`}</pre>
          </li>
          <li>
            Copie <code>.env.example</code> para <code>.env</code> e preencha URL + anon key.
          </li>
          <li>
            Reinicie <code>npm run dev</code>, entre em <code>/painel/login</code> e complete o wizard.
          </li>
        </ol>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem' }}>
          Segurança: a chave anon é pública por desenho; a proteção real está no RLS e nas RPCs
          <code> security definer</code>. Nunca exponha a service role no frontend.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" to="/">
            Página pública
          </Link>
          <Link className="btn btn-secondary" to="/painel/login">
            Login
          </Link>
        </div>
      </div>
    </div>
  )
}

const preStyle: CSSProperties = {
  background: '#1c1917',
  color: '#fef3c7',
  padding: '0.85rem 1rem',
  borderRadius: 12,
  overflow: 'auto',
  fontSize: '0.8rem',
  marginTop: '0.5rem',
}
