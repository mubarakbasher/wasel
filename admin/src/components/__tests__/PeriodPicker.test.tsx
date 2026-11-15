import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PeriodPicker from '../analytics/PeriodPicker';
import FilterChips from '../analytics/FilterChips';
import RefreshedStamp from '../analytics/RefreshedStamp';

function pressed(name: string): string | null {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed');
}

describe('PeriodPicker', () => {
  it("PeriodPicker: shows the tab's presets, marks the active one, and Custom reveals two date inputs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PeriodPicker tab="money" value={{ period: '3m' }} onChange={onChange} />);

    const group = screen.getByRole('group', { name: 'Period' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'This month',
      '3 months',
      '12 months',
      'Custom',
    ]);
    expect(pressed('3 months')).toBe('true');
    expect(pressed('This month')).toBe('false');
    expect(pressed('12 months')).toBe('false');
    expect(pressed('Custom')).toBe('false');

    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Custom' }));

    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date');
    // Opening the range is not a choice yet: the applied preset still shows.
    expect(onChange).not.toHaveBeenCalled();
    expect(pressed('3 months')).toBe('true');
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers 30 days instead of This month on the operators and network tabs', () => {
    const { rerender } = render(
      <PeriodPicker tab="operators" value={{ period: '30d' }} onChange={() => {}} />,
    );
    expect(pressed('30 days')).toBe('true');
    expect(screen.queryByRole('button', { name: 'This month' })).not.toBeInTheDocument();

    rerender(<PeriodPicker tab="network" value={{ period: '12m' }} onChange={() => {}} />);
    expect(pressed('12 months')).toBe('true');
    expect(pressed('30 days')).toBe('false');
  });

  it('clicking a preset reports it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PeriodPicker tab="money" value={{ period: 'month' }} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '12 months' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ period: '12m' });
  });

  it('applies a custom range only when both days are set and in order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PeriodPicker tab="network" value={{ period: '30d' }} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Custom' }));

    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-10' } });
    expect(apply).toBeDisabled();

    // Reversed: explained, not sent.
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });
    expect(apply).toBeDisabled();
    expect(screen.getByText('From must be on or before To')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    expect(screen.queryByText('From must be on or before To')).not.toBeInTheDocument();
    expect(apply).toBeEnabled();

    await user.click(apply);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-10' });
  });

  it('refuses a range longer than 400 days, as the API does', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PeriodPicker tab="money" value={{ period: 'month' }} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Custom' }));

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText('A range can cover at most 400 days')).toBeInTheDocument();

    // 400 days exactly is allowed: 2025-09-28 → 2026-11-01 inclusive.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-09-28' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('shows an applied custom range: Custom is marked and the days are filled in', () => {
    render(
      <PeriodPicker
        tab="money"
        value={{ from: '2026-11-01', to: '2026-11-10' }}
        onChange={() => {}}
      />,
    );
    expect(pressed('Custom')).toBe('true');
    expect(pressed('This month')).toBe('false');
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-10');
  });

  it('follows the value it is given: a preset closes the range, a new tab resets it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PeriodPicker
        tab="money"
        value={{ from: '2026-11-01', to: '2026-11-10' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('From')).toBeInTheDocument();

    // The owner picked a preset (or pressed Back): the range closes.
    rerender(<PeriodPicker tab="money" value={{ period: '3m' }} onChange={() => {}} />);
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(pressed('3 months')).toBe('true');

    // A half-typed range does not follow the owner to another tab.
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    rerender(<PeriodPicker tab="operators" value={{ period: '3m' }} onChange={() => {}} />);
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  });

  it('clicking Custom again closes an unapplied range', async () => {
    const user = userEvent.setup();
    render(<PeriodPicker tab="money" value={{ period: 'month' }} onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  });
});

describe('FilterChips', () => {
  const options = [
    { key: 'all', label: 'All' },
    { key: 'quiet', label: 'Quiet' },
    { key: 'near-limit', label: 'Near limit' },
  ];

  it('marks the active chip and reports the one clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips options={options} value="all" onChange={onChange} ariaLabel="Filter operators" />);

    const group = screen.getByRole('group', { name: 'Filter operators' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All',
      'Quiet',
      'Near limit',
    ]);
    expect(pressed('All')).toBe('true');
    expect(pressed('Quiet')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Quiet' }));
    expect(onChange).toHaveBeenCalledWith('quiet');
  });

  it('shows a count beside the label when one is given', () => {
    render(
      <FilterChips
        options={[
          { key: 'all', label: 'All' },
          { key: 'quiet', label: 'Quiet', count: 4 },
        ]}
        value="quiet"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Quiet 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
  });
});

describe('RefreshedStamp', () => {
  it('live: "Live, updated 2m ago"', () => {
    render(<RefreshedStamp live dataUpdatedAt={Date.now() - 120_000} />);
    expect(screen.getByText('Live, updated 2m ago')).toBeInTheDocument();
  });

  it('live with nothing loaded yet: just "Live"', () => {
    render(<RefreshedStamp live />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('summaries: "Figures as of 15 Nov 2026, 12:20" in Khartoum time', () => {
    render(<RefreshedStamp refreshedAt="2026-11-15T10:20:00.000Z" stale={false} />);
    const stamp = screen.getByText('Figures as of 15 Nov 2026, 12:20');
    expect(stamp).toBeInTheDocument();
    expect(stamp.closest('[data-stale]')).toHaveAttribute('data-stale', 'false');
    expect(stamp.closest('[data-stale]')).not.toHaveClass('text-amber-700');
  });

  it('turns amber when the figures are stale', () => {
    render(<RefreshedStamp refreshedAt="2026-11-15T10:20:00.000Z" stale />);
    const stamp = screen.getByText('Figures as of 15 Nov 2026, 12:20').closest('[data-stale]');
    expect(stamp).toHaveAttribute('data-stale', 'true');
    expect(stamp).toHaveClass('text-amber-700');
  });

  it('says "No figures yet" when the summaries never ran', () => {
    const { rerender } = render(<RefreshedStamp refreshedAt={null} stale />);
    expect(screen.getByText('No figures yet')).toBeInTheDocument();
    expect(screen.getByText('No figures yet').closest('[data-stale]')).toHaveClass('text-amber-700');

    // An unreadable timestamp is not printed as "Invalid Date".
    rerender(<RefreshedStamp refreshedAt="not-a-date" stale />);
    expect(screen.getByText('No figures yet')).toBeInTheDocument();
  });
});
