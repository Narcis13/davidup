import { cn } from '@/lib/utils'

function App() {
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
            <span className="flex items-center gap-2 text-yellow-400">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              Checking...
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
