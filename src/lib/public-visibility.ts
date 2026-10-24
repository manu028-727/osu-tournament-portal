// A saved publication flag survives archival; guests require both conditions.
export const publicTournamentWhere = { published: true, archivedAt: null } as const;

export function isPublicTournament(
  tournament: { published: boolean; archivedAt: Date | null } | null,
): boolean {
  return !!tournament?.published && tournament.archivedAt === null;
}
