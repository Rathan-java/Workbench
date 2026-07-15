import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

import EmptyState from '../../../components/common/EmptyState.jsx';
import ErrorState from '../../../components/common/ErrorState.jsx';

/**
 * A titled panel with one consistent header, and the three states every panel
 * on this page has to be able to be: loading, failed, and genuinely empty.
 *
 * Empty is a first-class state, not an afterthought — an axis with no series on
 * it looks like a bug, and a chart drawn from zero rows looks like a claim that
 * the work didn't happen.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {React.ReactNode} [props.action]  — right-aligned header slot.
 * @param {number|string} [props.height]    — the plot area; the header sits above it.
 * @param {boolean} [props.loading]
 * @param {unknown} [props.error]
 * @param {() => void} [props.onRetry]
 * @param {boolean} [props.isEmpty]
 * @param {string} [props.emptyMessage]
 */
export default function ChartCard({
  title,
  subtitle,
  action,
  height = 280,
  loading = false,
  error,
  onRetry,
  isEmpty = false,
  emptyTitle = 'No data for this range',
  emptyMessage,
  children,
  sx,
}) {
  const body = () => {
    if (loading) return <Skeleton variant="rounded" width="100%" height="100%" />;
    if (error) return <ErrorState dense error={error} onRetry={onRetry} sx={{ py: 0, height: '100%' }} />;
    if (isEmpty) return <EmptyState dense title={emptyTitle} message={emptyMessage} sx={{ py: 0, height: '100%' }} />;
    return children;
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 2, height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h2" noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {subtitle}
            </Typography>
          )}
        </Box>

        {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Stack>

      <Box sx={{ height, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {body()}
      </Box>
    </Paper>
  );
}
