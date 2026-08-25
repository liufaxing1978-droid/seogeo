import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import type { Prisma } from '@prisma/client';
import { normalizeEmail } from '../src/auth/email.js';
import { passwordHasher } from '../src/auth/password.js';
import { SecurityAuditRepository } from '../src/auth/security-audit.repository.js';
import { AppError, ValidationError } from '../src/core/errors.js';
import { prisma } from '../src/db/prisma.js';

const IDENTITY_PROVISIONING_LOCK_ID = 0x50313041n;

function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized || !/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new ValidationError('Invalid email');
  }
  return normalized;
}

function validatePassword(password: string): void {
  const length = Array.from(password).length;
  if (length < 12 || length > 256) {
    throw new AppError(
      'Password must be between 12 and 256 characters',
      400,
      'PASSWORD_POLICY_VIOLATION',
    );
  }
}

async function lockIdentityProvisioning(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${IDENTITY_PROVISIONING_LOCK_ID})`;
}

async function requireUser(tx: Prisma.TransactionClient, email: string) {
  const normalizedEmail = validateEmail(email);
  const user = await tx.user.findUnique({ where: { normalizedEmail } });
  if (!user) {
    throw new AppError('User is not available', 404, 'USER_NOT_AVAILABLE');
  }
  return user;
}

export async function bootstrapOwner(email: string, password: string) {
  const normalizedEmail = validateEmail(email);
  validatePassword(password);
  const passwordHash = await passwordHasher.hash(password);

  return prisma.$transaction(async (tx) => {
    await lockIdentityProvisioning(tx);
    if (await tx.user.count() !== 0) {
      throw new AppError(
        'Identity bootstrap is already initialized',
        409,
        'AUTH_BOOTSTRAP_ALREADY_INITIALIZED',
      );
    }

    const projects = await tx.project.findMany({ select: { id: true } });
    const user = await tx.user.create({
      data: {
        email: email.trim(),
        normalizedEmail,
        passwordHash,
        passwordHashVersion: 1,
        status: 'ACTIVE',
      },
    });
    const audit = new SecurityAuditRepository(tx);
    await audit.append({
      eventType: 'USER_PROVISIONED',
      targetUserId: user.id,
    });

    for (const project of projects) {
      await tx.projectMembership.create({
        data: {
          projectId: project.id,
          userId: user.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      await audit.append({
        eventType: 'MEMBERSHIP_CREATED',
        targetUserId: user.id,
        projectId: project.id,
        roleAfter: 'OWNER',
      });
    }

    return user;
  });
}

export async function provisionUser(email: string, password: string) {
  const normalizedEmail = validateEmail(email);
  validatePassword(password);
  const passwordHash = await passwordHasher.hash(password);

  return prisma.$transaction(async (tx) => {
    await lockIdentityProvisioning(tx);
    const user = await tx.user.create({
      data: {
        email: email.trim(),
        normalizedEmail,
        passwordHash,
        passwordHashVersion: 1,
        status: 'ACTIVE',
      },
    });
    await new SecurityAuditRepository(tx).append({
      eventType: 'USER_PROVISIONED',
      targetUserId: user.id,
    });
    return user;
  });
}

export async function disableUser(email: string) {
  return prisma.$transaction(async (tx) => {
    const user = await requireUser(tx, email);
    const revokedAt = new Date();
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { status: 'DISABLED' },
    });
    await tx.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt },
    });
    const audit = new SecurityAuditRepository(tx);
    await audit.append({
      eventType: 'USER_DISABLED',
      targetUserId: user.id,
      createdAt: revokedAt,
    });
    await audit.append({
      eventType: 'SESSIONS_REVOKED_ALL',
      targetUserId: user.id,
      createdAt: revokedAt,
    });
    return updated;
  });
}

export async function enableUser(email: string) {
  return prisma.$transaction(async (tx) => {
    const user = await requireUser(tx, email);
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE' },
    });
    await new SecurityAuditRepository(tx).append({
      eventType: 'USER_ENABLED',
      targetUserId: user.id,
    });
    return updated;
  });
}

async function readHiddenTtyLine(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stderr;
  output.write(prompt);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();

  return new Promise((resolveLine, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolveLine(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u0003') {
          finish(new Error('Password input cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') value += char;
      }
    };
    input.on('data', onData);
  });
}

async function readConfirmedPassword(): Promise<string> {
  let password: string;
  let confirmation: string;
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    password = await readHiddenTtyLine('Password: ');
    confirmation = await readHiddenTtyLine('Confirm password: ');
  } else {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });
    try {
      password = await rl.question('Password: ');
      confirmation = await rl.question('Confirm password: ');
    } finally {
      rl.close();
    }
  }

  if (password !== confirmation) {
    throw new ValidationError('Password confirmation does not match');
  }
  validatePassword(password);
  return password;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new ValidationError('Usage: auth-admin <command> <email>');
  }
  const [command, email] = args;

  switch (command) {
    case 'bootstrap-owner':
      await bootstrapOwner(email, await readConfirmedPassword());
      break;
    case 'provision-user':
      await provisionUser(email, await readConfirmedPassword());
      break;
    case 'disable-user':
      await disableUser(email);
      break;
    case 'enable-user':
      await enableUser(email);
      break;
    default:
      throw new ValidationError('Unknown auth-admin command');
  }
}

const invokedAsScript = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (invokedAsScript) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Auth admin command failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
