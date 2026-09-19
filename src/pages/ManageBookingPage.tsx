import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { formatTime, mapRpcError, moneyBRL, STATUS_LABEL } from '../lib/format'
import { upcomingDates } from '../lib/dates'
import type { Slot } from '../types/database'
import { EmptyState, PageHeader, Spinner } from '../components/ui'

interface AgPublico {
  id: string
  inicio: string
  fim: string
  status: string
  barbeiro_id: string
  servico_id: string
  cliente_nome: string
  barbeiro_nome: string
  servico_nome: string
  duracao_min: number
  preco: number
  exibir_precos: boolean
}

function storageKey(id: string) {
  return `barbearia-manage:${id}`
}

export function ManageBookingPage() {
  const { id, token: tokenParam } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryToken = params.get('t') || ''

  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [ag, setAg] = useState<AgPublico | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'remarcar'>('view')
  const [data, setData] = useState(upcomingDates(1)[0])
  const [slots, setSlots] = useState<Slot[]>([])
  const [busy, setBusy] = useState(false)

  // Resolve token: path > query (migra) > sessionStorage
  useEffect(() => {
    if (!id) return
    const fromPath = tokenParam || ''
    const fromQuery = queryToken
    const fromStore = sessionStorage.getItem(storageKey(id)) || ''
    const resolved = fromPath || fromQuery || fromStore
    if (fromQuery && id) {
      sessionStorage.setItem(storageKey(id), fromQuery)
      navigate(`/agendamento/${id}/${fromQuery}`, { replace: true })
      return
    }
    if (fromPath) {
      sessionStorage.setItem(storageKey(id), fromPath)
    }
    setToken(resolved)
  }, [id, tokenParam, queryToken, navigate])

  const load = useCallback(async () => {
    if (!id || !token) {
      if (token === '' && (tokenParam || queryToken)) return
      setError('Link incompleto. Peça um novo link à barbearia.')
      setLoading(false)
      return
    }
    const { data: row, error: err } = await supabase.rpc('obter_agendamento_publico', {
      p_agendamento_id: id,
      p_token: token,
    })
    if (err) {
      setError(mapRpcError(err.message))
      setAg(null)
    } else {
      setAg(row as AgPublico)
      setError(null)
    }
    setLoading(false)
  }, [id, token, tokenParam, queryToken])

  useEffect(() => {
    if (token) void load()
  }, [load, token])

  function adoptToken(next: string) {
    if (!id || !next) return
    setToken(next)
    sessionStorage.setItem(storageKey(id), next)
    navigate(`/agendamento/${id}/${next}`, { replace: true })
  }

  const fetchSlots = useCallback(async (day: string, barbeiroId: string, servicoId: string) => {
    const { data: rows, error: err } = await supabase.rpc('listar_slots', {
      p_barbeiro_id: barbeiroId,
      p_servico_id: servicoId,
      p_data: day,
    })
    if (err) {
      setError(mapRpcError(err.message))
      setSlots([])
      return
    }
    setSlots((rows as Slot[]) || [])
  }, [])

  useEffect(() => {
    if (mode !== 'remarcar' || !ag) return
    void fetchSlots(data, ag.barbeiro_id, ag.servico_id)
  }, [mode, data, ag, fetchSlots])

  async function cancelar() {
    if (!id || !token) return
    if (!confirm('Cancelar este agendamento?')) return
    setBusy(true)
    const { data: res, error: err } = await supabase.rpc('gerenciar_agendamento_publico', {
      p_agendamento_id: id,
      p_token: token,
      p_acao: 'cancelar',
      p_novo_inicio: null,
    })
    setBusy(false)
    if (err) {
      setError(mapRpcError(err.message))
      return
    }
    const next = (res as { manage_token?: string })?.manage_token
    if (next) adoptToken(next)
    await load()
  }

  async function startRemarcar() {
    if (!ag) return
    setMode('remarcar')
    setBusy(true)
    await fetchSlots(data, ag.barbeiro_id, ag.servico_id)
    setBusy(false)
  }

  async function remarcar(inicio: string) {
    if (!id || !token) return
    setBusy(true)
    const { data: res, error: err } = await supabase.rpc('gerenciar_agendamento_publico', {
      p_agendamento_id: id,
      p_token: token,
      p_acao: 'remarcar',
      p_novo_inicio: inicio,
    })
    setBusy(false)
    if (err) {
      setError(mapRpcError(err.message))
      return
    }
    const next = (res as { manage_token?: string })?.manage_token
    if (next) adoptToken(next)
    setMode('view')
    await load()
  }

  if (loading) return <Spinner />

  if (error && !ag) {
    return (
      <div className="app-shell" style={{ padding: '2rem 0' }}>
        <EmptyState
          title="Não encontrado"
          text={error}
          action={
            <Link className="btn btn-primary" to="/">
              Agendar de novo
            </Link>
          }
        />
      </div>
    )
  }

  if (!ag) return null

  return (
    <div className="app-shell" style={{ padding: '1.5rem 0 3rem' }}>
      <PageHeader
        eyebrow="Seu horário"
        title={STATUS_LABEL[ag.status] || ag.status}
        subtitle={`${ag.servico_nome} com ${ag.barbeiro_nome}`}
      />

      {error ? (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: '1.25rem', display: 'grid', gap: '0.85rem' }}>
        <p>
          <strong>{format(parseISO(ag.inicio), "EEEE, dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</strong>
        </p>
        <p style={{ color: 'var(--ink-muted)' }}>
          {ag.exibir_precos ? `${moneyBRL(Number(ag.preco))} · ` : ''}
          {ag.cliente_nome}
        </p>

        {ag.status !== 'cancelado' && mode === 'view' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void startRemarcar()}>
              Remarcar
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void cancelar()}>
              Cancelar
            </button>
            <Link className="btn btn-ghost" to="/">
              Início
            </Link>
          </div>
        ) : null}

        {mode === 'remarcar' ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
              {upcomingDates(14).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    padding: '0.5rem 0.8rem',
                    flex: '0 0 auto',
                    background: data === d ? 'var(--ink)' : undefined,
                    color: data === d ? '#fff8ef' : undefined,
                  }}
                  onClick={() => setData(d)}
                >
                  {format(parseISO(`${d}T12:00:00`), 'dd/MM')}
                </button>
              ))}
            </div>
            {slots.length === 0 ? (
              <p style={{ color: 'var(--ink-muted)' }}>Sem horários neste dia.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))', gap: 8 }}>
                {slots.map((s) => (
                  <button
                    key={s.inicio}
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void remarcar(s.inicio)}
                  >
                    {formatTime(s.inicio)}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>
              Voltar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
