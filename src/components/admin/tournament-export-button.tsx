'use client';
import { useT } from '@/components/locale';

import { Download } from 'lucide-react';
import { Button } from '../ui/button';
import { useTask } from './shared';
import { tournamentApiUrl } from '../tournament-scope';

export function ExportTournamentButton({ tournament }: { tournament?: string }) {
  const tr = useT();
  const { busy, run } = useTask();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() =>
        void run(async () => {
          const url = tournament
            ? `/api/tournament-transfer/export?tournament=${encodeURIComponent(tournament)}`
            : tournamentApiUrl('/api/tournament-transfer/export');
          const response = await fetch(url, { method: 'POST' });
          if (!response.ok) throw new Error((await response.json()).error || 'Export failed.');
          const objectUrl = URL.createObjectURL(await response.blob());
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download =
            response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
            'tournament.zip';
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        }, tr('Tournament archive downloaded.'))
      }
    >
      <Download size={17} />
      {busy ? tr('Exporting...') : tr('Export Tournament')}
    </Button>
  );
}
