import type {
  Prisma,
  ProjectRole,
  SecurityAuditEventType,
} from '@prisma/client';
import { prisma } from '../db/prisma.js';

const SECURITY_AUDIT_VERSION = 'SECURITY_AUDIT_V1';

type SecurityAuditDb = Pick<Prisma.TransactionClient, 'securityAuditEvent'>;

export interface SecurityAuditAppendInput {
  eventType: SecurityAuditEventType;
  actorUserId?: string | null;
  targetUserId?: string | null;
  projectId?: string | null;
  roleBefore?: ProjectRole | null;
  roleAfter?: ProjectRole | null;
  createdAt?: Date;
}

export class SecurityAuditRepository {
  constructor(private readonly db: SecurityAuditDb = prisma) {}

  append(input: SecurityAuditAppendInput) {
    return this.db.securityAuditEvent.create({
      data: {
        version: SECURITY_AUDIT_VERSION,
        eventType: input.eventType,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        projectId: input.projectId ?? null,
        roleBefore: input.roleBefore ?? null,
        roleAfter: input.roleAfter ?? null,
        createdAt: input.createdAt ?? new Date(),
      },
    });
  }
}
