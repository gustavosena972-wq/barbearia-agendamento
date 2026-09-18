import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { STATUS_LABEL, formatTime, mapRpcError } from '../../lib/format'
import { PageHeader, Spinner, EmptyState } from '../../components/ui'
import type { Agendamento } from '../../types/database'

interface Mensagem {
  id: string
  agendamento_id: string | null
  direcao: 'enviada' | 'recebida'
  canal: string
  texto: string
  intent_detectado: string | null
  acao_ia: string | null
  created_at: string
}

const LISTAS = [
  { key: 'aguardando', label: 'Aguardando confirmação' },
  { key: 'confirmado', label: 'Confirmados' },
  { key: 'reagendado', label: 'Reagendados' },
  { key: 'cancelado', label: 'Cancelados' },
  { key: 'precisa_atencao', label: 'Precisa da sua atenção' },
] as const

export function IaPage() {
  const { usuario } = useAuth()
  const [loading, setLoading] = useState(true)
  const [ags, setAgs] = useState<Agendamento[]>([])
  const [filtro, setFiltro] = useState<(typeof LISTAS)[number]['key']>('precisa_atencao')
  const [selected, setSelected] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const loadAgs = useCallback(async () => {
    let q = supabase
      .from('agendamentos')
      .select('*, cliente:clientes(*), barbeiro:barbeiros(*), servico:servicos(*)')
      .gte('inicio', new Date(Date.now() - 2 * 86400000).toISOString())
      .order('inicio')

    if (usuario?.papel === 'barbeiro' && usuario.barbeiro_id) {
      q = q.eq('barbeiro_id', usuario.barbeiro_id)
    }

    const { data } = await q
    setAgs((data as Agendamento[]) || [])
    setLoading(false)
  }, [usuario])

  useEffect(() => {
    void loadAgs()
  }, [loadAgs])

  const filtered = useMemo(() => ags.filter((a) => a.status === filtro), [ags, filtro])

  useEffect(() => {
    if (!selected) {
      setMsgs([])
      return
    }
    void (async () => {
      const { data } = await supabase
        .from('mensagens')
        .select('*')
        .eq('agendamento_id', selected)
        .order('created_at')
      setMsgs((data as Mensagem[]) || [])
    })()
  }, [selected])

  async function runLembretes() {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('disparar_lembretes')
    setBusy(false)
    if (error) {
      setErr(mapRpcError(error.message))
      return
    }
    setInfo(`Lembretes enviados: ${(data as { enviados: number }).enviados}`)
    await loadAgs()
  }

  async function runSemResposta() {
    setBusy(true)
    const { data, error } = await supabase.rpc('processar_sem_resposta')
    setBusy(false)
    if (error) {
      setErr(mapRpcError(error.message))
      return
    }
    setInfo(`Marcados sem resposta: ${(data as { marcados: number }).marcados}`)
    await loadAgs()
  }

  async function simular() {
    if (!selected || !texto.trim()) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('simular_resposta_cliente', {
      p_agendamento_id: selected,
      p_texto: texto.trim(),
    })
    setBusy(false)
    if (error) {
      setErr(mapRpcError(error.message))
      return
    }
    setTexto('')
    const reply = (data as { reply?: string })?.reply
    if (reply) setInfo(`IA: ${reply}`)
    const { data: rows } = await supabase
      .from('mensagens')
      .select('*')
      .eq('agendamento_id', selected)
      .order('created_at')
    setMsgs((rows as Mensagem[]) || [])
    await loadAgs()
  }

  async function desfazer() {
    if (!selected) return
    setBusy(true)
    const { error } = await supabase.rpc('desfazer_acao_ia', { p_agendamento_id: selected })
    setBusy(false)
    if (error) setErr(mapRpcError(error.message))
    else {
      setInfo('Ação da IA desfeita.')
      await loadAgs()
    }
  }

  if (loading) return <Spinner />

  const current = ags.find((a) => a.id === selected)

  return (
    <div>
      <PageHeader
        eyebrow="Fase 2"
        title="IA e mensagens"
        subtitle="Lembretes, confirmação e remarcação. Canal padrão: simulação (WhatsApp liga nas configs)."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runLembretes()}>
              Disparar lembretes
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void runSemResposta()}>
              Checar sem resposta
            </button>
          </div>
        }
      />

      {info ? <div className="alert alert-ok" style={{ marginBottom: 12 }}>{info}</div> : null}
      {err ? <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {LISTAS.map((l) => {
          const count = ags.filter((a) => a.status === l.key).length
          return (
            <button
              key={l.key}
              type="button"
              className={`btn ${filtro === l.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFiltro(l.key)}
            >
              {l.label} ({count})
            </button>
          )
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'minmax(0, 1fr)',
        }}
        className="ia-grid"
      >
        <section className="card" style={{ padding: '0.75rem 1rem', maxHeight: 520, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyState title="Lista vazia" text="Nada neste status no momento." />
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderBottom: '1px solid var(--line)',
                  background: selected === a.id ? 'var(--accent-soft)' : 'transparent',
                  padding: '0.75rem 0.35rem',
                  cursor: 'pointer',
                }}
              >
                <strong>
                  {formatTime(a.inicio)} · {a.cliente?.nome}
                </strong>
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.88rem' }}>
                  {a.servico?.nome} · {a.barbeiro?.nome} · {STATUS_LABEL[a.status]}
                </div>
              </button>
            ))
          )}
        </section>

        <section className="card" style={{ padding: '1rem', display: 'grid', gap: 10, minHeight: 320 }}>
          {!current ? (
            <p style={{ color: 'var(--ink-muted)' }}>Selecione um agendamento para ver a conversa.</p>
          ) : (
            <>
              <div>
                <strong>{current.cliente?.nome}</strong>
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                  {format(parseISO(current.inicio), "dd/MM 'às' HH:mm", { locale: ptBR })} · {STATUS_LABEL[current.status]}
                </div>
              </div>
              <div
                style={{
                  background: '#1c1917',
                  color: '#fef3c7',
                  borderRadius: 14,
                  padding: '0.85rem',
                  maxHeight: 280,
                  overflow: 'auto',
                  display: 'grid',
                  gap: 8,
                }}
              >
                {msgs.length === 0 ? (
                  <span style={{ opacity: 0.7 }}>Sem mensagens. Dispare o lembrete primeiro.</span>
                ) : (
                  msgs.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        justifySelf: m.direcao === 'enviada' ? 'start' : 'end',
                        maxWidth: '85%',
                        background: m.direcao === 'enviada' ? '#44403c' : '#b45309',
                        padding: '0.55rem 0.7rem',
                        borderRadius: 12,
                        fontSize: '0.9rem',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {m.texto}
                      {m.intent_detectado ? (
                        <div style={{ opacity: 0.7, fontSize: '0.75rem', marginTop: 4 }}>intent: {m.intent_detectado}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                  Simular resposta do cliente (ex.: sim, remarcar, cancelar, 1):
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['sim', 'remarcar', 'cancelar', '1', 'não entendi'].map((q) => (
                    <button key={q} type="button" className="btn btn-ghost" style={{ padding: '0.4rem 0.7rem' }} onClick={() => setTexto(q)}>
                      {q}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  style={{ borderRadius: 12, border: '1px solid var(--line)', padding: '0.75rem', background: 'var(--bg-elevated)' }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void simular()}>
                    Enviar como cliente
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void desfazer()}>
                    Desfazer ação da IA
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <style>{`
        @media (min-width: 900px) {
          .ia-grid { grid-template-columns: 0.9fr 1.1fr !important; }
        }
      `}</style>
    </div>
  )
}
