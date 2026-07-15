import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export default function EmptyState({
  icon: Icon = InboxOutlinedIcon,
  title = 'Nothing here yet',
  message,
  action,
  actionLabel,
  onAction,
  dense = false,
  sx,
}) {
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
          bgcolor: 'action.hover',
          color: 'text.secondary',
          mb: 0.5,
        }}
      >
        <Icon fontSize="small" />
      </Box>

      <Typography variant="subtitle2" color="text.primary">
        {title}
      </Typography>

      {message && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {message}
        </Typography>
      )}

      {action ??
        (actionLabel && onAction ? (
          <Button size="small" variant="outlined" onClick={onAction} sx={{ mt: 1.5 }}>
            {actionLabel}
          </Button>
        ) : null)}
    </Box>
  );
}
