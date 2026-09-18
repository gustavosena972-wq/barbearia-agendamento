import { encode as encodeBase64Url } from './base64url'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function enablePushNotifications(usuarioId: string): Promise<string> {
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!vapid) {
    return 'Defina VITE_VAPID_PUBLIC_KEY no .env para ativar push. O sino do painel já funciona sem isso.'
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'Este navegador não suporta Web Push.'
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return 'Permissão negada. No iPhone: Adicionar à Tela de Início (iOS 16.4+) e tentar de novo.'
  }

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
  })

  const json = sub.toJSON()
  const { supabase } = await import('./supabase')

  const { error } = await supabase.from('dispositivos_push').upsert(
    {
      usuario_id: usuarioId,
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh!,
      auth: json.keys!.auth!,
      user_agent: navigator.userAgent.slice(0, 240),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )

  if (error) {
    console.error(error)
    return 'Não foi possível salvar o dispositivo.'
  }

  void encodeBase64Url
  return 'Notificações ativadas neste aparelho.'
}
