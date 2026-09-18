import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import type { Usuario } from '../types/database'

interface AuthState {
  session: Session | null
  usuario: Usuario | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  refreshUsuario: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function fetchUsuario(userId: string): Promise<Usuario | null> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_user_id', userId)
    .eq('ativo', true)
    .maybeSingle()
  if (error) {
    console.error(error)
    return null
  }
  return data as Usuario | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUsuario = useCallback(async () => {
    const uid = (await supabase.auth.getUser()).data.user?.id
    if (!uid) {
      setUsuario(null)
      return
    }
    setUsuario(await fetchUsuario(uid))
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) {
        setUsuario(await fetchUsuario(data.session.user.id))
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next?.user) {
        void fetchUsuario(next.user.id).then(setUsuario)
      } else {
        setUsuario(null)
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      if (error.message.toLowerCase().includes('invalid')) {
        return 'E-mail ou senha incorretos.'
      }
      return 'Não foi possível entrar. Tente de novo.'
    }
    await refreshUsuario()
    return null
  }, [refreshUsuario])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUsuario(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      usuario,
      loading,
      configured: supabaseConfigured,
      signIn,
      signOut,
      refreshUsuario,
    }),
    [session, usuario, loading, signIn, signOut, refreshUsuario],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
