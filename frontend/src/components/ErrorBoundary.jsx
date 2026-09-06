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
        <div className="w-screen h-screen flex items-center justify-center bg-zinc-950 text-white p-6 font-sans">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl text-center">
            <div className="w-14 h-14 bg-red-500/10 text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/20">
              <AlertTriangle size={28} />
            </div>
            <h2 className="text-xl font-bold mb-2 tracking-tight">Application Encountered an Error</h2>
            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
              A runtime component error occurred. You can reload the page or reset the application session.
            </p>
            {this.state.error && (
              <div className="text-left bg-zinc-950 border border-zinc-800/80 rounded-xl p-3 mb-6 font-mono text-xs text-red-400/90 overflow-x-auto">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-colors shadow-lg shadow-indigo-600/20"
              >
                <RefreshCw size={15} /> Reload
              </button>
              <button
                onClick={this.handleReset}
                className="py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold rounded-xl text-sm transition-colors"
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
