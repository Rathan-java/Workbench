import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import CssBaseline from '@mui/material/CssBaseline';
import { SnackbarProvider } from 'notistack';
import { BrowserRouter } from 'react-router-dom';
import { ThemeModeProvider } from './theme/ThemeModeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ConfirmProvider } from './components/common/ConfirmDialog.jsx';
import AppRouter from './routes/AppRouter.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a 4xx: a 403 or a 422 will fail identically forever, and
        // retrying a 401 races the token refresh the interceptor already owns.
        const status = error?.status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <CssBaseline />
        <SnackbarProvider
          maxSnack={3}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          autoHideDuration={4000}
          preventDuplicate
        >
          <BrowserRouter>
            <AuthProvider>
              <ConfirmProvider>
                <AppRouter />
              </ConfirmProvider>
            </AuthProvider>
          </BrowserRouter>
        </SnackbarProvider>
      </ThemeModeProvider>

      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />}
    </QueryClientProvider>
  );
}
