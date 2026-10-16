/**
 * Where a tapped notification opens in the app.
 *
 * The server sends the web route it would open (`linkUrl`, e.g.
 * "/projects/12?task=40"). This maps those to the app's screens. Anything
 * without a match opens the Notifications list, so a tap never lands nowhere.
 */
export interface AppRoute { screen: string; params?: Record<string, unknown> }

export function routeForLink(linkUrl?: string | null): AppRoute {
  const link = String(linkUrl ?? '').trim();
  const [path, query = ''] = link.split('?');
  const q = new URLSearchParams(query);
  const seg = path.split('/').filter(Boolean);

  // /projects/:id(?task=…) → that project; /projects?tab=my-tasks → My Tasks
  if (seg[0] === 'projects') {
    const id = Number(seg[1]);
    if (Number.isInteger(id) && id > 0) {
      return { screen: 'ProjectDetail', params: { projectId: id, ...(q.get('task') ? { taskId: Number(q.get('task')) } : {}) } };
    }
    return q.get('tab') === 'my-tasks' ? { screen: 'MyTasks' } : { screen: 'Projects' };
  }
  if (seg[0] === 'tasks') return { screen: 'MyTasks' };

  if (seg[0] === 'field-visits') return { screen: 'FieldVisit' };
  if (seg[0] === 'task-requests') return { screen: 'Approvals' };

  if (seg[0] === 'attendance') {
    if (seg[1] === 'approvals') return { screen: 'Approvals' };
    if (seg[1] === 'shift-roster') return { screen: 'MyShift' };
    return { screen: 'Attendance' };
  }
  if (seg[0] === 'leaves' || link.includes('leave')) return { screen: 'Leaves' };
  if (seg[0] === 'payroll' && seg[1] === 'payslips') return { screen: 'Payslips' };
  if (seg[0] === 'assets') return { screen: 'HardwareRequests' };
  if (seg[0] === 'crm' && seg[1] === 'tickets') return { screen: 'Tickets' };
  if (seg[0] === 'crm') return { screen: 'CRM' };
  if (seg[0] === 'notices' || seg[0] === 'notice-board') return { screen: 'Notices' };
  if (seg[0] === 'employees' && seg[2] === 'profile') return { screen: 'Profile' };

  return { screen: 'Notifications' };
}
