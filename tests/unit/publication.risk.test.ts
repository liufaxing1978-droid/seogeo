import { describe, expect, it } from 'vitest';
import {
  PublicationPolicyError,
  assertP8AOperationPolicy,
  classifyPublicationRisk
} from '../../src/modules/publication/publication-risk.js';

function expectPolicyCode(run: () => void, code: 'OPERATION_NOT_ALLOWED' | 'PATH_NOT_ALLOWED' | 'PLAN_LIMIT_EXCEEDED') {
  try {
    run();
    throw new Error(`expected policy error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PublicationPolicyError);
    expect((error as PublicationPolicyError).code).toBe(code);
  }
}

describe('P8-A publication risk policy', () => {
  it('classifies ordinary primary publication operations as LOW', () => {
    for (const type of [
      'CREATE_CONTENT_PAGE',
      'SET_TITLE',
      'SET_META_DESCRIPTION',
      'SET_H1',
      'ADD_INTERNAL_LINK',
      'UPSERT_JSON_LD'
    ]) {
      expect(classifyPublicationRisk([{ type, path: 'content/news/a.md' }])).toBe('LOW');
    }
  });

  it('classifies the design-approved bounded existing-page changes as MEDIUM', () => {
    for (const type of [
      'REPLACE_BOUNDED_CONTENT_BLOCK',
      'SET_CANONICAL',
      'SET_META_ROBOTS',
      'ROBOTS_RULE_CHANGE'
    ]) {
      expect(classifyPublicationRisk([{ type, path: 'content/news/a.md' }])).toBe('MEDIUM');
    }
  });

  it('classifies destructive/global/production operations as HIGH', () => {
    for (const type of [
      'DELETE_PAGE',
      'BULK_REDIRECT',
      'MASS_NOINDEX',
      'MUTATE_TEMPLATE',
      'MUTATE_GLOBAL_NAVIGATION',
      'DEPLOY_PRODUCTION'
    ]) {
      expect(classifyPublicationRisk([{ type, path: 'content/news/a.md' }])).toBe('HIGH');
    }
  });

  it('rejects HIGH and unknown operations in P8-A regardless of account plan', () => {
    expectPolicyCode(() => assertP8AOperationPolicy({
      files: ['content/news/a.md'],
      operations: [{ type: 'DELETE_PAGE', path: 'content/news/a.md' }],
      primaryUrl: 'https://xingshantang.org/news/a'
    }), 'OPERATION_NOT_ALLOWED');

    expectPolicyCode(() => assertP8AOperationPolicy({
      files: ['content/news/a.md'],
      operations: [{ type: 'SHELL_COMMAND', path: 'content/news/a.md' }],
      primaryUrl: 'https://xingshantang.org/news/a'
    }), 'OPERATION_NOT_ALLOWED');
  });

  it('fails closed when a plan exceeds 20 files or 50 operations', () => {
    expectPolicyCode(() => assertP8AOperationPolicy({
      files: Array.from({ length: 21 }, (_, index) => `content/news/${index}.md`),
      operations: [{ type: 'SET_TITLE', path: 'content/news/0.md' }],
      primaryUrl: 'https://xingshantang.org/news/a'
    }), 'PLAN_LIMIT_EXCEEDED');

    expectPolicyCode(() => assertP8AOperationPolicy({
      files: ['content/news/a.md'],
      operations: Array.from({ length: 51 }, () => ({ type: 'SET_TITLE', path: 'content/news/a.md' })),
      primaryUrl: 'https://xingshantang.org/news/a'
    }), 'PLAN_LIMIT_EXCEEDED');
  });

  it('allows only one primary public URL per plan', () => {
    expectPolicyCode(() => assertP8AOperationPolicy({
      files: ['content/news/a.md', 'content/news/b.md'],
      operations: [
        { type: 'CREATE_CONTENT_PAGE', path: 'content/news/a.md', primaryUrl: 'https://xingshantang.org/news/a' },
        { type: 'CREATE_CONTENT_PAGE', path: 'content/news/b.md', primaryUrl: 'https://xingshantang.org/news/b' }
      ]
    }), 'PLAN_LIMIT_EXCEEDED');
  });

  it('rejects traversal, absolute paths and paths outside configured allowlists', () => {
    for (const path of ['../secret', '/etc/passwd', 'content/news/../../secret']) {
      expectPolicyCode(() => assertP8AOperationPolicy({
        files: [path],
        operations: [{ type: 'SET_TITLE', path }],
        primaryUrl: 'https://xingshantang.org/news/a',
        allowedPaths: ['content/news/']
      }), 'PATH_NOT_ALLOWED');
    }

    expectPolicyCode(() => assertP8AOperationPolicy({
      files: ['src/app.ts'],
      operations: [{ type: 'SET_TITLE', path: 'src/app.ts' }],
      primaryUrl: 'https://xingshantang.org/news/a',
      allowedPaths: ['content/news/']
    }), 'PATH_NOT_ALLOWED');
  });

  it('accepts bounded LOW/MEDIUM operations inside the configured path', () => {
    expect(() => assertP8AOperationPolicy({
      files: ['content/news/a.md'],
      operations: [
        { type: 'SET_TITLE', path: 'content/news/a.md' },
        { type: 'SET_CANONICAL', path: 'content/news/a.md' },
        { type: 'REPLACE_BOUNDED_CONTENT_BLOCK', path: 'content/news/a.md' }
      ],
      primaryUrl: 'https://xingshantang.org/news/a',
      allowedPaths: ['content/news/']
    })).not.toThrow();
  });
});
