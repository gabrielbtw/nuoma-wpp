import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  scope?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro capturado pelo ErrorBoundary", error, info);
  }

  override componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const detail = this.state.error.stack || this.state.error.message;

    return (
      <div className="grid min-h-[48vh] place-items-center bg-surface-0 px-4 py-10 text-ink-strong">
        <section className="w-full max-w-xl rounded-lg border border-line-hairline bg-surface-1 p-6 shadow-flat">
          <div className="font-mono text-[0.68rem] uppercase text-status-error">
            Falha na interface
          </div>
          <h1 className="mt-3 font-display text-2xl font-semibold text-ink-strong">
            Não foi possível renderizar esta área.
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-base">
            Recarregue a aplicação. Se o erro continuar, envie o detalhe técnico para análise.
          </p>
          {this.props.scope && (
            <p className="mt-3 font-mono text-xs text-ink-soft">Escopo: {this.props.scope}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
            >
              Recarregar
            </button>
          </div>
          <details className="mt-5 rounded-md border border-line-hairline bg-surface-deep p-3">
            <summary className="cursor-pointer font-mono text-xs text-ink-soft">
              Detalhe técnico
            </summary>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink-base">
              {detail}
            </pre>
          </details>
        </section>
      </div>
    );
  }
}
