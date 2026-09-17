/**
 * Who may raise a task.
 *
 * A plain function taking the Prisma client rather than an injectable service,
 * because both TasksService and IssuesService need it and wiring one module
 * into the other for five lines would couple ProjectsModule to CrmModule
 * through TasksModule. One implementation, no dependency graph.
 */
export async function canCreateTask(
  prisma: {
    employee: { findFirst: Function };
    projectMember?: { findFirst: Function };
  },
  companyId: number,
  actorEmployeeId: number | null | undefined,
  role: string | undefined,
  project?: { id?: number; leadId: number | null } | null,
): Promise<boolean> {
  // Admins always may.
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true;
  if (!actorEmployeeId) return false;

  // A project's owner may, within their own project. This is the rule
  // issues.service has enforced all along, preserved exactly.
  if (project && project.leadId === actorEmployeeId) return true;

  // A project manager may raise work inside a project they manage.
  //
  // They could not before, which made no sense next to everything else a PM
  // does here: they approve its timesheets, own its milestones, and are the
  // only non-admin who can move a task assigned to another PM. Running the
  // delivery of a project without being able to write down what it needs is
  // not a permission boundary, it is an oversight.
  //
  // Scoped to the project in hand. Managing one project says nothing about
  // anybody else's, and there is no project to manage on a general task.
  if (project?.id != null && prisma.projectMember?.findFirst) {
    const managing = await prisma.projectMember.findFirst({
      where: { projectId: project.id, employeeId: actorEmployeeId, role: 'PROJECT_MANAGER' },
      select: { id: true },
    });
    if (managing) return true;
  }

  // Beyond those, it is a per-department flag.
  //
  // Deliberately NOT a name match on "Sales": this company runs "Sales",
  // "Field Sales" and "Sales & Marketing" as three separate departments, the
  // company seeder creates a fourth spelling, and a rename would silently
  // revoke access for everyone in it. Who may raise work is configuration, set
  // in Master Data, not a string comparison compiled into the server.
  const employee = await prisma.employee.findFirst({
    where: { id: actorEmployeeId, companyId },
    select: { department: { select: { canCreateTasks: true } } },
  });
  return employee?.department?.canCreateTasks === true;
}
