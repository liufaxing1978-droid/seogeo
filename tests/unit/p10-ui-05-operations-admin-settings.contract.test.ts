import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(cwd, relative), 'utf8');
}

describe('P10 UI-05 optimization, members, settings contract', () => {
  it('productizes Optimization Operations without changing existing executor hooks', () => {
    const view = read('src/views/optimization-operations/index.ejs');

    expect(view).toContain('data-ui="optimization-operations-center"');
    expect(view).toContain('data-ui="optimization-authority-boundary"');
    expect(view).toContain('<h1>自动优化中心</h1>');
    expect(view).toContain('data-run-optimization');
    expect(view).toContain('data-policy-form');
    expect(view).toContain('运行策略不等于执行授权');
    expect(view).toContain('人工合并与部署边界保持不变');
    expect(view).toContain('全局暂停');
    expect(view).not.toContain('>GLOBAL_KILL_SWITCH<');
  });

  it('activates real project-scoped Members and Settings destinations', () => {
    const sidebar = read('src/views/partials/sidebar.ejs');

    expect(sidebar).toContain("members: 'members'");
    expect(sidebar).toContain("settings: 'settings'");
    expect(sidebar).toContain("{ key: 'members', label: '成员与权限', icon: 'members', href: projectHref('/members') }");
    expect(sidebar).toContain("{ key: 'settings', label: '设置', icon: 'settings', href: projectHref('/settings') }");
    expect(sidebar).not.toContain("{ key: 'members', label: '成员与权限', icon: 'members', disabled: true }");
    expect(sidebar).not.toContain("{ key: 'settings', label: '设置', icon: 'settings', disabled: true }");
  });

  it('introduces Members & Permissions as a thin adapter over existing RBAC authority', () => {
    const routes = read('src/modules/projects/project-admin.web.routes.ts');
    const view = read('src/views/project-admin/members.ejs');

    expect(routes).toContain("'/projects/:id/members'");
    expect(routes).toContain("requireProjectCapability('PROJECT_MEMBER_READ')");
    expect(routes).toContain('ProjectMembershipService');
    expect(routes).toContain('hasProjectCapability');
    expect(view).toContain('data-ui="members-permissions-center"');
    expect(view).toContain('data-ui="role-ui-authority-boundary"');
    expect(view).toContain('服务器 RBAC 是唯一授权依据');
    expect(view).toContain('LAST_PROJECT_OWNER_REQUIRED');
    expect(view).toContain('PROJECT_MEMBER_MANAGE_BASIC');
    expect(view).toContain('PROJECT_MEMBER_MANAGE_ALL');
  });

  it('keeps member mutations behind existing CSRF/capability/service boundaries', () => {
    const routes = read('src/modules/projects/project-admin.web.routes.ts');

    expect(routes).toContain('requireCsrf()');
    expect(routes).toContain("requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC')");
    expect(routes).toContain('.addOrReactivate(');
    expect(routes).toContain('.changeRole(');
    expect(routes).toContain('.revoke(');
  });

  it('introduces safe Settings without exposing secrets or inventing provider health', () => {
    const routes = read('src/modules/projects/project-admin.web.routes.ts');
    const view = read('src/views/project-admin/settings.ejs');

    expect(routes).toContain("'/projects/:id/settings'");
    expect(routes).toContain("requireProjectCapability('PROJECT_READ')");
    expect(routes).toContain("requireProjectCapability('PROJECT_SETTINGS_WRITE')");
    expect(routes).toContain('DEEPSEEK_API_KEY');
    expect(routes).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(view).toContain('data-ui="settings-center"');
    expect(view).toContain('data-ui="runtime-provider-boundary"');
    expect(view).toContain('项目与地区');
    expect(view).toContain('AI Provider');
    expect(view).toContain('Search / Visibility');
    expect(view).toContain('Runtime Status');
    expect(view).toContain('密钥、Token、连接串不会在页面输出');
    expect(view).not.toContain('<%= env.DEEPSEEK_API_KEY %>');
    expect(view).not.toContain('<%= env.GOOGLE_OAUTH_CLIENT_SECRET %>');
    expect(view).not.toContain('Last provider success');
    expect(view).toContain('data-settings-form');
    expect(view).toContain('data-settings-save disabled');
    expect(view).toContain('有未保存的变更');
  });

  it('registers the project admin web adapter and dedicated responsive UI-05 stylesheet', () => {
    const app = read('src/app.ts');
    const layout = read('src/views/layout.ejs');
    const css = read('src/public/css/p10-ui-05.css');

    expect(app).toContain('createProjectAdminWebRoutes');
    expect(layout).toContain('/assets/css/p10-ui-05.css');
    expect(css).toContain('.admin-center');
    expect(css).toContain('.authority-boundary-grid');
    expect(css).toContain('.settings-section-grid');
    expect(css).toContain('@media (max-width: 1023px)');
    expect(css).toContain('@media (max-width: 640px)');
  });
});
