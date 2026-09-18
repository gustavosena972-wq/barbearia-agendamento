import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPhoneDisplay } from '../../lib/phone'
import { formatDateShort, formatDateTime, STATUS_LABEL } from '../../lib/format'
import { PageHeader, Spinner, EmptyState } from '../../components/ui'
import type { Agendamento, Cliente } from '../../types/database'

export function ClientesPage() {
  const [loading, setLoading] = useState(true)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Cliente | null>(null)
  const [historico, setHistorico] = useState<Agendamento[]>([])
  const [histLoading, setHistLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('clientes').select('*').order('nome')
      setClientes((data as Cliente[]) || [])
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!selected) {
      setHistorico([])
      return
    }
    setHistLoading(true)
    void (async () => {
      const { data } = await supabase
        .from('agendamentos')
        .select('*, barbeiro:barbeiros(*), servico:servicos(*)')
        .eq('cliente_id', selected.id)
        .order('inicio', { ascending: false })
        .limit(40)
      setHistorico((data as Agendamento[]) || [])
      setHistLoading(false)
    })()
  }, [selected])

  const filtered = clientes.filter((c) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return c.nome.toLowerCase().includes(s) || c.telefone.includes(s.replace(/\D/g, ''))
  })

  return (
    <div>
      <PageHeader title="Clientes" subtitle="Histórico de serviços e frequência." />
      <div className="field" style={{ marginBottom: '1rem', maxWidth: 360 }}>
        <label htmlFor="q">Buscar</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou telefone" />
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum cliente" text="Os agendamentos públicos aparecem aqui." />
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0,1fr)' }} className="cli-grid">
          <div className="card" style={{ padding: '0.5rem 1rem', maxHeight: 560, overflow: 'auto' }}>
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderBottom: '1px solid var(--line)',
                  background: selected?.id === c.id ? 'var(--accent-soft)' : 'transparent',
                  padding: '0.85rem 0.25rem',
                  cursor: 'pointer',
                }}
              >
                <strong>{c.nome}</strong>
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>{formatPhoneDisplay(c.telefone)}</div>
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: '1rem' }}>
            {!selected ? (
              <p style={{ color: 'var(--ink-muted)' }}>Selecione um cliente para ver o histórico.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem' }}>{selected.nome}</h2>
                  <p style={{ color: 'var(--ink-muted)' }}>
                    {formatPhoneDisplay(selected.telefone)}
                    {selected.consentimento_mensagens
                      ? ` · consentimento ${selected.consentimento_em ? formatDateShort(selected.consentimento_em) : 'ok'}`
                      : ' · sem consentimento'}
                  </p>
                  <p style={{ fontSize: '0.9rem' }}>
                    Frequência: <strong>{historico.filter((h) => h.status !== 'cancelado').length}</strong> atendimentos
                    registrados
                  </p>
                </div>
                {histLoading ? (
                  <Spinner />
                ) : historico.length === 0 ? (
                  <p style={{ color: 'var(--ink-muted)' }}>Sem histórico.</p>
                ) : (
                  historico.map((h) => (
                    <div key={h.id} style={{ padding: '0.65rem 0', borderTop: '1px solid var(--line)' }}>
                      <strong>{formatDateTime(h.inicio)}</strong>
                      <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                        {h.servico?.nome} · {h.barbeiro?.nome} · {STATUS_LABEL[h.status]}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @media (min-width: 860px) {
          .cli-grid { grid-template-columns: 0.9fr 1.1fr !important; }
        }
      `}</style>
    </div>
  )
}
