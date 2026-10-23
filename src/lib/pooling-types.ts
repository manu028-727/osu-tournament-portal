import type { BeatmapMetadata } from './osu';
export type PoolPlanView = {
  version: number;
  slots: { name: string; category: string }[];
  minStars: number | null;
  maxStars: number | null;
  reviewState: string;
};
export type PoolCandidateView = {
  id: string;
  version: number;
  beatmapId: number;
  stageId: string | null;
  category: string;
  status: string;
  notes: string;
  metadata: BeatmapMetadata;
  selectedSlot: string | null;
  submitter: { id: string; username: string } | null;
  tags: { skillsetId: string; primary: boolean }[];
  reviews: {
    id: string;
    version: number;
    reviewerId: string;
    reviewer: { username: string };
    fit: number | null;
    difficulty: number | null;
    flags: string;
    notes: string;
    completed: boolean;
  }[];
};
export type PoolingData = {
  candidates: PoolCandidateView[];
  stages: {
    id: string;
    name: string;
    plan: PoolPlanView | null;
    pool: { draftRevisionId: string | null; publishedRevisionId: string | null } | null;
  }[];
  categories: { acronym: string; name: string; color: string; position: number }[];
  skillsets: { id: string; name: string; group: string }[];
  warnings: {
    id: string;
    artist: string;
    artistKey: string;
    severity: string;
    reason: string;
    source: string;
  }[];
  reviewers: { id: string; username: string }[];
};
