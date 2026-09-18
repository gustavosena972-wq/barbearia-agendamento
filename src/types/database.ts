export type Papel = 'dono' | 'barbeiro'

export type AgendamentoStatus =
  | 'aguardando'
  | 'confirmado'
  | 'reagendado'
  | 'cancelado'
  | 'precisa_atencao'
  | 'concluido'

export type Origem = 'pagina' | 'manual' | 'ia'

export interface Barbearia {
  id: string
  nome: string
  telefone: string | null
  endereco: string | null
  logo_url: string | null
  exibir_precos: boolean
  setup_completo: boolean
  lembrete_horas_antes: number
  regra_sem_resposta: string
  canal_mensagens?: 'simulacao' | 'whatsapp'
}

export interface Usuario {
  id: string
  auth_user_id: string
  nome: string
  email: string
  papel: Papel
  barbeiro_id: string | null
  ativo: boolean
}

export interface Barbeiro {
  id: string
  nome: string
  foto_url: string | null
  ativo: boolean
  ordem: number
}

export interface Servico {
  id: string
  nome: string
  duracao_min: number
  preco: number
  ativo: boolean
  ordem: number
}

export interface HorarioTrabalho {
  id: string
  barbeiro_id: string
  dia_semana: number
  inicio: string
  fim: string
  almoco_inicio: string | null
  almoco_fim: string | null
}

export interface Bloqueio {
  id: string
  barbeiro_id: string
  inicio: string
  fim: string
  motivo: string
}

export interface Cliente {
  id: string
  nome: string
  telefone: string
  consentimento_mensagens: boolean
  consentimento_em: string | null
}

export interface Agendamento {
  id: string
  cliente_id: string
  barbeiro_id: string
  servico_id: string
  inicio: string
  fim: string
  status: AgendamentoStatus
  origem: Origem
  horario_anterior_inicio: string | null
  horario_anterior_fim: string | null
  notas: string | null
  created_at: string
  cliente?: Cliente
  barbeiro?: Barbeiro
  servico?: Servico
}

export interface Notificacao {
  id: string
  usuario_id: string
  tipo: string
  titulo: string
  texto: string
  agendamento_id: string | null
  lida: boolean
  created_at: string
}

export interface CatalogoPublico {
  ready: boolean
  barbearia?: {
    nome: string
    telefone: string | null
    endereco: string | null
    exibir_precos: boolean
    setup_completo: boolean
  }
  barbeiros?: Array<{
    id: string
    nome: string
    foto_url: string | null
    servico_ids: string[]
  }>
  servicos?: Array<{
    id: string
    nome: string
    duracao_min: number
    preco: number
  }>
}

export interface Slot {
  inicio: string
  fim: string
}
