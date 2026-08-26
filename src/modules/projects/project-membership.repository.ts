import { Prisma, type ProjectRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type MembershipDb = Pick<
  Prisma.TransactionClient,
  'projectMembership' | 'user' | '$queryRaw'
>;

export class ProjectMembershipRepository {
  constructor(private readonly db: MembershipDb = prisma) {}

  listForProject(projectId: string) {
    return this.db.projectMembership.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        projectId: true,
        userId: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
          },
        },
      },
    });
  }

  findAvailableUserByNormalizedEmail(normalizedEmail: string) {
    return this.db.user.findFirst({
      where: { normalizedEmail, status: 'ACTIVE' },
      select: { id: true, email: true, normalizedEmail: true, displayName: true, status: true },
    });
  }

  findByProjectAndUser(projectId: string, userId: string) {
    return this.db.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
  }

  findByIdForProject(projectId: string, membershipId: string) {
    return this.db.projectMembership.findFirst({
      where: { id: membershipId, projectId },
    });
  }

  async lockProject(projectId: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = CAST(${projectId} AS uuid) FOR UPDATE`,
    );
    return rows.length === 1;
  }

  countActiveOwners(projectId: string) {
    return this.db.projectMembership.count({
      where: { projectId, status: 'ACTIVE', role: 'OWNER' },
    });
  }

  create(projectId: string, userId: string, role: ProjectRole) {
    return this.db.projectMembership.create({
      data: { projectId, userId, role, status: 'ACTIVE' },
    });
  }

  reactivate(membershipId: string, role: ProjectRole) {
    return this.db.projectMembership.update({
      where: { id: membershipId },
      data: { role, status: 'ACTIVE' },
    });
  }

  updateRole(membershipId: string, role: ProjectRole) {
    return this.db.projectMembership.update({
      where: { id: membershipId },
      data: { role },
    });
  }

  revoke(membershipId: string) {
    return this.db.projectMembership.update({
      where: { id: membershipId },
      data: { status: 'REVOKED' },
    });
  }
}
