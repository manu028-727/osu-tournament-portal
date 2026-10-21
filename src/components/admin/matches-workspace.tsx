'use client';
import { useState } from 'react';
import Link from '@/components/tournament-scope';
import { Users, ListChecks } from 'lucide-react';
import type { Actor } from '@/lib/permissions';
import { CompetitionViewToggle } from '@/components/competition-bracket';
import { CompetitionWorkspace } from './competition-workspace';
import { MatchesDashboard } from './matches-dashboard';
import { Button } from '../ui/button';
export function MatchesWorkspace({ actor }: { actor: Actor }) {
  const [view, setView] = useState<'list' | 'bracket'>('list');
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <CompetitionViewToggle value={view} onChange={setView} />
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/referee/qualifiers">
              <Users size={16} />
              Qualifier sessions
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/qualifier-results">
              <ListChecks size={16} />
              Qualifier results
            </Link>
          </Button>
        </div>
      </div>
      {view === 'list' ? (
        <MatchesDashboard actor={actor} />
      ) : (
        <CompetitionWorkspace actor={actor} />
      )}
    </>
  );
}
