import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { DIAS_SEMANA, moneyBRL } from '../../lib/format'
import { PageHeader, Spinner } from '../../components/ui'
import type { Barbearia, Barbeiro, Bloqueio, HorarioTrabalho, Servico } from '../../types/database'

export function ConfigPage() {
  const { usuario } = useAuth()
  const isDono = usuario?.papel === 'dono'
  const [loading, setLoading] = useState(true)
  const [shop, setShop] = useState<Barbearia | null>(null)
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // novo bloqueio
  const [blBarbeiro, setBlBarbeiro] = useState('')
  const [blInicio, setBlInicio] = useState('')
  const [blFim, setBlFim] = useState('')
  const [blMotivo, setBlMotivo] = useState('Folga')

  async function reload() {
    const [{ data: b }, { data: br }, { data: sv }, { data: bl }] = await Promise.all([
      supabase.from('barbearia').select('*').limit(1).maybeSingle(),
      supabase.from('barbeiros').select('*').order('ordem'),
      supabase.from('servicos').select('*').order('ordem'),
      supabase.from('bloqueios').select('*').order('inicio', { ascending: false }).limit(30),
    ])
    setShop(b as Barbearia | null)
    setBarbeiros((br as Barbeiro[]) || [])
    setServicos((sv as Servico[]) || [])
    setBloqueios((bl as Bloqueio[]) || [])
    if (!blBarbeiro && br?.[0]) setBlBarbeiro((br[0] as Barbeiro).id)
    setLoading(false)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveShop(e: FormEvent) {
    e.preventDefault()
    if (!shop || !isDono) return
    setErr(null)
    const { error } = await supabase
      .from('barbearia')
      .update({
        nome: shop.nome,
        telefone: shop.telefone,
        endereco: shop.endereco,
        exibir_precos: shop.exibir_precos,
        lembrete_horas_antes: shop.lembrete_horas_antes,
        regra_sem_resposta: shop.regra_sem_resposta,
        canal_mensagens: shop.canal_mensagens || 'simulacao',
      })
      .eq('id', shop.id)
    if (error) setErr(error.message)
    else setMsg('Barbearia salva.')
  }

  async function addBloqueio(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    const { error } = await supabase.from('bloqueios').insert({
      barbeiro_id: blBarbeiro,
      inicio: new Date(blInicio).toISOString(),
      fim: new Date(blFim).toISOString(),
      motivo: blMotivo.trim() || 'bloqueio',
      created_by: usuario?.id ?? null,
    })
    if (error) setErr(error.message)
    else {
      setMsg('Bloqueio criado.')
      setBlInicio('')
      setBlFim('')
      await reload()
    }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <PageHeader title="Configurações" subtitle="Barbearia, serviços, bloqueios e preços." />

      {msg ? <div className="alert alert-ok">{msg}</div> : null}
      {err ? <div className="alert alert-error">{err}</div> : null}

      {shop && isDono ? (
        <form className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.75rem' }} onSubmit={(e) => void saveShop(e)}>
          <h2 style={{ fontSize: '1.1rem' }}>Barbearia</h2>
          <div className="field">
            <label>Nome</label>
            <input value={shop.nome} onChange={(e) => setShop({ ...shop, nome: e.target.value })} />
          </div>
          <div className="field">
            <label>Telefone</label>
            <input value={shop.telefone || ''} onChange={(e) => setShop({ ...shop, telefone: e.target.value })} />
          </div>
          <div className="field">
            <label>Endereço</label>
            <input value={shop.endereco || ''} onChange={(e) => setShop({ ...shop, endereco: e.target.value })} />
          </div>
          <label className="consent" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={shop.exibir_precos}
              onChange={(e) => setShop({ ...shop, exibir_precos: e.target.checked })}
            />
            Exibir preços na página do cliente
          </label>
          <div className="field">
            <label>Lembrete (horas antes)</label>
            <input
              type="number"
              min={1}
              max={168}
              value={shop.lembrete_horas_antes}
              onChange={(e) => setShop({ ...shop, lembrete_horas_antes: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Sem resposta do cliente</label>
            <select
              value={shop.regra_sem_resposta}
              onChange={(e) => setShop({ ...shop, regra_sem_resposta: e.target.value })}
            >
              <option value="avisar_barbeiro">Avisar barbeiro (recomendado)</option>
              <option value="manter_aguardando">Manter aguardando</option>
            </select>
          </div>
          <div className="field">
            <label>Canal com o cliente</label>
            <select
              value={shop.canal_mensagens || 'simulacao'}
              onChange={(e) =>
                setShop({
                  ...shop,
                  canal_mensagens: e.target.value as 'simulacao' | 'whatsapp',
                })
              }
            >
              <option value="simulacao">Simulação no painel (demo / grátis)</option>
              <option value="whatsapp">WhatsApp Cloud API (requer secrets)</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            Salvar
          </button>
        </form>
      ) : null}

      {isDono ? <ComissoesSection barbeiros={barbeiros} /> : null}
      {isDono ? <HorariosSection barbeiros={barbeiros} /> : null}
      {isDono ? <BarbeiroServicosSection barbeiros={barbeiros} servicos={servicos} /> : null}

      <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.75rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Barbeiros</h2>
        {isDono ? <BarbeirosCrud barbeiros={barbeiros} onChange={() => void reload()} /> : (
          barbeiros.map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>{b.nome}</strong>
              <span className="badge">{b.ativo ? 'Ativo' : 'Inativo'}</span>
            </div>
          ))
        )}
      </section>

      <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Serviços</h2>
        {isDono ? <ServicosCrud servicos={servicos} onChange={() => void reload()} /> : (
          servicos.map((s) => (
            <div key={s.id}>
              {s.nome} — {s.duracao_min} min — {moneyBRL(Number(s.preco))}
            </div>
          ))
        )}
      </section>

      <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.75rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Bloqueios / folgas</h2>
        <form style={{ display: 'grid', gap: 8 }} onSubmit={(e) => void addBloqueio(e)}>
          <div className="field">
            <label>Barbeiro</label>
            <select value={blBarbeiro} onChange={(e) => setBlBarbeiro(e.target.value)}>
              {barbeiros.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Início</label>
            <input type="datetime-local" required value={blInicio} onChange={(e) => setBlInicio(e.target.value)} />
          </div>
          <div className="field">
            <label>Fim</label>
            <input type="datetime-local" required value={blFim} onChange={(e) => setBlFim(e.target.value)} />
          </div>
          <div className="field">
            <label>Motivo</label>
            <input value={blMotivo} onChange={(e) => setBlMotivo(e.target.value)} maxLength={120} />
          </div>
          <button className="btn btn-primary" type="submit">
            Bloquear horário
          </button>
        </form>
        <div>
          {bloqueios.map((b) => (
            <div key={b.id} style={{ padding: '0.55rem 0', borderTop: '1px solid var(--line)', fontSize: '0.9rem' }}>
              {b.motivo}: {new Date(b.inicio).toLocaleString('pt-BR')} → {new Date(b.fim).toLocaleString('pt-BR')}
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Notificações no iPhone</h2>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem', lineHeight: 1.5 }}>
          1) Abra o painel no Safari · 2) Compartilhar → Adicionar à Tela de Início · 3) Abra o ícone · 4) Toque em
          “Ativar notificações” no Início. Exige iOS 16.4+.
        </p>
      </section>
    </div>
  )
}

function ComissoesSection({ barbeiros }: { barbeiros: Barbeiro[] }) {
  const [rows, setRows] = useState<Record<string, { tipo: string; valor: number }>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('comissoes').select('*')
      const map: Record<string, { tipo: string; valor: number }> = {}
      for (const b of barbeiros) {
        const found = (data || []).find((c: { barbeiro_id: string }) => c.barbeiro_id === b.id) as
          | { tipo: string; valor: number }
          | undefined
        map[b.id] = found
          ? { tipo: found.tipo, valor: Number(found.valor) }
          : { tipo: 'percentual', valor: 40 }
      }
      setRows(map)
    })()
  }, [barbeiros])

  async function save(barbeiroId: string) {
    const r = rows[barbeiroId]
    if (!r) return
    const { error } = await supabase.from('comissoes').upsert(
      {
        barbeiro_id: barbeiroId,
        tipo: r.tipo,
        valor: r.valor,
        ativo: true,
      },
      { onConflict: 'barbeiro_id' },
    )
    setMsg(error ? error.message : 'Comissão salva.')
  }

  return (
    <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.85rem' }}>
      <h2 style={{ fontSize: '1.1rem' }}>Comissões</h2>
      {msg ? <div className="alert alert-ok">{msg}</div> : null}
      {barbeiros.map((b) => {
        const r = rows[b.id] || { tipo: 'percentual', valor: 40 }
        return (
          <div key={b.id} style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <strong>{b.nome}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="field">
                <label>Tipo</label>
                <select
                  value={r.tipo}
                  onChange={(e) => setRows({ ...rows, [b.id]: { ...r, tipo: e.target.value } })}
                >
                  <option value="percentual">Percentual %</option>
                  <option value="valor_fixo">Valor fixo R$</option>
                </select>
              </div>
              <div className="field">
                <label>Valor</label>
                <input
                  type="number"
                  step="0.01"
                  value={r.valor}
                  onChange={(e) => setRows({ ...rows, [b.id]: { ...r, valor: Number(e.target.value) } })}
                />
              </div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void save(b.id)}>
              Salvar comissão
            </button>
          </div>
        )
      })}
    </section>
  )
}

