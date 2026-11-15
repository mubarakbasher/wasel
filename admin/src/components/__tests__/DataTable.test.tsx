import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataTable, { type Column } from '../DataTable';

interface Row {
  id: string;
  name: string;
  cards: number | null;
  note: string;
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha', cards: 12, note: 'first' },
  { id: 'b', name: 'Beta', cards: null, note: 'second' },
];

// The shape every existing page passes: key + header, sometimes a renderer.
const plainColumns: Column<Row>[] = [
  { key: 'name', header: 'Name' },
  { key: 'cards', header: 'Cards', render: (r) => (r.cards === null ? '—' : String(r.cards)) },
];

const sortableColumns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortValue: (r) => r.name },
  {
    key: 'cards',
    header: 'Cards',
    align: 'right',
    sortValue: (r) => r.cards,
    render: (r) => (r.cards === null ? '—' : String(r.cards)),
  },
  { key: 'note', header: 'Note' },
];

const paging = { total: 2, page: 1, limit: 20, onPageChange: () => {} };

describe('DataTable', () => {
  it('DataTable: clicking a sortable header calls onSortChange and sets aria-sort', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={sortableColumns}
        data={rows}
        {...paging}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    );

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    const cardsHeader = screen.getByRole('columnheader', { name: /Cards/ });
    const noteHeader = screen.getByRole('columnheader', { name: 'Note' });

    // Only the sorted column announces a direction.
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(cardsHeader).not.toHaveAttribute('aria-sort');
    // A column without sortValue stays a plain header.
    expect(noteHeader).not.toHaveAttribute('aria-sort');
    expect(within(noteHeader).queryByRole('button')).not.toBeInTheDocument();

    // A new column starts ascending.
    await user.click(within(cardsHeader).getByRole('button', { name: /Cards/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'cards', dir: 'asc' });

    // The active column flips direction.
    await user.click(within(nameHeader).getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', dir: 'desc' });
    expect(onSortChange).toHaveBeenCalledTimes(2);
  });

  it('shows the descending direction of the active column', () => {
    render(
      <DataTable
        columns={sortableColumns}
        data={rows}
        {...paging}
        sort={{ key: 'cards', dir: 'desc' }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Cards/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: /Name/ })).not.toHaveAttribute('aria-sort');
  });

  it('does not reorder rows itself: the caller sorts', () => {
    render(
      <DataTable
        columns={sortableColumns}
        data={rows}
        {...paging}
        sort={{ key: 'name', dir: 'desc' }}
        onSortChange={() => {}}
      />,
    );
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(within(bodyRows[0]).getByText('Alpha')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('Beta')).toBeInTheDocument();
  });

  it('DataTable: renders unchanged when no sort props are passed', () => {
    render(<DataTable columns={plainColumns} data={rows} {...paging} />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Name', 'Cards']);
    for (const header of headers) {
      expect(header).not.toHaveAttribute('aria-sort');
      expect(within(header).queryByRole('button')).not.toBeInTheDocument();
      expect(header).toHaveClass('text-left');
    }

    // Cells: the raw value by key, or the renderer.
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();

    // Pagination footer as before.
    expect(screen.getByText('Showing 1 to 2 of 2 results')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('a sortable column without onSortChange stays a plain header', () => {
    render(<DataTable columns={sortableColumns} data={rows} {...paging} />);
    const header = screen.getByRole('columnheader', { name: 'Name' });
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
    expect(header).not.toHaveAttribute('aria-sort');
  });

  it('keeps the default empty text, and takes emptyMessage when given', () => {
    const { rerender } = render(<DataTable columns={plainColumns} data={[]} {...paging} total={0} />);
    expect(screen.getByText('No data available.')).toBeInTheDocument();

    rerender(
      <DataTable
        columns={plainColumns}
        data={[]}
        {...paging}
        total={0}
        emptyMessage="No operators match this filter"
      />,
    );
    expect(screen.getByText('No operators match this filter')).toBeInTheDocument();
    expect(screen.queryByText('No data available.')).not.toBeInTheDocument();
  });

  it('shows an empty result exactly as the pages that had the table before sorting did', () => {
    // What Users, Payments, Subscriptions, Audit Logs and the rest pass: no sort, no message.
    const { container } = render(
      <DataTable columns={plainColumns} data={[]} {...paging} total={0} />,
    );

    // The markup of the component before it learned to sort: the message in a
    // padded panel, in place of the table and of its footer.
    expect(container.innerHTML).toBe(
      '<div class="bg-white rounded-xl border border-slate-200 p-12 text-center">' +
        '<p class="text-slate-400 text-sm">No data available.</p>' +
        '</div>',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });

  it('keeps the footer, with both buttons disabled, for a result of one page', () => {
    const onPageChange = vi.fn();
    render(
      <DataTable columns={plainColumns} data={[rows[0]]} {...paging} total={1} onPageChange={onPageChange} />,
    );

    expect(screen.getByText('Showing 1 to 1 of 1 results')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('pages with Previous and Next, each disabled at its end', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const props = { columns: plainColumns, data: rows, total: 45, limit: 20, onPageChange };
    const { rerender } = render(<DataTable {...props} page={1} />);

    expect(screen.getByText('Showing 1 to 20 of 45 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    rerender(<DataTable {...props} page={3} />);
    expect(screen.getByText('Showing 41 to 45 of 45 results')).toBeInTheDocument();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it('align right applies to the header and its cells', () => {
    render(
      <DataTable
        columns={sortableColumns}
        data={rows}
        {...paging}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Cards/ })).toHaveClass('text-right');
    expect(screen.getByText('12').closest('td')).toHaveClass('text-right');
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveClass('text-left');
    expect(screen.getByText('Alpha').closest('td')).not.toHaveClass('text-right');
  });

  it('rowKey keeps a row attached to its record when the order changes', () => {
    const props = { columns: plainColumns, ...paging, rowKey: (r: Row) => r.id };
    const { rerender } = render(<DataTable {...props} data={rows} />);
    const alphaRow = screen.getByText('Alpha').closest('tr');

    rerender(<DataTable {...props} data={[rows[1], rows[0]]} />);
    expect(screen.getByText('Alpha').closest('tr')).toBe(alphaRow);
    expect(screen.getAllByRole('row')[2]).toBe(alphaRow);
  });

  it('keeps the sortable headers while loading', () => {
    render(
      <DataTable
        columns={sortableColumns}
        data={[]}
        {...paging}
        isLoading
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.queryByText('No data available.')).not.toBeInTheDocument();
  });
});
