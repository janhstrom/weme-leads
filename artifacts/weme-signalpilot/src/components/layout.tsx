import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Inbox, Settings, ListFilter, Radar, UsersRound, FileSearch } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();

  const isDashboard = location === "/";
  const isSignals = location.startsWith("/signals");
  const isEventMapping = location.startsWith("/event-mapping");
  const isCandidates = location.startsWith("/candidates");

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 lg:w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col items-center lg:items-stretch py-4 z-10 shrink-0">
        <div className="px-0 lg:px-4 mb-8 flex items-center justify-center lg:justify-start gap-3">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
            <Radar className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg hidden lg:inline-block tracking-tight">WeMe Leads</span>
        </div>

        <nav className="flex-1 flex flex-col gap-2 px-2">
          <Link
            href="/"
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isDashboard ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
          >
            <Inbox className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline-block text-sm">Inbox</span>
          </Link>
          <Link
            href="/signals"
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSignals ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
          >
            <ListFilter className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline-block text-sm">Alle signaler</span>
          </Link>
          <Link
            href="/event-mapping"
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isEventMapping ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
          >
            <FileSearch className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline-block text-sm">Kartlegging</span>
          </Link>
          <Link
            href="/candidates"
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isCandidates ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
          >
            <UsersRound className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline-block text-sm">Kandidater</span>
          </Link>
        </nav>

        <div className="mt-auto px-2 flex flex-col gap-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground cursor-not-allowed opacity-50">
             <Settings className="w-5 h-5 shrink-0" />
             <span className="hidden lg:inline-block text-sm">Settings</span>
          </div>
          <div className="px-3 py-2 flex items-center gap-3 text-xs text-muted-foreground mt-2 border-t border-border pt-4">
            <Activity className={`w-4 h-4 ${health?.status === 'ok' ? 'text-chart-2' : 'text-destructive'}`} />
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
