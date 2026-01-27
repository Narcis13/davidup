import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ApiStatus = 'loading' | 'connected' | 'error'

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('loading')
  const [dbStatus, setDbStatus] = useState<string>('')

  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const res = await fetch('/studio/health')
        if (res.ok) {
          const data = await res.json()
          setApiStatus('connected')
          setDbStatus(data.db || 'unknown')
        } else {
          setApiStatus('error')
        }
      } catch {
        setApiStatus('error')
      }
    }
    checkApiHealth()
  }, [])

  const statusConfig = {
    loading: { text: 'Checking...', color: 'text-yellow-400', bgColor: 'bg-yellow-400' },
    connected: { text: 'Connected', color: 'text-green-400', bgColor: 'bg-green-400' },
    error: { text: 'Error', color: 'text-red-400', bgColor: 'bg-red-400' },
  }

  const status = statusConfig[apiStatus]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
            GameMotion Studio
          </h1>
          <p className="text-slate-400 text-lg">
            AI-assisted video creation for game highlights
          </p>
        </div>

        <div className={cn(
          "bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4",
          "shadow-lg shadow-slate-900/50"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-medium">API Status</span>
            <span className={cn("flex items-center gap-2", status.color)}>
              <span className={cn("w-2 h-2 rounded-full", status.bgColor, apiStatus === 'loading' && "animate-pulse")} />
              {status.text}
            </span>
          </div>

          <div className="border-t border-slate-800 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Backend</span>
              <span className="text-slate-400 font-mono">localhost:3000</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Frontend</span>
              <span className="text-slate-400 font-mono">localhost:5173</span>
            </div>
            {dbStatus && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Database</span>
                <span className="text-slate-400 font-mono">{dbStatus}</span>
              </div>
            )}
          </div>

          <Button
            className="w-full"
            variant="default"
            onClick={() => {
              setApiStatus('loading')
              fetch('/studio/health')
                .then(res => res.ok ? res.json() : Promise.reject())
                .then(data => {
                  setApiStatus('connected')
                  setDbStatus(data.db || 'unknown')
                })
                .catch(() => setApiStatus('error'))
            }}
          >
            Refresh Status
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">0</div>
            <div className="text-sm text-slate-500">Conversations</div>
          </div>
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 text-center">
            <div className="text-2xl font-bold text-violet-400">0</div>
            <div className="text-sm text-slate-500">Templates</div>
          </div>
          <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 text-center">
            <div className="text-2xl font-bold text-green-400">0</div>
            <div className="text-sm text-slate-500">Videos</div>
          </div>
        </div>

        <div className="text-center text-sm text-slate-500">
          Proxy configured for /studio, /render, /generate, /templates, /health
        </div>
      </div>
    </div>
  )
}

export default App
