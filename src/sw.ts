/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

declare let self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
clientsClaim()

self.addEventListener('push', (event) => {
  let title = 'Barbearia'
  let body = 'Nova atualização na agenda'
  let url = '/painel'
  try {
    const data = event.data?.json() as { title?: string; body?: string; url?: string }
    if (data?.title) title = data.title
    if (data?.body) body = data.body
    if (data?.url) url = data.url
  } catch {
    const text = event.data?.text()
    if (text) body = text
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data?.url as string) || '/painel'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          void client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
