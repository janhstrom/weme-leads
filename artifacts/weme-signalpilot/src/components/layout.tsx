import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Inbox, LayoutDashboard, Settings, ListFilter, Radar } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();

  const isDashboard = location === "/";
  const isSignals = location.startsWith("/signals");

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 lg:w-64 border-r border-border bg-card flex flex-col items-center lg:items-stretch py-4 z-10 shrink-0">
        <div className="px-0 lg:px-4 mb-8 flex items-center justify-center lg:justify-start gap-3">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
            <Radar className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg hidden lg:inline-block tracking-tight">Signalpilot</span>
        </div>

        <nav className="flex-1 flex flex-col gap-2 px-2">
          <Link
            href="/"
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isDashboard ? 'bg-secondary text-secondary-foreground font-medium' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}`}
          >
            <Inbox className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline-block text-sm">Inbox</span>
          </Link>
          <Link
            href="/"
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSignals ? 'bg-secondary/50 text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}`}
          >
            <ListFilter className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline-block text-sm">All signals</span>
          </Link>
        </nav>

        <div className="mt-auto px-2 flex flex-col gap-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-secondary/50 hover:text-foreground cursor-not-allowed opacity-50">
             <Settings className="w-5 h-5 shrink-0" />
             <span className="hidden lg:inline-block text-sm">Settings</span>
          </div>
          <div className="px-3 py-2 flex items-center gap-3 text-xs text-muted-foreground mt-2 border-t border-border pt-4">
            <Activity className={`w-4 h-4 ${health?.status === 'ok' ? 'text-green-500' : 'text-destructive'}`} />
            <span className="hidden lg:inline-block">System {health?.status === 'ok' ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
