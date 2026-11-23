import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled React error caught by boundary:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    localStorage.removeItem('tg_token');
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen flex items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-primary)] p-6 font-sans">
          <div className="max-w-md w-full luxury-surface rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-[#FF453A]/10 text-[var(--status-alert)] rounded-xl flex items-center justify-center mx-auto mb-5 border border-[#FF453A]/20">
              <AlertTriangle size={22} strokeWidth={1.75} />
            </div>
            <h2 className="text-[18px] font-medium mb-2 tracking-[-0.025em]">
              Application Encountered an Error
            </h2>
            <p className="text-[13px] text-[var(--text-secondary)] mb-6 leading-relaxed">
              A runtime component error occurred. You can reload the page or reset the application session.
            </p>
            {this.state.error && (
              <div className="text-left bg-[var(--bg-elevated)] border border-[var(--border-hairline)] rounded-xl p-3 mb-6 font-mono text-[12px] text-[var(--status-alert)] overflow-x-auto">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div className="flex gap-2.5">
              <button
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 h-10 px-4 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-fg)] font-medium rounded-lg text-[13px] transition-colors cursor-pointer"
              >
                <RefreshCw size={14} strokeWidth={1.75} /> Reload
              </button>
              <button
                onClick={this.handleReset}
                className="h-10 px-4 bg-transparent hover:bg-[var(--bg-hover)] border border-[var(--border-hairline)] text-[var(--text-primary)] font-medium rounded-lg text-[13px] transition-colors cursor-pointer"
              >
                Reset Session
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
