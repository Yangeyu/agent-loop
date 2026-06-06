export function Header({ onNewChat }: { onNewChat: () => void }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b border-zinc-50 backdrop-blur-md bg-white/70 sticky top-0 z-50">
      <div className="flex items-center gap-2.5">
        <div className="h-6 w-6 bg-[#171717] rounded-lg shadow-sm flex items-center justify-center">
          <div className="h-2 w-2 bg-white rounded-full animate-pulse" />
        </div>
        <span className="text-sm font-bold tracking-tight text-[#171717] uppercase tracking-[0.1em]">Agentic Loop</span>
      </div>
      <button
        onClick={onNewChat}
        className="rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-900 transition-all border border-zinc-100 cursor-pointer"
      >
        New Chat
      </button>
    </header>
  )
}
