import { useState } from 'react';
import { Download } from 'lucide-react';
import api from '../lib/api';
import Button from './ui/Button';
import { useToast } from '../hooks/useToast';

interface ExportCsvButtonProps {
  /** API path, e.g. `/admin/users/export`. */
  path: string;
  /** Current filter state to forward as query params — empty/undefined values are omitted. */
  params?: Record<string, string | undefined>;
  label?: string;
}

const FALLBACK_FILENAME = 'wasel-export.csv';

/** Pulls the filename out of a `Content-Disposition: attachment; filename="…"` header. */
function filenameFromContentDisposition(header: string | undefined): string {
  if (!header) return FALLBACK_FILENAME;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : FALLBACK_FILENAME;
}

export default function ExportCsvButton({ path, params, label = 'Export CSV' }: ExportCsvButtonProps) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleExport = async () => {
    setLoading(true);
    try {
      const cleanParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value) cleanParams[key] = value;
      }

      const response = await api.get(path, {
        params: cleanParams,
        responseType: 'blob',
      });

      const filename = filenameFromContentDisposition(response.headers?.['content-disposition']);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={loading}
      leftIcon={<Download className="w-4 h-4" />}
      onClick={handleExport}
    >
      {label}
    </Button>
  );
}
