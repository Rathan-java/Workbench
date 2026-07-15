import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * Renders a thrown ApiError (or anything with a message). The correlationId is
 * shown deliberately — it is the one string a user can read out that lets
 * someone find the exact request in the server logs.
 */
export default function ErrorState({
  error,
  title = 'Something went wrong',
  message,
  onRetry,
  dense = false,
  sx,
}) {
  const description =
    message ?? error?.message ?? 'The request failed. Please try again in a moment.';
  const correlationId = error?.correlationId;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1,
        px: 3,
        py: dense ? 4 : 8,
        ...sx,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 48,
          height: 48,
          borderRadius: '50%',
          bgcolor: (theme) => theme.palette.error.main + '1A',
          color: 'error.main',
          mb: 0.5,
        }}
      >
        <ErrorOutlineIcon fontSize="small" />
      </Box>

      <Typography variant="subtitle2" color="text.primary">
        {title}
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {description}
      </Typography>

      {correlationId && (
        <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
          Ref: {correlationId}
        </Typography>
      )}

      {onRetry && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
          sx={{ mt: 1.5 }}
        >
          Try again
        </Button>
      )}
    </Box>
  );
}
