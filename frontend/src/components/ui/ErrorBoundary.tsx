'use client';
import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props { children: ReactNode; t?: (key: string) => string; }
interface State { hasError: boolean; error: Error | null; }

class ErrorBoundaryInner extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-screen bg-dark-bg text-white p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-600/20 flex items-center justify-center">
              <span className="text-3xl">⚠️</span>
            </div>
            <h2 className="text-xl font-bold">{this.props.t?.('errorBoundary.title') ?? 'Something went wrong'}</h2>
            <p className="text-sm text-gray-400 font-mono bg-white/5 p-3 rounded-xl text-left overflow-auto max-h-32">
              {this.state.error?.message || this.props.t?.('errorBoundary.unknown') ?? 'Unknown error'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="btn-primary"
            >
              {this.props.t?.('errorBoundary.reload') ?? 'Reload'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary(props: Props) {
  const { t } = useTranslation();
  return <ErrorBoundaryInner {...props} t={t} />;
}