function HorariosSection({ barbeiros }: { barbeiros: Barbeiro[] }) {
  const [barbeiroId, setBarbeiroId] = useState(barbeiros[0]?.id || '')
  const [rows, setRows] = useState<HorarioTrabalho[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!barbeiroId && barbeiros[0]) setBarbeiroId(barbeiros[0].id)
  }, [barbeiros, barbeiroId])

  useEffect(() => {
    if (!barbeiroId) return
    void (async () => {
      const { data } = await supabase
        .from('horarios_trabalho')
        .select('*')
        .eq('barbeiro_id', barbeiroId)
        .order('dia_semana')
      setRows((data as HorarioTrabalho[]) || [])
    })()
  }, [barbeiroId])

  async function saveDay(dia: number) {
    setErr(null)
    const existing = rows.find((r) => r.dia_semana === dia && r.id)
    const draft = rows.find((r) => r.dia_semana === dia) || {
      id: '',
      barbeiro_id: barbeiroId,
      dia_semana: dia,
      inicio: '09:00',
      fim: '19:00',
      almoco_inicio: '12:00',
      almoco_fim: '13:00',
    }

    if (existing?.id) {
      const { error } = await supabase
        .from('horarios_trabalho')
        .update({
          inicio: draft.inicio,
          fim: draft.fim,
          almoco_inicio: draft.almoco_inicio || null,
          almoco_fim: draft.almoco_fim || null,
        })
        .eq('id', existing.id)
      if (error) setErr(error.message)
      else setMsg(`Horário de ${DIAS_SEMANA[dia]} salvo.`)
    } else {
      const { data, error } = await supabase
        .from('horarios_trabalho')
        .insert({
          barbeiro_id: barbeiroId,
          dia_semana: dia,
          inicio: draft.inicio,
          fim: draft.fim,
          almoco_inicio: draft.almoco_inicio || null,
          almoco_fim: draft.almoco_fim || null,
        })
        .select('*')
        .single()
      if (error) setErr(error.message)
      else {
        setRows((prev) => [...prev.filter((x) => x.dia_semana !== dia), data as HorarioTrabalho])
        setMsg(`Horário de ${DIAS_SEMANA[dia]} criado.`)
      }
    }
  }

  async function removeDay(dia: number) {
    const existing = rows.find((r) => r.dia_semana === dia)
    if (!existing) return
    const { error } = await supabase.from('horarios_trabalho').delete().eq('id', existing.id)
    if (error) setErr(error.message)
    else {
      setRows(rows.filter((r) => r.id !== existing.id))
      setMsg(`Removido ${DIAS_SEMANA[dia]}.`)
    }
  }

  function patch(dia: number, patch: Partial<HorarioTrabalho>) {
    const idx = rows.findIndex((r) => r.dia_semana === dia)
    if (idx >= 0) {
      const next = [...rows]
      next[idx] = { ...next[idx], ...patch }
      setRows(next)
    } else {
      setRows([
        ...rows,
        {
          id: '',
          barbeiro_id: barbeiroId,
          dia_semana: dia,
          inicio: '09:00',
          fim: '19:00',
          almoco_inicio: '12:00',
          almoco_fim: '13:00',
          ...patch,
        },
      ])
    }
  }

  return (
    <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.85rem' }}>
      <h2 style={{ fontSize: '1.1rem' }}>Horários de trabalho</h2>
      {msg ? <div className="alert alert-ok">{msg}</div> : null}
      {err ? <div className="alert alert-error">{err}</div> : null}
      <div className="field">
        <label>Barbeiro</label>
        <select value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
          {barbeiros.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      </div>
      {DIAS_SEMANA.map((nomeDia, dia) => {
        const r = rows.find((x) => x.dia_semana === dia)
        return (
          <div key={dia} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 8 }}>
            <strong>{nomeDia}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="field">
                <label>Início</label>
                <input
                  type="time"
                  value={r?.inicio || '09:00'}
                  onChange={(e) => patch(dia, { inicio: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Fim</label>
                <input type="time" value={r?.fim || '19:00'} onChange={(e) => patch(dia, { fim: e.target.value })} />
              </div>
              <div className="field">
                <label>Almoço início</label>
                <input
                  type="time"
                  value={r?.almoco_inicio || ''}
                  onChange={(e) => patch(dia, { almoco_inicio: e.target.value || null })}
                />
              </div>
              <div className="field">
                <label>Almoço fim</label>
                <input
                  type="time"
                  value={r?.almoco_fim || ''}
                  onChange={(e) => patch(dia, { almoco_fim: e.target.value || null })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => void saveDay(dia)}>
                Salvar {nomeDia}
              </button>
              {r?.id ? (
                <button type="button" className="btn btn-danger" onClick={() => void removeDay(dia)}>
                  Remover dia
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function BarbeiroServicosSection({ barbeiros, servicos }: { barbeiros: Barbeiro[]; servicos: Servico[] }) {
  const [barbeiroId, setBarbeiroId] = useState(barbeiros[0]?.id || '')
  const [linked, setLinked] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!barbeiroId && barbeiros[0]) setBarbeiroId(barbeiros[0].id)
  }, [barbeiros, barbeiroId])

  useEffect(() => {
    if (!barbeiroId) return
    void (async () => {
      const { data } = await supabase.from('barbeiro_servicos').select('servico_id').eq('barbeiro_id', barbeiroId)
      setLinked((data || []).map((x: { servico_id: string }) => x.servico_id))
    })()
  }, [barbeiroId])

  async function toggle(servicoId: string) {
    const on = linked.includes(servicoId)
    if (on) {
      await supabase.from('barbeiro_servicos').delete().eq('barbeiro_id', barbeiroId).eq('servico_id', servicoId)
      setLinked(linked.filter((id) => id !== servicoId))
    } else {
      await supabase.from('barbeiro_servicos').insert({ barbeiro_id: barbeiroId, servico_id: servicoId })
      setLinked([...linked, servicoId])
    }
    setMsg('Vínculo atualizado.')
  }

  return (
    <section className="card" style={{ padding: '1.1rem', display: 'grid', gap: '0.75rem' }}>
      <h2 style={{ fontSize: '1.1rem' }}>Serviços por barbeiro</h2>
      {msg ? <div className="alert alert-ok">{msg}</div> : null}
      <div className="field">
        <label>Barbeiro</label>
        <select value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)}>
          {barbeiros.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      </div>
      {servicos.map((s) => (
        <label key={s.id} className="consent" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={linked.includes(s.id)} onChange={() => void toggle(s.id)} />
          {s.nome}
        </label>
      ))}
    </section>
  )
}

function BarbeirosCrud({ barbeiros, onChange }: { barbeiros: Barbeiro[]; onChange: () => void }) {
  const [nome, setNome] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (nome.trim().length < 2) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('barbeiros').insert({
      nome: nome.trim(),
      ativo: true,
      ordem: barbeiros.length,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else {
      setNome('')
      onChange()
    }
  }

  async function rename(b: Barbeiro, next: string) {
    const { error } = await supabase.from('barbeiros').update({ nome: next.trim() }).eq('id', b.id)
    if (error) setErr(error.message)
    else onChange()
  }

  async function toggleAtivo(b: Barbeiro) {
    const { error } = await supabase.from('barbeiros').update({ ativo: !b.ativo }).eq('id', b.id)
    if (error) setErr(error.message)
    else onChange()
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {err ? <div className="alert alert-error">{err}</div> : null}
      {barbeiros.map((b) => (
        <div key={b.id} style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div className="field">
            <label>Nome</label>
            <input
              defaultValue={b.nome}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value.trim() !== b.nome) void rename(b, e.target.value)
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`badge ${b.ativo ? 'badge-ok' : 'badge-danger'}`}>{b.ativo ? 'Ativo' : 'Inativo'}</span>
            <button type="button" className="btn btn-ghost" style={{ padding: '0.35rem 0.7rem' }} onClick={() => void toggleAtivo(b)}>
              {b.ativo ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        </div>
      ))}
      <div className="field">
        <label>Novo barbeiro</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" />
      </div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void add()}>
        Adicionar barbeiro
      </button>
    </div>
  )
}

function ServicosCrud({ servicos, onChange }: { servicos: Servico[]; onChange: () => void }) {
  const [draft, setDraft] = useState({ nome: '', duracao_min: 30, preco: 40 })
  const [err, setErr] = useState<string | null>(null)

  async function save(s: Servico) {
    const { error } = await supabase
      .from('servicos')
      .update({ nome: s.nome, duracao_min: s.duracao_min, preco: s.preco, ativo: s.ativo })
      .eq('id', s.id)
    if (error) setErr(error.message)
    else onChange()
  }

  async function add() {
    if (draft.nome.trim().length < 2) return
    const { error } = await supabase.from('servicos').insert({
      nome: draft.nome.trim(),
      duracao_min: draft.duracao_min,
      preco: draft.preco,
      ativo: true,
      ordem: servicos.length,
    })
    if (error) setErr(error.message)
    else {
      setDraft({ nome: '', duracao_min: 30, preco: 40 })
      onChange()
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err ? <div className="alert alert-error">{err}</div> : null}
      {servicos.map((s) => (
        <ServicoRow key={s.id} initial={s} onSave={(next) => void save(next)} onToggle={() => void save({ ...s, ativo: !s.ativo })} />
      ))}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 8 }}>
        <strong>Novo serviço</strong>
        <div className="field">
          <label>Nome</label>
          <input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field">
            <label>Duração</label>
            <input
              type="number"
              value={draft.duracao_min}
              onChange={(e) => setDraft({ ...draft, duracao_min: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Preço</label>
            <input
              type="number"
              step="0.01"
              value={draft.preco}
              onChange={(e) => setDraft({ ...draft, preco: Number(e.target.value) })}
            />
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void add()}>
          Adicionar serviço
        </button>
      </div>
    </div>
  )
}

function ServicoRow({
  initial,
  onSave,
  onToggle,
}: {
  initial: Servico
  onSave: (s: Servico) => void
  onToggle: () => void
}) {
  const [s, setS] = useState(initial)
  useEffect(() => setS(initial), [initial])

  return (
    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="field">
        <label>Nome</label>
        <input value={s.nome} onChange={(e) => setS({ ...s, nome: e.target.value })} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="field">
          <label>Duração (min)</label>
          <input
            type="number"
            value={s.duracao_min}
            onChange={(e) => setS({ ...s, duracao_min: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Preço</label>
          <input
            type="number"
            step="0.01"
            value={s.preco}
            onChange={(e) => setS({ ...s, preco: Number(e.target.value) })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={() => onSave(s)}>
          Salvar ({moneyBRL(Number(s.preco))})
        </button>
        <button type="button" className="btn btn-ghost" onClick={onToggle}>
          {s.ativo ? 'Desativar' : 'Ativar'}
        </button>
      </div>
    </div>
  )
}
