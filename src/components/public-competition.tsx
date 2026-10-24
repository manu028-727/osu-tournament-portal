'use client';
import { useT } from '@/components/locale';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CompetitionBracket } from './competition-bracket';
import { useTournamentScope } from './tournament-scope';
import type { CompetitionBracketData } from '@/lib/competition-types';
export function PublicCompetition({ brackets }: { brackets: CompetitionBracketData[] }) {
  const tr = useT();
  const [selected, setSelected] = useState(''),
    scope = useTournamentScope(),
    router = useRouter();
  const bracket = brackets.find((b) => b.id === selected) || brackets[0];
  if (!bracket) return <p className="py-8 text-muted">{tr('No brackets published yet.')}</p>;
  return (
    <div className="min-w-0 space-y-5">
      <label className="field max-w-md">
        <span>{tr('Bracket')}</span>
        <select value={bracket.id} onChange={(e) => setSelected(e.target.value)}>
          {brackets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <CompetitionBracket
        bracket={bracket}
        onOpenMatch={(id) => {
          const match = bracket.nodes.find((n) => n.matchId === id)?.match;
          if (match) router.push(`${scope.publicBase}/matches/${match.matchNumber}`);
        }}
      />
    </div>
  );
}
