import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import DashboardPage from '@/pages/dashboard';
import AllSignalsPage from '@/pages/all-signals';
import CandidatesPage from '@/pages/candidates';
import CandidateDetailPage from '@/pages/candidate-detail';
import SignalDetailPage from '@/pages/signal-detail';
import NotFound from '@/pages/not-found';
import { Layout } from '@/components/layout';
import { Toaster } from '@workspace/weme-earth-tones-system/components/ui/toaster';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/signals" component={AllSignalsPage} />
        <Route path="/candidates" component={CandidatesPage} />
        <Route path="/candidates/:id" component={CandidateDetailPage} />
        <Route path="/signals/:id" component={SignalDetailPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
        <Toaster />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
