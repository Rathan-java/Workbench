import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import EmptyState from './EmptyState.jsx';
import { PAGE_SIZE_OPTIONS } from '../../utils/constants.js';

/**
 * Server-side table. It owns no data: page/sort state lives with the caller and
 * every change is reported upward, because the server does the paging, sorting
 * and filtering (see the backend's listUsersQuerySchema et al).
 *
 * @param {object} props
 * @param {Array<{id, label, render?, sortable?, align?, width?}>} props.columns
 * @param {Array<object>} props.rows
 * @param {number} props.total       — meta.pagination.total, NOT rows.length
 * @param {number} props.page        — 1-based, matching the API
 * @param {'asc'|'desc'} props.sortOrder
 */
export default function DataTable({
  columns = [],
  rows = [],
  loading = false,
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortOrder = 'asc',
  onSortChange,
  emptyMessage = 'No records match your filters.',
  emptyTitle = 'No results',
  onRowClick,
  dense = false,
  getRowId = (row, index) => row?.id ?? index,
  stickyHeader = true,
  maxHeight,
}) {
  const handleSort = (column) => {
    if (!column.sortable || !onSortChange) return;
    const isActive = sortBy === column.id;
    onSortChange(column.id, isActive && sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const isEmpty = !loading && rows.length === 0;

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <TableContainer sx={{ maxHeight }}>
        <Table stickyHeader={stickyHeader} size={dense ? 'small' : 'medium'}>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align ?? 'left'}
                  sx={{ width: column.width, minWidth: column.width }}
                  sortDirection={sortBy === column.id ? sortOrder : false}
                >
                  {column.sortable && onSortChange ? (
                    <TableSortLabel
                      active={sortBy === column.id}
                      direction={sortBy === column.id ? sortOrder : 'asc'}
                      onClick={() => handleSort(column)}
                    >
                      {column.label}
                    </TableSortLabel>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {loading &&
              // A skeleton in the table's real shape, not a spinner: the layout
              // doesn't jump when the data lands.
              Array.from({ length: Math.min(pageSize, 8) }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((column) => (
                    <TableCell key={column.id} align={column.align ?? 'left'}>
                      <Skeleton
                        variant="text"
                        width={column.align === 'right' ? '40%' : `${60 + ((rowIndex * 13) % 35)}%`}
                        sx={{
                          fontSize: '0.8125rem',
                          ml: column.align === 'right' ? 'auto' : 0,
                          mx: column.align === 'center' ? 'auto' : undefined,
                        }}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {isEmpty && (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ borderBottom: 0, py: 0 }}>
                  <EmptyState
                    icon={SearchOffOutlinedIcon}
                    title={emptyTitle}
                    message={emptyMessage}
                  />
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              rows.map((row, rowIndex) => (
                <TableRow
                  key={getRowId(row, rowIndex)}
                  hover={Boolean(onRowClick)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} align={column.align ?? 'left'}>
                      {column.render ? column.render(row, rowIndex) : nullish(row[column.id])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* MUI's pagination is 0-based; the API is 1-based. Convert at the boundary. */}
      <TablePagination
        component="div"
        count={total}
        page={total > 0 ? Math.max(0, page - 1) : 0}
        rowsPerPage={pageSize}
        rowsPerPageOptions={PAGE_SIZE_OPTIONS}
        onPageChange={(_event, nextPage) => onPageChange?.(nextPage + 1)}
        onRowsPerPageChange={(event) => {
          const nextSize = parseInt(event.target.value, 10);
          onPageSizeChange?.(nextSize);
          // A bigger page can put the current page past the end of the result set.
          onPageChange?.(1);
        }}
        labelRowsPerPage="Rows:"
        showFirstButton
        showLastButton
      />
    </Paper>
  );
}

/** Renders a dash rather than an empty cell, so a blank column reads as intentional. */
const nullish = (value) =>
  value === null || value === undefined || value === '' ? (
    <Box component="span" sx={{ color: 'text.disabled' }}>
      —
    </Box>
  ) : (
    value
  );
