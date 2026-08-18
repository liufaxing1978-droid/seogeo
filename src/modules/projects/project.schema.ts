import { z } from 'zod';

const domainPattern = /^(?=.{3,253}$)(?!https?:\/\/)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/),
  primaryDomain: z.string().trim().regex(domainPattern, '请输入不带协议的有效域名'),
  industry: z.string().trim().max(120).optional(),
  defaultLanguage: z.string().trim().min(2).max(20).default('zh-CN'),
  targetCountry: z.string().trim().length(2).transform((value) => value.toUpperCase()).default('CN'),
  timezone: z.string().trim().min(3).max(80).default('Asia/Shanghai'),
  planLevel: z.enum(['STANDARD', 'ADVANCED', 'ENTERPRISE']).default('STANDARD')
});

export const updateProjectSchema = createProjectSchema.partial();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
