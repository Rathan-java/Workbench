import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { Link as RouterLink } from 'react-router-dom';

/**
 * @param {object}   props
 * @param {string}   props.title
 * @param {string}  [props.subtitle]
 * @param {Array<{label: string, to?: string}>} [props.breadcrumbs] — the last item renders as plain text.
 * @param {React.ReactNode} [props.actions] — right-aligned slot.
 */
export default function PageHeader({ title, subtitle, breadcrumbs, actions, sx }) {
  return (
    <Box sx={{ mb: 3, ...sx }}>
      {breadcrumbs?.length > 0 && (
        <Breadcrumbs
          separator={<NavigateNextIcon sx={{ fontSize: 16 }} />}
          sx={{ mb: 1, '& .MuiBreadcrumbs-separator': { mx: 0.5 } }}
        >
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;

            return isLast || !crumb.to ? (
              <Typography key={crumb.label} variant="caption" color="text.secondary">
                {crumb.label}
              </Typography>
            ) : (
              <Link
                key={crumb.label}
                component={RouterLink}
                to={crumb.to}
                variant="caption"
                underline="hover"
                color="text.secondary"
                sx={{ '&:hover': { color: 'text.primary' } }}
              >
                {crumb.label}
              </Link>
            );
          })}
        </Breadcrumbs>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" noWrap>
            {title}
          </Typography>

          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>

        {actions && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
