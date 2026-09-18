import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function moneyBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDateLong(iso: string): string {
  return format(parseISO(iso), "EEEE, d 'de' MMMM", { locale: ptBR })
}

export function formatDateShort(iso: string): string {
  return format(parseISO(iso), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatTime(iso: string): string {
  return format(parseISO(iso), 'HH:mm', { locale: ptBR })
}

export function formatDateTime(iso: string): string {
  return format(parseISO(iso), "dd/MM 'às' HH:mm", { locale: ptBR })
}

export function mapRpcError(message: string): string {
  const code = message.replace(/^.*P0001:\s*/i, '').trim()
  const map: Record<string, string> = {
    CONSENTIMENTO_OBRIGATORIO: 'Aceite receber mensagens para concluir o agendamento.',
    NOME_INVALIDO: 'Informe um nome válido (2 a 80 caracteres).',
    TELEFONE_INVALIDO: 'Telefone inválido. Use DDD + número.',
    RATE_LIMIT: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    HORARIO_PASSADO: 'Esse horário já passou. Escolha outro.',
    SERVICO_INVALIDO: 'Serviço indisponível.',
    HORARIO_INDISPONIVEL: 'Esse horário acabou de ser reservado. Escolha outro.',
    TOKEN_INVALIDO: 'Link inválido ou expirado.',
    JA_CANCELADO: 'Este agendamento já foi cancelado.',
    ACAO_INVALIDA: 'Ação inválida.',
    NOVO_HORARIO_OBRIGATORIO: 'Escolha o novo horário.',
  }
  for (const [k, v] of Object.entries(map)) {
    if (message.includes(k) || code.includes(k)) return v
  }
  return 'Não foi possível concluir. Tente novamente.'
}

export const DIAS_SEMANA = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const

export const STATUS_LABEL: Record<string, string> = {
  aguardando: 'Aguardando',
  confirmado: 'Confirmado',
  reagendado: 'Reagendado',
  cancelado: 'Cancelado',
  precisa_atencao: 'Precisa de atenção',
  concluido: 'Concluído',
}
