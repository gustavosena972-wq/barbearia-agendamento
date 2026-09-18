import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { DIAS_SEMANA } from '../../lib/format'
import { PageHeader, Spinner } from '../../components/ui'
import type { Barbearia } from '../../types/database'

const DEMO_SERVICOS = [
  { nome: 'Corte', duracao_min: 30, preco: 40 },
  { nome: 'Barba', duracao_min: 30, preco: 30 },
  { nome: 'Corte + Barba', duracao_min: 60, preco: 65 },
]

type BarbeiroDraft = {
  nome: string
  dias: number[]
  inicio: string
  fim: string
  almoco_inicio: string
  almoco_fim: string
}

const defaultBarbeiro = (): BarbeiroDraft => ({
  nome: '',
  dias: [1, 2, 3, 4, 5, 6],
  inicio: '09:00',
  fim: '19:00',
  almoco_inicio: '12:00',
  almoco_fim: '13:00',
})

export function SetupWizardPage() {
  const { usuario } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [shop, setShop] = useState<Barbearia | null>(null)
  const [step, setStep] = useState(0)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [endereco, setEndereco] = useState('')
  const [barbeiros, setBarbeiros] = useState<BarbeiroDraft[]>([defaultBarbeiro()])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('barbearia').select('*').limit(1).maybeSingle()
      const b = data as Barbearia | null
      setShop(b)
      if (b?.setup_completo) {
        navigate('/painel', { replace: true })
        return
      }
      if (b) {
        setNome(b.nome || '')
        setTelefone(b.telefone || '')
        setEndereco(b.endereco || '')
      }
      setLoading(false)
    })()
  }, [navigate])

  if (loading) return <Spinner />

  if (usuario?.papel !== 'dono') {
    return (
      <div className="alert alert-info">
        A configuração inicial é só do dono. Peça para ele concluir o wizard.
      </div>
    )
  }

  async function finish() {
    setError(null)
    if (nome.trim().length < 2) {
      setError('Nome da barbearia inválido.')
      return
    }
    if (barbeiros.length < 1) {
      setError('Cadastre pelo menos 1 barbeiro.')
      return
    }
    for (const b of barbeiros) {
      if (b.nome.trim().length < 2) {
        setError('Preencha o nome de todos os barbeiros.')
        return
      }
      if (b.dias.length === 0) {
        setError(`Escolha os dias de ${b.nome || 'cada barbeiro'}.`)
        return
      }
    }

    setBusy(true)
    try {
      let shopId = shop?.id
      if (shopId) {
        const { error: e1 } = await supabase
          .from('barbearia')
          .update({
            nome: nome.trim(),
            telefone: telefone.trim() || null,
            endereco: endereco.trim() || null,
          })
          .eq('id', shopId)
        if (e1) throw e1
      } else {
        const { data, error: e1 } = await supabase
          .from('barbearia')
          .insert({
            nome: nome.trim(),
            telefone: telefone.trim() || null,
            endereco: endereco.trim() || null,
          })
          .select('*')
          .single()
        if (e1) throw e1
        shopId = (data as Barbearia).id
      }

      // limpa demo prévia se houver (primeira config)
      const { count } = await supabase.from('agendamentos').select('*', { count: 'exact', head: true })
      if ((count || 0) > 0) {
        throw new Error('Já existem agendamentos. Edite em Config.')
      }
      // limpa cadastros parciais de tentativas anteriores
      await supabase.from('barbeiro_servicos').delete().neq('barbeiro_id', '00000000-0000-0000-0000-000000000000')
      await supabase.from('horarios_trabalho').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await supabase.from('barbeiros').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await supabase.from('servicos').delete().neq('id', '00000000-0000-0000-0000-000000000000')

      const createdBarbeiroIds: string[] = []
      for (let i = 0; i < barbeiros.length; i++) {
        const draft = barbeiros[i]
        const { data: br, error: eb } = await supabase
          .from('barbeiros')
          .insert({ nome: draft.nome.trim(), ordem: i, ativo: true })
          .select('id')
          .single()
        if (eb) throw eb
        createdBarbeiroIds.push(br.id)

        const rows = draft.dias.map((dia) => ({
          barbeiro_id: br.id,
          dia_semana: dia,
          inicio: draft.inicio,
          fim: draft.fim,
          almoco_inicio: draft.almoco_inicio || null,
          almoco_fim: draft.almoco_fim || null,
        }))
        const { error: eh } = await supabase.from('horarios_trabalho').insert(rows)
        if (eh) throw eh
      }

      const servicoIds: string[] = []
      for (let i = 0; i < DEMO_SERVICOS.length; i++) {
        const s = DEMO_SERVICOS[i]
        const { data: sv, error: es } = await supabase
          .from('servicos')
          .insert({ ...s, ordem: i, ativo: true })
          .select('id')
          .single()
        if (es) throw es
        servicoIds.push(sv.id)
      }

      const links = createdBarbeiroIds.flatMap((bid) =>
        servicoIds.map((sid) => ({ barbeiro_id: bid, servico_id: sid })),
      )
      const { error: el } = await supabase.from('barbeiro_servicos').insert(links)
      if (el) throw el

      const { error: ef } = await supabase
        .from('barbearia')
        .update({ setup_completo: true })
        .eq('id', shopId)
      if (ef) throw ef

      navigate('/painel', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar configuração.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow={`Passo ${step + 1} de 3`}
        title="Configuração inicial"
        subtitle="Você informa barbeiros, horários e serviços. Depois o cliente agenda sozinho."
      />

      {error ? (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
        {step === 0 ? (
          <>
            <div className="field">
              <label htmlFor="bn">Nome da barbearia</label>
              <input id="bn" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="bt">Telefone</label>
              <input id="bt" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="be">Endereço</label>
              <input id="be" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>
              Continuar
            </button>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem' }}>
              Cadastre de 1 a 8 barbeiros. Você poderá editar horários depois em Config.
            </p>
            {barbeiros.map((b, idx) => (
              <div key={idx} style={{ borderTop: idx ? '1px solid var(--line)' : undefined, paddingTop: idx ? '1rem' : 0, display: 'grid', gap: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Barbeiro {idx + 1}</strong>
                  {barbeiros.length > 1 ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '0.35rem 0.7rem' }}
                      onClick={() => setBarbeiros(barbeiros.filter((_, i) => i !== idx))}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
                <div className="field">
                  <label>Nome</label>
                  <input
                    value={b.nome}
                    onChange={(e) => {
                      const next = [...barbeiros]
                      next[idx] = { ...b, nome: e.target.value }
                      setBarbeiros(next)
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {DIAS_SEMANA.map((dia, d) => {
                    const on = b.dias.includes(d)
                    return (
                      <button
                        key={dia}
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          padding: '0.4rem 0.65rem',
                          background: on ? 'var(--ink)' : undefined,
                          color: on ? '#fff8ef' : undefined,
                        }}
                        onClick={() => {
                          const next = [...barbeiros]
                          const dias = on ? b.dias.filter((x) => x !== d) : [...b.dias, d].sort()
                          next[idx] = { ...b, dias }
                          setBarbeiros(next)
                        }}
                      >
                        {dia.slice(0, 3)}
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="field">
                    <label>Início</label>
                    <input
                      type="time"
                      value={b.inicio}
                      onChange={(e) => {
                        const next = [...barbeiros]
                        next[idx] = { ...b, inicio: e.target.value }
                        setBarbeiros(next)
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Fim</label>
                    <input
                      type="time"
                      value={b.fim}
                      onChange={(e) => {
                        const next = [...barbeiros]
                        next[idx] = { ...b, fim: e.target.value }
                        setBarbeiros(next)
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Almoço início</label>
                    <input
                      type="time"
                      value={b.almoco_inicio}
                      onChange={(e) => {
                        const next = [...barbeiros]
                        next[idx] = { ...b, almoco_inicio: e.target.value }
                        setBarbeiros(next)
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Almoço fim</label>
                    <input
                      type="time"
                      value={b.almoco_fim}
                      onChange={(e) => {
                        const next = [...barbeiros]
                        next[idx] = { ...b, almoco_fim: e.target.value }
                        setBarbeiros(next)
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={barbeiros.length >= 8}
              onClick={() => setBarbeiros([...barbeiros, defaultBarbeiro()])}
            >
              + Adicionar barbeiro
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
                Continuar
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p style={{ color: 'var(--ink-muted)' }}>
              Vamos cadastrar os serviços de exemplo do relatório. Você pode editar preços e nomes depois em Config.
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {DEMO_SERVICOS.map((s) => (
                <li key={s.nome}>
                  {s.nome} — {s.duracao_min} min — R$ {s.preco}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>
              Todos os barbeiros ficarão aptos a todos os serviços. Ajuste depois se precisar.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void finish()}>
                {busy ? 'Salvando…' : 'Concluir e abrir painel'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
