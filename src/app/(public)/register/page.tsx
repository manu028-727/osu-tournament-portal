import { getActor } from '@/lib/auth';
import { requestScope } from '@/lib/tournament-context';
import { registrationData } from '@/lib/registration-service';
import { RegistrationPortal } from '@/components/registration-portal';
import { PageHeading } from '@/components/content';
import { getServerT } from '@/lib/server-locale';
import { scopedHref } from '@/lib/tournament-paths';
import { notFound } from 'next/navigation';
import { AppError } from '@/lib/permissions';

export default async function Register() {
  const tr = await getServerT();
  const scope = await requestScope();
  const data = await registrationData(await getActor(), scope.tournamentId).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <div className="wrap pb-20">
      <PageHeading
        eyebrow={tr('Players and captains')}
        title={tr('Registration and qualifiers')}
        description={tr('Manage your roster and reserve a shared qualifier session.')}
      />
      <RegistrationPortal
        initial={JSON.parse(JSON.stringify(data))}
        loginUrl={`/api/auth/login?returnTo=${encodeURIComponent(scopedHref('/register', scope))}`}
      />
    </div>
  );
}
