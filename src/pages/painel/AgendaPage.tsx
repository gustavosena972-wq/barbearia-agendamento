import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatTime, moneyBRL, STATUS_LABEL } from '../../lib/format'
import { normalizePhone, isValidBrPhone } from '../../lib/phone'
import { upcomingDates } from '../../lib/dates'
import { PageHeader, Spinner, EmptyState } from '../../components/ui'
import type { Agendamento, Barbeiro, Servico, Slot } from '../../types/database'

export function AgendaPage() {
  const { usuario } = useAuth()
  const [mode, setMode] = useState<'dia' | 'semana'>('dia')
  const [anchor, setAnchor] = useState(startOfDay(new Date()))
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [filterBarbeiro, setFilterBarbeiro] = useState<string>('all')
  const [ags, setAgs] = useState<Agendamento[]>([])
  const [loading, setLoading] = useState(true)
  const [showManual, setShowManual] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => {
    if (mode === 'dia') {
      return { from: anchor, to: addDays(anchor, 1) }
    }
    const from = startOfWeek(anchor, { weekStartsOn: 1 })
    const to = addDays(endOfWeek(anchor, { weekStartsOn: 1 }), 1)
    return { from, to }
  }, [mode, anchor])

  async function load() {
    setLoading(true)
    const [{ data: br }, { data: sv }] = await Promise.all([
      supabase.from('barbeiros').select('*').eq('ativo', true).order('ordem'),
      supabase.from('servicos').select('*').eq('ativo', true).order('ordem'),
    ])
    setBarbeiros((br as Barbeiro[]) || [])
    setServicos((sv as Servico[]) || [])

    let q = supabase
      .from('agendamentos')
      .select('*, cliente:clientes(*), barbeiro:barbeiros(*), servico:servicos(*)')
      .gte('inicio', range.from.toISOString())
      .lt('inicio', range.to.toISOString())
      .order('inicio')

    if (usuario?.papel === 'barbeiro' && usuario.barbeiro_id) {
      q = q.eq('barbeiro_id', usuario.barbeiro_id)
    } else if (filterBarbeiro !== 'all') {
      q = q.eq('barbeiro_id', filterBarbeiro)
    }

    const { data } = await q
    setAgs((data as Agendamento[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from.toISOString(), range.to.toISOString(), filterBarbeiro, usuario])

  async function setStatus(id: string, status: string) {
    const { error: err } = await supabase.from('agendamentos').update({ status }).eq('id', id)
    if (err) setError(err.message)
    else await load()
  }

  const days = mode === 'semana'
    ? eachDayOfInterval({
        start: startOfWeek(anchor, { weekStartsOn: 1 }),
        end: endOfWeek(anchor, { weekStartsOn: 1 }),
      })
    : [anchor]

  return (
    <div>
      <PageHeader
        title="Agenda"
        subtitle="Dia e semana por barbeiro. Crie horários manuais para quem liga."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setShowManual(true)}>
            Novo manual
          </button>
        }
      />

      {error ? (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
        <button type="button" className={`btn ${mode === 'dia' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('dia')}>
          Dia
        </button>
        <button type="button" className={`btn ${mode === 'semana' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('semana')}>
          Semana
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAnchor(addDays(anchor, mode === 'dia' ? -1 : -7))}>
          ←
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAnchor(startOfDay(new Date()))}>
          Hoje
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAnchor(addDays(anchor, mode === 'dia' ? 1 : 7))}>
          →
        </button>
        {usuario?.papel === 'dono' ? (
          <select
            value={filterBarbeiro}
            onChange={(e) => setFilterBarbeiro(e.target.value)}
            style={{ borderRadius: 999, padding: '0.55rem 0.9rem', border: '1px solid var(--line)', background: 'var(--bg-elevated)' }}
          >
            <option value="all">Todos os barbeiros</option>
            {barbeiros.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <Spinner />
      ) : mode === 'dia' ? (
        <DayGrid
          day={anchor}
          ags={ags}
          barbeiros={
            usuario?.papel === 'barbeiro' && usuario.barbeiro_id
              ? barbeiros.filter((b) => b.id === usuario.barbeiro_id)
              : filterBarbeiro === 'all'
                ? barbeiros
                : barbeiros.filter((b) => b.id === filterBarbeiro)
          }
          onStatus={(id, status) => void setStatus(id, status)}
        />
      ) : ags.length === 0 ? (
        <EmptyState title="Sem horários" text="Nada neste período." />
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const list = ags.filter((a) => format(parseISO(a.inicio), 'yyyy-MM-dd') === key)
            if (list.length === 0) return null
            return (
              <section key={key} className="card" style={{ padding: '1rem' }}>
                <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem', textTransform: 'capitalize' }}>
                  {format(day, "EEEE, dd/MM", { locale: ptBR })}
                </h2>
                {list.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'grid',
                      gap: 6,
                      padding: '0.75rem 0',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong>
                        {formatTime(a.inicio)}–{formatTime(a.fim)} · {a.cliente?.nome}
                      </strong>
                      <span className={`badge ${a.status === 'cancelado' ? 'badge-danger' : a.status === 'confirmado' ? 'badge-ok' : ''}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </div>
                    <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                      {a.servico?.nome}
                      {a.servico ? ` · ${moneyBRL(Number(a.servico.preco))}` : ''} · {a.barbeiro?.nome} · {a.origem}
                    </div>
                    {a.status !== 'cancelado' && a.status !== 'concluido' ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost" style={{ padding: '0.4rem 0.7rem' }} onClick={() => void setStatus(a.id, 'confirmado')}>
                          Confirmar
                        </button>
                        <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem' }} onClick={() => void setStatus(a.id, 'concluido')}>
                          Concluir
                        </button>
                        <button type="button" className="btn btn-danger" style={{ padding: '0.4rem 0.7rem' }} onClick={() => void setStatus(a.id, 'cancelado')}>
                          Cancelar
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      )}

      {showManual ? (
        <ManualModal
          barbeiros={barbeiros}
          servicos={servicos}
          defaultBarbeiro={usuario?.barbeiro_id || barbeiros[0]?.id}
          onClose={() => setShowManual(false)}
          onCreated={async () => {
            setShowManual(false)
            await load()
          }}
        />
      ) : null}
    </div>
  )
}

function DayGrid({
  day,
  ags,
  barbeiros,
  onStatus,
}: {
  day: Date
  ags: Agendamento[]
  barbeiros: Barbeiro[]
  onStatus: (id: string, status: string) => void
}) {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8) // 08–20
  const dayKey = format(day, 'yyyy-MM-dd')
  const cols = barbeiros.length ? barbeiros : [{ id: 'all', nome: 'Agenda', foto_url: null, ativo: true, ordem: 0 }]

  return (
    <section className="card" style={{ padding: '0.75rem', overflow: 'auto' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem', textTransform: 'capitalize' }}>
        {format(day, "EEEE, dd/MM", { locale: ptBR })}
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `56px repeat(${cols.length}, minmax(140px, 1fr))`,
          gap: 4,
          minWidth: 280 + cols.length * 140,
        }}
      >
        <div />
        {cols.map((b) => (
          <div key={b.id} style={{ fontWeight: 700, padding: '0.4rem', textAlign: 'center' }}>
            {b.nome}
          </div>
        ))}
        {hours.map((h) => (
          <div key={`row-${h}`} style={{ display: 'contents' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', paddingTop: 6 }}>{String(h).padStart(2, '0')}:00</div>
            {cols.map((b) => {
              const cell = ags.filter((a) => {
                if (format(parseISO(a.inicio), 'yyyy-MM-dd') !== dayKey) return false
                if (b.id !== 'all' && a.barbeiro_id !== b.id) return false
                return parseISO(a.inicio).getHours() === h
              })
              return (
                <div
                  key={`${b.id}-${h}`}
                  style={{
                    minHeight: 64,
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    background: 'var(--bg-elevated)',
                    padding: 4,
                    display: 'grid',
                    gap: 4,
                    alignContent: 'start',
                  }}
                >
                  {cell.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        background: a.status === 'precisa_atencao' ? 'var(--warn-bg)' : 'var(--accent-soft)',
                        borderRadius: 8,
                        padding: '0.35rem 0.45rem',
                        fontSize: '0.78rem',
                        lineHeight: 1.3,
                      }}
                    >
                      <strong>
                        {formatTime(a.inicio)} {a.cliente?.nome}
                      </strong>
                      <div style={{ opacity: 0.85 }}>{a.servico?.nome}</div>
                      {a.status !== 'cancelado' && a.status !== 'concluido' ? (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-ghost" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} onClick={() => onStatus(a.id, 'confirmado')}>
                            OK
                          </button>
                          <button type="button" className="btn btn-ghost" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} onClick={() => onStatus(a.id, 'concluido')}>
                            Feito
                          </button>
                          <button type="button" className="btn btn-danger" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }} onClick={() => onStatus(a.id, 'cancelado')}>
                            X
                          </button>
                        </div>
                      ) : (
                        <span className="badge" style={{ marginTop: 4 }}>{STATUS_LABEL[a.status]}</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {ags.filter((a) => format(parseISO(a.inicio), 'yyyy-MM-dd') === dayKey).length === 0 ? (
        <p style={{ color: 'var(--ink-muted)', marginTop: 12 }}>Nenhum horário neste dia.</p>
      ) : null}
    </section>
  )
}

function ManualModal({
  barbeiros,
  servicos,
  defaultBarbeiro,
  onClose,
  onCreated,
}: {
  barbeiros: Barbeiro[]
  servicos: Servico[]
  defaultBarbeiro?: string
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { usuario } = useAuth()
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [barbeiroId, setBarbeiroId] = useState(defaultBarbeiro || '')
  const [servicoId, setServicoId] = useState(servicos[0]?.id || '')
  const [data, setData] = useState(upcomingDates(1)[0])
  const [slots, setSlots] = useState<Slot[]>([])
  const [inicioIso, setInicioIso] = useState<string | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!barbeiroId || !servicoId || !data) return
    let alive = true
    setSlotsLoading(true)
    setInicioIso(null)
    void (async () => {
      const { data: rows, error: err } = await supabase.rpc('listar_slots', {
        p_barbeiro_id: barbeiroId,
        p_servico_id: servicoId,
        p_data: data,
      })
      if (!alive) return
      if (err) setError(err.message)
      setSlots((rows as Slot[]) || [])
      setSlotsLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [barbeiroId, servicoId, data])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidBrPhone(telefone)) {
      setError('Telefone inválido.')
      return
    }
    if (!inicioIso) {
      setError('Escolha um horário livre da lista.')
      return
    }
    const servico = servicos.find((s) => s.id === servicoId)
    if (!servico) return

    setBusy(true)
    const phone = normalizePhone(telefone)
    const { data: cliente, error: ec } = await supabase
      .from('clientes')
      .upsert(
        {
          nome: nome.trim(),
          telefone: phone,
          consentimento_mensagens: true,
          consentimento_em: new Date().toISOString(),
        },
        { onConflict: 'telefone' },
      )
      .select('id')
      .single()
    if (ec) {
      setBusy(false)
      setError(ec.message)
      return
    }

    const inicio = new Date(inicioIso)
    const fim = new Date(inicio.getTime() + servico.duracao_min * 60_000)
    const tokenHash = await sha256Hex(cryptoRandom())

    const { error: ea } = await supabase.from('agendamentos').insert({
      cliente_id: cliente.id,
      barbeiro_id: barbeiroId,
      servico_id: servicoId,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      status: 'confirmado',
      origem: 'manual',
      manage_token_hash: tokenHash,
      created_by: usuario?.id ?? null,
    })
    setBusy(false)
    if (ea) {
      setError(ea.message.includes('agendamentos_sem_sobreposicao') ? 'Horário já ocupado.' : ea.message)
      return
    }
    await onCreated()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28,25,21,0.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <form
        className="card rise"
        style={{ width: 'min(440px, 100%)', padding: '1.25rem', display: 'grid', gap: '0.75rem', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="manual-title" style={{ fontSize: '1.2rem' }}>
          Agendamento manual
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
          Só horários livres (mesmo motor da página pública).
        </p>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="field">
          <label>Nome</label>
          <input required value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="field">
          <label>Telefone</label>
          <input required value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </div>
        <div className="field">
          <label>Barbeiro</label>
          <select value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)} required>
            {barbeiros.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Serviço</label>
          <select value={servicoId} onChange={(e) => setServicoId(e.target.value)} required>
            {servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome} ({s.duracao_min} min)
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Data</label>
          <select value={data} onChange={(e) => setData(e.target.value)}>
            {upcomingDates(21).map((d) => (
              <option key={d} value={d}>
                {format(parseISO(`${d}T12:00:00`), "EEEE dd/MM", { locale: ptBR })}
              </option>
            ))}
          </select>
        </div>
        {slotsLoading ? (
          <Spinner />
        ) : slots.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)' }}>Sem horários neste dia.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))', gap: 6 }}>
            {slots.map((s) => (
              <button
                key={s.inicio}
                type="button"
                className={`btn ${inicioIso === s.inicio ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '0.45rem 0.3rem' }}
                onClick={() => setInicioIso(s.inicio)}
              >
                {formatTime(s.inicio)}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !inicioIso}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}
