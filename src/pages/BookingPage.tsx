import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { formatPhoneDisplay, isValidBrPhone, maskPhoneInput, normalizePhone } from '../lib/phone'
import { formatTime, mapRpcError } from '../lib/format'
import { upcomingDates } from '../lib/dates'
import { appHref } from '../lib/appUrl'
import type { CatalogoPublico, Slot } from '../types/database'
import { EmptyState, Spinner } from '../components/ui'

type Step = 'servico' | 'barbeiro' | 'horario' | 'dados' | 'ok'

export function BookingPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [catalogo, setCatalogo] = useState<CatalogoPublico | null>(null)
  const [step, setStep] = useState<Step>('servico')
  const [servicoId, setServicoId] = useState<string | null>(null)
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null)
  const [data, setData] = useState(upcomingDates(1)[0])
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [inicio, setInicio] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; manage_token: string; inicio: string } | null>(null)

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }
    void (async () => {
      const { data, error: err } = await supabase.rpc('catalogo_publico')
      if (err) {
        setError('Não foi possível carregar a barbearia.')
      } else {
        setCatalogo(data as CatalogoPublico)
      }
      setLoading(false)
    })()
  }, [])

  const servico = useMemo(
    () => catalogo?.servicos?.find((s) => s.id === servicoId) ?? null,
    [catalogo, servicoId],
  )

  const barbeirosFiltrados = useMemo(() => {
    if (!catalogo?.barbeiros || !servicoId) return []
    return catalogo.barbeiros.filter((b) => b.servico_ids?.includes(servicoId))
  }, [catalogo, servicoId])

  const barbeiro = useMemo(
    () => catalogo?.barbeiros?.find((b) => b.id === barbeiroId) ?? null,
    [catalogo, barbeiroId],
  )

  useEffect(() => {
    if (!barbeiroId || !servicoId || !data || step !== 'horario') return
    let alive = true
    setSlotsLoading(true)
    setInicio(null)
    void (async () => {
      const { data: rows, error: err } = await supabase.rpc('listar_slots', {
        p_barbeiro_id: barbeiroId,
        p_servico_id: servicoId,
        p_data: data,
      })
      if (!alive) return
      if (err) {
        setError('Erro ao buscar horários.')
        setSlots([])
      } else {
        setSlots((rows as Slot[]) || [])
        setError(null)
      }
      setSlotsLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [barbeiroId, servicoId, data, step])

  async function submit() {
    if (!barbeiroId || !servicoId || !inicio) return
    setError(null)
    if (nome.trim().length < 2) {
      setError('Informe seu nome.')
      return
    }
    if (!isValidBrPhone(telefone)) {
      setError('Telefone inválido. Use DDD + número.')
      return
    }
    if (!consent) {
      setError('Aceite o consentimento para receber mensagens sobre o agendamento.')
      return
    }

    setSubmitting(true)
    const { data: res, error: err } = await supabase.rpc('criar_agendamento_publico', {
      p_barbeiro_id: barbeiroId,
      p_servico_id: servicoId,
      p_inicio: inicio,
      p_nome: nome.trim(),
      p_telefone: normalizePhone(telefone),
      p_consentimento: true,
    })
    setSubmitting(false)

    if (err) {
      setError(mapRpcError(err.message))
      return
    }

    const payload = res as { id: string; manage_token: string; inicio: string }
    setResult(payload)
    setStep('ok')
    // tenta notificar push (não bloqueia UX se falhar)
    void supabase.functions.invoke('notify-new-booking', {
      body: { agendamento_id: payload.id, manage_token: payload.manage_token },
    })
  }

  if (!supabaseConfigured) {
    return (
      <div className="app-shell" style={{ padding: '3rem 0' }}>
        <EmptyState
          title="Configure o Supabase"
          text="Falta o arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY."
          action={
            <Link className="btn btn-primary" to="/setup">
              Ver instruções
            </Link>
          }
        />
      </div>
    )
  }

  if (loading) return <Spinner label="Carregando barbearia" />

  if (!catalogo?.ready) {
    return (
      <div className="app-shell" style={{ padding: '3rem 0' }}>
        <EmptyState
          title="Em breve"
          text="A barbearia ainda está configurando horários e serviços. Volte em breve."
          action={
            <Link className="btn btn-secondary" to="/painel/login">
              Sou da equipe
            </Link>
          }
        />
      </div>
    )
  }

  const shop = catalogo.barbearia!

  return (
    <div className="booking-page">
      <section className="booking-hero">
        <div className="app-shell booking-hero-inner">
          <p className="booking-kicker">Agendamento online</p>
          <h1 className="booking-brand rise">{shop.nome}</h1>
          <p className="booking-lead rise" style={{ animationDelay: '0.08s' }}>
            Escolha o serviço, o barbeiro e o horário. Só precisamos do seu nome e telefone.
          </p>
          {shop.endereco ? <p className="booking-meta fade">{shop.endereco}</p> : null}
        </div>
      </section>

      <div className="app-shell" style={{ padding: '1.25rem 0 3.5rem', marginTop: '-2.5rem', position: 'relative', zIndex: 2 }}>
        <div className="card booking-card rise" style={{ animationDelay: '0.12s' }}>
          <ol className="booking-steps" aria-label="Etapas">
            {[
              ['servico', 'Serviço'],
              ['barbeiro', 'Barbeiro'],
              ['horario', 'Horário'],
              ['dados', 'Seus dados'],
            ].map(([key, label], i) => {
              const order: Step[] = ['servico', 'barbeiro', 'horario', 'dados', 'ok']
              const active = step === key
              const done = order.indexOf(step) > order.indexOf(key as Step)
              return (
                <li key={key} className={active ? 'active' : done ? 'done' : ''}>
                  <span>{i + 1}</span>
                  {label}
                </li>
              )
            })}
          </ol>

          {error ? (
            <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          ) : null}

          {step === 'servico' ? (
            <div className="choice-grid">
              {catalogo.servicos?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`choice ${servicoId === s.id ? 'selected' : ''}`}
                  onClick={() => {
                    setServicoId(s.id)
                    setBarbeiroId(null)
                    setInicio(null)
                    setStep('barbeiro')
                  }}
                >
                  <strong>{s.nome}</strong>
                </button>
              ))}
            </div>
          ) : null}

          {step === 'barbeiro' ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setStep('servico')}>
                ← Voltar
              </button>
              {barbeirosFiltrados.length === 0 ? (
                <EmptyState title="Sem barbeiro" text="Nenhum barbeiro disponível para este serviço." />
              ) : (
                <div className="choice-grid">
                  {barbeirosFiltrados.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`choice ${barbeiroId === b.id ? 'selected' : ''}`}
                      onClick={() => {
                        setBarbeiroId(b.id)
                        setStep('horario')
                      }}
                    >
                      <strong>{b.nome}</strong>
                      <span>Horários livres na próxima etapa</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {step === 'horario' ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setStep('barbeiro')}>
                ← Voltar
              </button>
              <p style={{ color: 'var(--ink-muted)' }}>
                {servico?.nome} com {barbeiro?.nome}
              </p>
              <div className="date-rail" role="listbox" aria-label="Datas">
                {upcomingDates(14).map((d) => {
                  const label = format(parseISO(`${d}T12:00:00`), 'EEE dd/MM', { locale: ptBR })
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`date-chip ${data === d ? 'selected' : ''}`}
                      onClick={() => setData(d)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {slotsLoading ? (
                <Spinner label="Buscando horários" />
              ) : slots.length === 0 ? (
                <EmptyState title="Sem horários" text="Não há vagas neste dia. Tente outra data." />
              ) : (
                <div className="slot-grid">
                  {slots.map((s) => (
                    <button
                      key={s.inicio}
                      type="button"
                      className={`slot ${inicio === s.inicio ? 'selected' : ''}`}
                      onClick={() => {
                        setInicio(s.inicio)
                        setStep('dados')
                      }}
                    >
                      {formatTime(s.inicio)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {step === 'dados' ? (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setStep('horario')}>
                ← Voltar
              </button>
              <div className="summary">
                <div>
                  <span>Serviço</span>
                  <strong>{servico?.nome}</strong>
                </div>
                <div>
                  <span>Barbeiro</span>
                  <strong>{barbeiro?.nome}</strong>
                </div>
                <div>
                  <span>Quando</span>
                  <strong>
                    {inicio
                      ? `${format(parseISO(inicio), "dd/MM 'às' HH:mm", { locale: ptBR })}`
                      : '—'}
                  </strong>
                </div>
              </div>
              <div className="field">
                <label htmlFor="nome">Nome</label>
                <input
                  id="nome"
                  autoComplete="name"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={80}
                  placeholder="Como devemos te chamar"
                />
              </div>
              <div className="field">
                <label htmlFor="tel">Telefone (WhatsApp)</label>
                <input
                  id="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(maskPhoneInput(e.target.value))}
                  placeholder="(31) 99999-0000"
                />
              </div>
              <label className="consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  Autorizo o uso do meu nome e telefone para confirmar, remarcar ou cancelar este agendamento
                  (LGPD). Sem conta — só este atendimento.
                </span>
              </label>
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>
                {submitting ? 'Confirmando…' : 'Confirmar agendamento'}
              </button>
            </div>
          ) : null}

          {step === 'ok' && result ? (
            <div className="rise" style={{ display: 'grid', gap: '1rem', textAlign: 'center', padding: '0.5rem 0' }}>
              <div className="badge badge-ok" style={{ justifySelf: 'center' }}>
                Agendado
              </div>
              <h2 style={{ fontSize: '1.6rem' }}>Horário reservado</h2>
              <p style={{ color: 'var(--ink-muted)' }}>
                {servico?.nome} com {barbeiro?.nome}
                <br />
                {format(parseISO(result.inicio), "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })}
                <br />
                {nome} · {formatPhoneDisplay(telefone)}
              </p>
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-muted)' }}>
                Guarde o link abaixo para remarcar ou cancelar.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  const link = appHref(`/agendamento/${result.id}/${result.manage_token}`)
                  try {
                    await navigator.clipboard.writeText(link)
                    setError(null)
                    alert('Link copiado. Envie para o cliente ou salve.')
                  } catch {
                    prompt('Copie o link:', link)
                  }
                }}
              >
                Copiar link do agendamento
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/agendamento/${result.id}/${result.manage_token}`)}
              >
                Abrir meu agendamento
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStep('servico')
                  setServicoId(null)
                  setBarbeiroId(null)
                  setInicio(null)
                  setNome('')
                  setTelefone('')
                  setConsent(false)
                  setResult(null)
                }}
              >
                Novo agendamento
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <style>{bookingCss}</style>
    </div>
  )
}

const bookingCss = `
.booking-hero {
  min-height: min(52vh, 420px);
  display: grid;
  align-items: end;
  padding: 2.5rem 0 3.5rem;
  background:
    linear-gradient(180deg, rgba(28,25,21,0.55), rgba(28,25,21,0.72)),
    radial-gradient(circle at 20% 20%, #f59e0b66, transparent 40%),
    linear-gradient(135deg, #292524, #1c1917 60%, #44403c);
  color: #fff8ef;
}
.booking-hero-inner { display: grid; gap: 0.75rem; padding-bottom: 0.5rem; }
.booking-kicker {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.8;
}
.booking-brand {
  font-size: clamp(2.4rem, 9vw, 4.4rem);
  line-height: 0.95;
  max-width: 10ch;
}
.booking-lead {
  max-width: 36ch;
  font-size: 1.05rem;
  opacity: 0.9;
}
.booking-meta { opacity: 0.7; font-size: 0.92rem; }
.booking-card { padding: 1.25rem; }
.booking-steps {
  list-style: none;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0;
  margin: 0 0 1.25rem;
}
.booking-steps li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  font-weight: 650;
  color: var(--ink-muted);
}
.booking-steps li span {
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--line);
  font-size: 0.75rem;
}
.booking-steps li.active { color: var(--ink); }
.booking-steps li.active span,
.booking-steps li.done span {
  background: var(--accent);
  color: white;
}
.choice-grid {
  display: grid;
  gap: 0.75rem;
}
@media (min-width: 640px) {
  .choice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.choice {
  text-align: left;
  border: 1px solid var(--line);
  background: var(--bg-elevated);
  border-radius: 16px;
  padding: 1rem 1.1rem;
  display: grid;
  gap: 0.25rem;
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.choice strong { font-size: 1.05rem; }
.choice span { color: var(--ink-muted); font-size: 0.9rem; }
.choice:hover { border-color: #d6d3d1; }
.choice.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px #fbbf2444;
}
.date-rail {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: thin;
}
.date-chip {
  flex: 0 0 auto;
  border: 1px solid var(--line);
  background: var(--bg-elevated);
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  font-weight: 650;
  font-size: 0.85rem;
  text-transform: capitalize;
}
.date-chip.selected {
  background: var(--ink);
  color: #fff8ef;
  border-color: transparent;
}
.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 0.5rem;
}
.slot {
  border: 1px solid var(--line);
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 0.7rem 0.4rem;
  font-weight: 700;
}
.slot.selected {
  background: var(--accent);
  color: white;
  border-color: transparent;
}
.summary {
  display: grid;
  gap: 0.65rem;
  padding: 0.9rem 1rem;
  border-radius: 14px;
  background: var(--accent-soft);
}
.summary div { display: flex; justify-content: space-between; gap: 1rem; }
.summary span { color: var(--ink-muted); font-size: 0.9rem; }
.consent {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  font-size: 0.9rem;
  color: var(--ink-muted);
  line-height: 1.4;
}
.consent input { margin-top: 0.2rem; }
`
