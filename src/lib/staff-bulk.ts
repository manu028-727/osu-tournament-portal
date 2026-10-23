import type { Prisma } from '@/generated/prisma/client';
import { AppError, assertPermission, type Actor } from './permissions';
import { scopedDb } from './scoped-db';
import { staffBulkActionSchema, type StaffBulkAction } from './staff-bulk-validation';

// The dispatcher supplies one transaction for the complete selection and its audit log.
export async function applyStaffBulkAction(
  tx: Prisma.TransactionClient,
  actor: Actor | null,
  input: StaffBulkAction,
) {
  assertPermission(actor, 'staff.edit');
  const tournamentId = actor.tournamentId;
  if (!tournamentId || tournamentId === 'none')
    throw new AppError('Select a tournament workspace before editing staff.', 403);
  const action = staffBulkActionSchema.parse(input);
  tx = scopedDb(tx, tournamentId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78214321)`;
  const records = await tx.staffMember.findMany({
    where: { tournamentId, id: { in: action.memberIds } },
    include: { assignments: true },
    orderBy: { id: 'asc' },
  });
  if (records.length !== action.memberIds.length)
    throw new AppError('A selected staff member no longer exists in this tournament.', 404);

  const assignment = action.patch.assignment;
  if (assignment) {
    const categoryIds =
      assignment.operation === 'REASSIGN'
        ? [assignment.categoryId, assignment.destinationCategoryId]
        : [assignment.categoryId];
    if (
      (await tx.staffCategory.count({ where: { tournamentId, id: { in: categoryIds } } })) !==
      categoryIds.length
    )
      throw new AppError('Choose public staff categories from the current tournament.', 404);
    if (assignment.operation === 'REASSIGN' || assignment.operation === 'LABEL') {
      const missing = records.find(
        (record) => !record.assignments.some((entry) => entry.categoryId === assignment.categoryId),
      );
      if (missing)
        throw new AppError(
          `${missing.username} is not assigned to the selected source category. Filter that category and review the selection.`,
          409,
        );
    }
  }

  if (action.patch.visible !== undefined) {
    const updated = await tx.staffMember.updateMany({
      where: { tournamentId, id: { in: action.memberIds } },
      data: { visible: action.patch.visible },
    });
    if (updated.count !== records.length)
      throw new AppError('The selected staff changed. Reload before applying changes.', 409);
  }
  for (const record of records) {
    if (assignment?.operation === 'REMOVE') {
      await tx.staffAssignment.deleteMany({
        where: { tournamentId, memberId: record.id, categoryId: assignment.categoryId },
      });
    } else if (assignment?.operation === 'LABEL') {
      const updated = await tx.staffAssignment.updateMany({
        where: { tournamentId, memberId: record.id, categoryId: assignment.categoryId },
        data: { position: assignment.position },
      });
      if (updated.count !== 1)
        throw new AppError('A staff assignment changed. Reload before applying changes.', 409);
    } else if (assignment) {
      const categoryId =
        assignment.operation === 'REASSIGN'
          ? assignment.destinationCategoryId
          : assignment.categoryId;
      const source = record.assignments.find((entry) => entry.categoryId === assignment.categoryId);
      await tx.staffAssignment.upsert({
        where: { memberId_categoryId: { memberId: record.id, categoryId }, tournamentId },
        create: {
          tournamentId,
          memberId: record.id,
          categoryId,
          position:
            assignment.position ?? (assignment.operation === 'REASSIGN' ? source!.position : ''),
        },
        update: assignment.position === undefined ? {} : { position: assignment.position },
      });
      if (assignment.operation === 'REASSIGN')
        await tx.staffAssignment.deleteMany({
          where: { tournamentId, memberId: record.id, categoryId: assignment.categoryId },
        });
    }
    const afterAssignments = assignment
      ? await tx.staffAssignment.findMany({
          where: { tournamentId, memberId: record.id },
          select: { categoryId: true, position: true },
          orderBy: { categoryId: 'asc' },
        })
      : record.assignments.map(({ categoryId, position }) => ({ categoryId, position }));
    await tx.auditLog.create({
      data: {
        tournamentId,
        actorId: actor.id,
        action: 'staff.bulk',
        entityType: 'StaffMember',
        entityId: record.id,
        details: {
          patch: action.patch,
          before: {
            visible: record.visible,
            assignments: record.assignments.map(({ categoryId, position }) => ({
              categoryId,
              position,
            })),
          },
          after: { visible: action.patch.visible ?? record.visible, assignments: afterAssignments },
        },
      },
    });
  }
  return { updated: records.length };
}
