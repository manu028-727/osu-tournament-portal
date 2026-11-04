import { getActor } from '@/lib/auth';
import { requestScope } from '@/lib/tournament-context';
import { qualifierBookingData } from '@/lib/qualifier-booking-service';
import { QualifierBookingPortal } from '@/components/qualifier-booking-portal';
import { PageHeading } from '@/components/content';
import { Notices } from '@/components/admin/shared';
import { getServerT } from '@/lib/server-locale';
import { scopedHref } from '@/lib/tournament-paths';
import { notFound } from 'next/navigation';
import { AppError } from '@/lib/permissions';

export default async function QualifierBooking() {
  const tr = await getServerT();
  const scope = await requestScope();
  const data = await qualifierBookingData(await getActor(), scope.tournamentId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={tr('Players and captains')}
        title={tr('Qualifier booking')}
        description={tr('Reserve, change or cancel a qualifier session for your registered entry.')}
      />
      <Notices>
        <QualifierBookingPortal
          initial={JSON.parse(JSON.stringify(data))}
          loginUrl={`/api/auth/login?returnTo=${encodeURIComponent(scopedHref('/qualifier-booking', scope))}`}
        />
      </Notices>
    </div>
  );
}
