import type { Block } from './validation';
import type { BeatmapMetadata } from './osu';
export type PageContent = {
  id: string;
  title: string;
  html: string;
  blocks: { id?: string; type: string; visible: boolean; content: Block['content'] }[];
};
export type PoolContent = {
  id: string;
  notes: string;
  slots: {
    id?: string;
    name: string;
    category: string;
    categoryName: string;
    color: string;
    position: number;
    beatmapId: number;
    metadata: BeatmapMetadata;
  }[];
};
export type TournamentView = {
  timezone?: string;
  format?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  name: string;
  acronym: string;
  description: string;
  status: string;
  gameMode: string;
  settings: {
    registrationPolicy?: import('./registration-policy').RegistrationPolicy | null;
    qualifierBookingPolicy?: import('./qualifier-booking-policy').QualifierBookingPolicy | null;
    resourcePolicy?: import('./resources').ResourcePolicy | null;
    gameplayScoring?: import('./gameplay-scoring').GameplayScoring | null;
    logo: string;
    banner: string;
    primaryColor: string;
    accentColor: string;
    registrationUrl: string;
    socialLinks: { label: string; href: string }[];
    importantDates: { label: string; date: string }[];
    navigation: { label: string; href: string }[];
    footer: string;
    copy?: import('./copy').SiteCopy;
  };
};
