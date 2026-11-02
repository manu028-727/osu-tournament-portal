import { z } from 'zod';
import { registrationPolicySchema } from './registration-policy';

export const qualifierBookingPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    opensAt: z.iso.datetime().nullable().default(null),
    closesAt: z.iso.datetime().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.opensAt && value.closesAt && value.opensAt >= value.closesAt)
      ctx.addIssue({ code: 'custom', message: 'Booking must open before its deadline.' });
  });
export type QualifierBookingPolicy = z.infer<typeof qualifierBookingPolicySchema>;

// Read older installations and archives without rewriting their configuration.
export function qualifierBookingPolicy(settings: {
  qualifierBookingPolicy?: unknown;
  registrationPolicy?: unknown;
}) {
  if (settings.qualifierBookingPolicy)
    return qualifierBookingPolicySchema.parse(settings.qualifierBookingPolicy);
  const registration = registrationPolicySchema.parse(settings.registrationPolicy || {});
  return qualifierBookingPolicySchema.parse({
    enabled: registration.bookingEnabled,
    closesAt: registration.bookingClosesAt,
  });
}
