'use client';
import { artistKey } from '@/lib/pool-artist';
import { formatNumber, humanizeCode, type Locale } from '@/lib/i18n';
import { useT } from '@/components/locale';
import type { PoolCandidateView, PoolingData } from '@/lib/pooling-types';
import type { PoolingAction } from '@/lib/pooling-validation';

export type Candidate = PoolCandidateView;

export type Skillset = PoolingData['skillsets'][number];

export type Warning = PoolingData['warnings'][number];

export type BulkPatch = Extract<PoolingAction, { type: 'pooling.bulk' }>['patch'];

export type Mutate = (payload: PoolingAction, message: string, after?: () => void) => void;

export const statuses = ['SUGGESTED', 'REVIEW', 'PLAYTESTING', 'ACCEPTED', 'SELECTED', 'REJECTED'];

export const editableStatuses = statuses.filter((status) => status !== 'SELECTED');

export const reviewSummary = (candidate: Candidate, language: Locale) => {
  const completed = candidate.reviews.filter((review) => review.completed);
  const mean = (field: 'fit' | 'difficulty') => {
    const ratings = completed
      .map((review) => review[field])
      .filter((rating): rating is number => rating !== null);
    return ratings.length
      ? formatNumber(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length, language, 1)
      : '-';
  };
  return { completed, fit: mean('fit'), difficulty: mean('difficulty') };
};

export const warningFor = (data: PoolingData, candidate: Candidate) =>
  data.warnings.find((warning) => warning.artistKey === artistKey(candidate.metadata.artist));

export function CandidateStatus({ status }: { status: string }) {
  const tr = useT();
  const color =
    status === 'ACCEPTED' || status === 'SELECTED'
      ? 'text-emerald-400'
      : status === 'REJECTED'
        ? 'text-red-400'
        : status === 'PLAYTESTING'
          ? 'text-amber-400'
          : 'text-muted';
  return <span className={`text-xs font-medium ${color}`}>{tr(humanizeCode(status))}</span>;
}
