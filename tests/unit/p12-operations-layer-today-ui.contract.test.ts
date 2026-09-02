import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(cwd, relative), 'utf8');
}

describe('P12+ OL-1 Today / Action Center UI contract', () => {
  it('renders Today as an additive action layer over persisted Operations facts', () => {
    const view = read('src/views/optimization-operations/index.ejs');

    expect(view).toContain('data-ui="operations-today-action-center"');
    expect(view).toContain('<h2>今日行动</h2>');
    expect(view).toContain('overview.todayActions');
    expect(view).toContain('data-today-action-priority');
    expect(view).toContain('data-today-action-kind');
    expect(view).toContain('暂无优先行动');
  });

  it('keeps the existing execution authority boundary visible on the same page', () => {
    const view = read('src/views/optimization-operations/index.ejs');

    expect(view).toContain('运行策略不等于执行授权');
    expect(view).toContain('人工合并与部署边界保持不变');
    expect(view).not.toContain('自动合并');
    expect(view).not.toContain('自动部署');
  });
});
