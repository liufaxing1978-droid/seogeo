import { createHash } from 'node:crypto';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import type {
  CreateVisibilityPromptSetInput,
  CreateVisibilityPromptVersionInput
} from './visibility.types.js';

async function requireProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return project;
}

function promptHash(promptText: string, locale: string | null, country: string | null) {
  return createHash('sha256')
    .update(JSON.stringify({ promptText, locale, country }))
    .digest('hex');
}

export class VisibilityPromptService {
  async createPromptSet(projectId: string, input: CreateVisibilityPromptSetInput) {
    await requireProject(projectId);
    if (!input.name.trim()) {
      throw new AppError('Prompt set name is required', 400, 'INVALID_VISIBILITY_PROMPT_SET_NAME');
    }
    return prisma.visibilityPromptSet.create({
      data: {
        projectId,
        name: input.name.trim(),
        description: input.description ?? null,
        defaultLocale: input.defaultLocale ?? null,
        defaultCountry: input.defaultCountry ?? null
      }
    });
  }

  async createPromptVersion(projectId: string, input: CreateVisibilityPromptVersionInput) {
    await requireProject(projectId);
    const promptSet = await prisma.visibilityPromptSet.findFirst({
      where: { id: input.promptSetId, projectId },
      select: { id: true, defaultLocale: true, defaultCountry: true }
    });
    if (!promptSet) {
      throw new NotFoundError('Visibility prompt set not found', 'VISIBILITY_PROMPT_SET_NOT_FOUND');
    }

    const promptKey = input.promptKey.trim();
    if (!promptKey) {
      throw new AppError('promptKey is required', 400, 'INVALID_VISIBILITY_PROMPT_KEY');
    }
    if (!input.promptText.trim()) {
      throw new AppError('promptText is required', 400, 'INVALID_VISIBILITY_PROMPT_TEXT');
    }

    const locale = input.locale === undefined ? promptSet.defaultLocale : input.locale;
    const country = input.country === undefined ? promptSet.defaultCountry : input.country;
    const latest = await prisma.visibilityPrompt.findFirst({
      where: { promptSetId: promptSet.id, promptKey },
      orderBy: { version: 'desc' },
      select: { version: true }
    });
    const version = (latest?.version ?? 0) + 1;

    return prisma.visibilityPrompt.create({
      data: {
        projectId,
        promptSetId: promptSet.id,
        promptKey,
        version,
        promptText: input.promptText,
        locale,
        country,
        promptHash: promptHash(input.promptText, locale, country)
      }
    });
  }
}

export const visibilityPromptService = new VisibilityPromptService();
