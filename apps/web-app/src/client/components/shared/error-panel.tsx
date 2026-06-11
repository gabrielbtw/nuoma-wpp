export function ErrorPanel({ message }: { message: string }) {
  return <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{message}</div>;
}
