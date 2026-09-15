import { renderFile } from 'ejs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PROJECT_ID = '00000000-0000-4000-8000-000000000041';
const BRIEF_ID = '00000000-0000-4000-8000-000000000042';

describe('content brief publication handoff', () => {
  it('renders an internal-draft action that preserves the selected brief', async () => {
    const html = await renderFile(
      fileURLToPath(new URL('../../src/views/content/brief-show.ejs', import.meta.url)),
      {
        project: { id: PROJECT_ID },
        brief: {
          id: BRIEF_ID,
          promptVersion: 'content-brief-v1',
          briefJson: { primaryTopic: '妈祖信俗资料导读' },
          sourceReferences: [],
        },
      },
    );

    expect(html).toContain('创建内部草稿');
    expect(html).toContain(
      `/projects/${PROJECT_ID}/publication/drafts/new?briefId=${BRIEF_ID}`,
    );
    expect(html).toContain('只创建草稿，不发布');
  });
});
