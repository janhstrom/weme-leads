import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: any },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; resetKey?: any }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: { resetKey?: any }) {
    if (prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
          <div className="bg-destructive/10 text-destructive p-4 rounded-xl max-w-md w-full">
            <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
            <p className="text-sm font-mono text-left bg-background p-2 rounded border border-destructive/20 overflow-auto">
              {this.state.error?.message}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
