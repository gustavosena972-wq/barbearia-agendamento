import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { format, parseISO, startOfDay, endOfDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatTime, STATUS_LABEL } from '../../lib/format'
import { PageHeader, Spinner, EmptyState } from '../../components/ui'
import type { Agendamento, Barbearia } from '../../types/database'
import { enablePushNotifications } from '../../lib/push'

interface Health {
  ready: boolean
  setup_completo: boolean
  barbeiros_ativos: number
  servicos_ativos: number
  horarios_cadastrados: number
  agendamentos_hoje: number
  precisa_atencao: number
  canal: string
  nome: string
}

export function DashboardPage() {
  const { usuario } = useAuth()
  const [loading, setLoading] = useState(true)
  const [shop, setShop] = useState<Barbearia | null>(null)
  const [ags, setAgs] = useState<Agendamento[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [tickMsg, setTickMsg] = useState<string | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data: b } = await supabase.from('barbearia').select('*').limit(1).maybeSingle()
      setShop(b as Barbearia | null)
      if (!(b as Barbearia | null)?.setup_completo) {
        setLoading(false)
        return
      }

      const { data: h, error: eh } = await supabase.rpc('health_barbearia')
      if (!eh && h) setHealth(h as Health)

      // dono: roda tick ao abrir o painel (além do pg_cron)
      if (usuario?.papel === 'dono') {
        const { data: tick, error: et } = await supabase.rpc('tick_operacao')
        if (!et && tick) {
          const enviados = (tick as { lembretes?: { enviados?: number } })?.lembretes?.enviados ?? 0
          const marcados = (tick as { sem_resposta?: { marcados?: number } })?.sem_resposta?.marcados ?? 0
          if (enviados || marcados) {
            setTickMsg(`Operação automática: ${enviados} lembrete(s), ${marcados} sem resposta.`)
          }
        }
      }

      const from = startOfDay(new Date()).toISOString()
      const to = endOfDay(new Date()).toISOString()
      let q = supabase
        .from('agendamentos')
        .select('*, cliente:clientes(*), barbeiro:barbeiros(*), servico:servicos(*)')
        .gte('inicio', from)
        .lte('inicio', to)
        .neq('status', 'cancelado')
        .order('inicio')

      if (usuario?.papel === 'barbeiro' && usuario.barbeiro_id) {
        q = q.eq('barbeiro_id', usuario.barbeiro_id)
      }

      const { data } = await q
      setAgs((data as Agendamento[]) || [])
      setLoading(false)
    })()
  }, [usuario])

  const groups = useMemo(() => {
    const g: Record<string, Agendamento[]> = {
      aguardando: [],
      confirmado: [],
      reagendado: [],
      precisa_atencao: [],
    }
    for (const a of ags) {
      if (g[a.status]) g[a.status].push(a)
    }
    return g
  }, [ags])

  if (loading) return <Spinner />
  if (shop && !shop.setup_completo) return <Navigate to="/painel/setup" replace />

  const checks = health
    ? [
        { ok: health.setup_completo, label: 'Setup concluído' },
        { ok: health.barbeiros_ativos > 0, label: `${health.barbeiros_ativos} barbeiro(s) ativo(s)` },
        { ok: health.servicos_ativos > 0, label: `${health.servicos_ativos} serviço(s)` },
        { ok: health.horarios_cadastrados > 0, label: `${health.horarios_cadastrados} horário(s) de trabalho` },
        { ok: true, label: `Canal: ${health.canal === 'whatsapp' ? 'WhatsApp' : 'Simulação (pronto)'}` },
      ]
    : []

  return (
    <div>
      <PageHeader
        eyebrow={format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
        title={`Olá, ${usuario?.nome?.split(' ')[0] || 'equipe'}`}
        subtitle={
          health?.ready
            ? 'Sistema pronto para o dia. Use a agenda e acompanhe a IA.'
            : 'Complete os itens abaixo para operar 100%.'
        }
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to="/painel/agenda">
              Agenda
            </Link>
            <Link className="btn btn-secondary" to="/" target="_blank" rel="noreferrer">
              Página do cliente
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                const msg = await enablePushNotifications(usuario!.id)
                setPushMsg(msg)
              }}
            >
              Ativar notificações
            </button>
          </div>
        }
      />

      {tickMsg ? <div className="alert alert-ok" style={{ marginBottom: 12 }}>{tickMsg}</div> : null}
      {pushMsg ? <div className="alert alert-info" style={{ marginBottom: 12 }}>{pushMsg}</div> : null}

      {health ? (
        <section className="card" style={{ padding: '1rem', marginBottom: '1rem', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>{health.ready ? 'Pronto para uso' : 'Quase pronto'}</strong>
            <span className={`badge ${health.ready ? 'badge-ok' : 'badge-warn'}`}>
              {health.agendamentos_hoje} hoje · {health.precisa_atencao} atenção
            </span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: 4 }}>
            {checks.map((c) => (
              <li key={c.label} style={{ color: c.ok ? 'var(--ok)' : 'var(--warn)' }}>
                {c.ok ? 'OK' : 'Falta'} — {c.label}
              </li>
            ))}
          </ul>
          {health.precisa_atencao > 0 ? (
            <Link className="btn btn-secondary" to="/painel/ia">
              Ver casos que precisam de atenção
            </Link>
          ) : null}
        </section>
      ) : null}

      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <strong>{ags.length}</strong> agendamento(s) hoje
      </div>

      {ags.length === 0 ? (
        <EmptyState
          title="Dia livre"
          text="Nenhum horário marcado para hoje. Compartilhe o link da página pública."
          action={
            <Link className="btn btn-primary" to="/">
              Abrir agendamento
            </Link>
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {(['precisa_atencao', 'aguardando', 'confirmado', 'reagendado'] as const).map((status) => {
            const list = groups[status] || []
            if (!list.length) return null
            return (
              <section key={status} className="card" style={{ padding: '1rem' }}>
                <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>{STATUS_LABEL[status]}</h2>
                <div style={{ display: 'grid', gap: '0.55rem' }}>
                  {list.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        flexWrap: 'wrap',
                        padding: '0.65rem 0',
                        borderTop: '1px solid var(--line)',
                      }}
                    >
                      <div>
                        <strong>
                          {formatTime(a.inicio)} · {a.cliente?.nome}
                        </strong>
                        <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                          {a.servico?.nome} · {a.barbeiro?.nome}
                        </div>
                      </div>
                      <span className="badge">{a.origem}</span>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
          <section className="card" style={{ padding: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Todos de hoje</h2>
            {ags.map((a) => (
              <div key={a.id} style={{ padding: '0.5rem 0', borderTop: '1px solid var(--line)', fontSize: '0.95rem' }}>
                {format(parseISO(a.inicio), 'HH:mm')} — {a.cliente?.nome} — {STATUS_LABEL[a.status]}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
