import type { DetailState } from "../types"

export function DetailDrawer({ 
  detail,
  onClose 
}: { 
  detail: DetailState,
  onClose: () => void 
}) {
  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl animate-in slide-in-from-right duration-300 p-8 flex flex-col border-l border-zinc-50">
        <div className="flex items-center justify-between mb-10">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D4AF37]">{detail.label}</span>
            <span className="text-[12px] text-zinc-400 font-medium mt-1">{detail.title}</span>
            {detail.subtitle ? <span className="text-[11px] text-zinc-400 mt-2 break-all">{detail.subtitle}</span> : null}
          </div>
          <button onClick={onClose} className="h-10 w-10 flex items-center justify-center rounded-full bg-zinc-50 text-zinc-400 hover:text-zinc-900 transition-colors cursor-pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pr-2">
          {detail.loading ? (
            <p className="text-[16px] leading-relaxed text-zinc-400 font-light whitespace-pre-wrap">Loading...</p>
          ) : detail.error ? (
            <p className="text-[16px] leading-relaxed text-red-500 whitespace-pre-wrap">{detail.error}</p>
          ) : (
            <p className="text-[16px] leading-relaxed text-zinc-600 font-light whitespace-pre-wrap">{detail.content}</p>
          )}
        </div>
      </div>
    </div>
  )
}
