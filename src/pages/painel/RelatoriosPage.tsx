import { useEffect, useState } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { moneyBRL, mapRpcError } from '../../lib/format'
import { PageHeader, Spinner } from '../../components/ui'

interface Relatorio {
  pipeline: number
  atendimentos: number
  faturamento: number
  faturamento_pipeline: number
  por_hora: Array<{ hora: number; qtd: number }>
  por_barbeiro: Array<{
    nome: string
    atendimentos: number
    pipeline: number
    faturamento: number
    comissao: number
  }>
}

export function RelatoriosPage() {
  const [de, setDe] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [ate, setAte] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState<Relatorio | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    const { data: res, error } = await supabase.rpc('relatorio_resumo', {
      p_de: de,
      p_ate: ate,
    })
    setLoading(false)
    if (error) {
      setErr(mapRpcError(error.message))
      setData(null)
      return
    }
    setData(res as Relatorio)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <PageHeader
        eyebrow="Fase 3"
        title="Relatórios"
        subtitle="Pipeline (inclui aguardando) separado do faturamento realizado."
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'end' }}>
        <div className="field">
          <label>De</label>
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div className="field">
          <label>Até</label>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {err ? <div className="alert alert-error">{err}</div> : null}
      {loading ? <Spinner /> : null}

      {data && !loading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div className="card" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>Pipeline (não cancelados)</div>
              <strong style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>{data.pipeline ?? 0}</strong>
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>Realizados</div>
              <strong style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>{data.atendimentos}</strong>
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>Faturamento realizado</div>
              <strong style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>
                {moneyBRL(Number(data.faturamento))}
              </strong>
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>Potencial (pipeline)</div>
              <strong style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>
                {moneyBRL(Number(data.faturamento_pipeline ?? data.faturamento))}
              </strong>
            </div>
          </div>

          <section className="card" style={{ padding: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem', marginBottom: 8 }}>Por barbeiro</h2>
            {(data.por_barbeiro || []).length === 0 ? (
              <p style={{ color: 'var(--ink-muted)' }}>Sem dados no período.</p>
            ) : (
              (data.por_barbeiro || []).map((b) => (
                <div
                  key={b.nome}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '0.65rem 0',
                    borderTop: '1px solid var(--line)',
                  }}
                >
                  <strong>{b.nome}</strong>
                  <span style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                    {b.atendimentos} realizados · pipeline {b.pipeline ?? '—'} · {moneyBRL(Number(b.faturamento))} ·
                    comissão {moneyBRL(Number(b.comissao))}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="card" style={{ padding: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem', marginBottom: 8 }}>Horários mais movimentados (realizados)</h2>
            {(data.por_hora || []).length === 0 ? (
              <p style={{ color: 'var(--ink-muted)' }}>Sem dados.</p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {(data.por_hora || []).map((h) => {
                  const max = Math.max(...data.por_hora.map((x) => x.qtd), 1)
                  return (
                    <div key={h.hora} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 40px', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>{String(h.hora).padStart(2, '0')}h</span>
                      <div style={{ background: 'var(--line)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${(h.qtd / max) * 100}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, var(--accent), var(--accent-deep))',
                          }}
                        />
                      </div>
                      <span style={{ textAlign: 'right', fontWeight: 700 }}>{h.qtd}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
