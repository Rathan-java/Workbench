import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import CheckIcon from '@mui/icons-material/CheckRounded';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';

/**
 * Shown exactly once, because the server hands the temporary password back
 * exactly once: it is hashed on write and is not retrievable afterwards. Closing
 * this dialog without copying it means the admin has to run another reset.
 */
export default function TemporaryPasswordDialog({ open, onClose, password, email, title = 'Temporary password' }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API needs a secure context; select-and-copy still works.
      setCopied(false);
    }
  };

  const handleClose = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <KeyIcon fontSize="small" color="primary" />
          <span>{title}</span>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This password is shown <strong>once</strong> and cannot be retrieved again. Copy it now and
          hand it over securely. The user must change it at their next sign-in.
        </Alert>

        {email && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Account: <strong>{email}</strong>
          </Typography>
        )}

        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            p: 1.5,
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Box
            component="code"
            sx={{
              flex: 1,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '1rem',
              letterSpacing: '0.04em',
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {password}
          </Box>

          <Tooltip title={copied ? 'Copied' : 'Copy to clipboard'}>
            <IconButton onClick={copy} color={copied ? 'success' : 'default'} aria-label="Copy password">
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} variant="contained">
          I&apos;ve copied it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
