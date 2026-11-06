// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddUrlDialog } from '../renderer/components/AddUrlDialog';
import { DownloadRow } from '../renderer/components/DownloadRow';
import { formatBytes, formatEta } from '../renderer/format';
import type { DownloadView } from '../shared/api';

afterEach(cleanup);

const view = (patch: Partial<DownloadView> = {}): DownloadView => ({
  id: 'a', url: 'http://x/f.zip', finalUrl: 'http://x/f.zip', filename: 'f.zip', saveDir: '/tmp', size: 1000,
  etag: null, lastModified: null, rangeSupported: true, status: 'downloading', segments: [],
  createdAt: '2026-01-01', bytesDone: 500, speed: 1536, etaSeconds: 5, ...patch,
});

const handlers = () => ({ onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() });

describe('format', () => {
  it('formatBytes and formatEta cases', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatEta(null)).toBe('--');
    expect(formatEta(5)).toBe('5s');
    expect(formatEta(125)).toBe('2m 5s');
    expect(formatEta(3720)).toBe('1h 2m');
  });
});

describe('DownloadRow', () => {
  it('shows Pause when downloading, Resume when paused', () => {
    const h = handlers();
    const { rerender } = render(<DownloadRow download={view()} {...h} />);
    expect(screen.queryByText('Pause')).not.toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
    rerender(<DownloadRow download={view({ status: 'paused' })} {...h} />);
    expect(screen.queryByText('Resume')).not.toBeNull();
    expect(screen.queryByText('Pause')).toBeNull();
    fireEvent.click(screen.getByText('Resume'));
    expect(h.onResume).toHaveBeenCalledWith('a');
  });

  it('shows error text and Retry; Retry calls resume', () => {
    const h = handlers();
    render(<DownloadRow download={view({ status: 'error', error: 'File not found (404)' })} {...h} />);
    expect(screen.queryByText('File not found (404)')).not.toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(h.onResume).toHaveBeenCalledWith('a');
  });

  it('shows the non-resumable note', () => {
    render(<DownloadRow download={view({ rangeSupported: false })} {...handlers()} />);
    expect(screen.queryByText(/Can't resume: the server doesn't support it/)).not.toBeNull();
  });
});

describe('AddUrlDialog', () => {
  it('rejects empty input and calls onAdd with a trimmed URL', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AddUrlDialog onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByText('Add'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: '  http://x/f.zip  ' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('http://x/f.zip'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows the error when the link is rejected', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Only http and https links are supported'));
    render(<AddUrlDialog onAdd={onAdd} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'ftp://x' } });
    fireEvent.click(screen.getByText('Add'));
    expect((await screen.findByRole('alert')).textContent).toContain('Only http');
  });
});
