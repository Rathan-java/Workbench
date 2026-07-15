import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

const DEFAULTS = {
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  destructive: false,
};

/** Controlled dialog. Most callers want `useConfirm()` instead. */
export function ConfirmDialog({
  open,
  title = DEFAULTS.title,
  message = DEFAULTS.message,
  confirmLabel = DEFAULTS.confirmLabel,
  cancelLabel = DEFAULTS.cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-dialog-title"
    >
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>

      {message && (
        <DialogContent>
          <DialogContentText variant="body2" color="text.secondary">
            {message}
          </DialogContentText>
        </DialogContent>
      )}

      <DialogActions>
        <Button onClick={onCancel} disabled={loading} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ConfirmContext = createContext(null);

/**
 * Promise-based confirmation.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Deactivate user?', destructive: true })) { ... }
 *
 * The resolver is parked in a ref and settled by the button handlers, which
 * turns a callback-shaped dialog into something you can simply `await` inline.
 */
export function ConfirmProvider({ children }) {
  const [options, setOptions] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((config = {}) => {
    setOptions({ ...DEFAULTS, ...config });
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={options !== null}
        {...(options ?? {})}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context.confirm;
}

export default ConfirmDialog;
