import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectAiService } from './project-ai.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The duplicate endpoint must forward the acting employee (not the raw user
 * id), the caller's role and the source project id to the service — and fall
 * back to `sub` when a legacy token carries no employeeId.
 */
describe('ProjectsController (duplicate)', () => {
  let controller: ProjectsController;
  let projectsService: { duplicateProject: jest.Mock };

  beforeEach(async () => {
    projectsService = {
      duplicateProject: jest.fn(() => Promise.resolve({ id: 89, key: 'CES/0926/05' })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        {
          provide: ProjectAiService,
          useValue: { analyzeProjectDocuments: jest.fn() },
        },
        // AuthGuard sits on the whole controller, so its own dependencies
        // have to resolve even though these unit tests call methods directly.
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: PrismaService,
          useValue: { employee: { findFirst: jest.fn() } },
        },
      ],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
  });

  const data = { name: 'Copy', dateMode: 'KEEP' };

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes companyId, employeeId, role and payload straight through', async () => {
    const req = {
      user: { companyId: 1, employeeId: 51, role: 'SUPERADMIN', sub: 1 },
    };
    await controller.duplicateProject(req, 84, data);
    expect(projectsService.duplicateProject).toHaveBeenCalledWith(1, 51, 'SUPERADMIN', 84, data);
  });

  it('falls back to req.user.sub when the token has no employeeId', async () => {
    const req = {
      user: { companyId: 2, role: 'ADMIN', sub: 7 },
    };
    await controller.duplicateProject(req, 12, data);
    expect(projectsService.duplicateProject).toHaveBeenCalledWith(2, 7, 'ADMIN', 12, data);
  });

  it('returns whatever the service produces', async () => {
    const result = await controller.duplicateProject(
      { user: { companyId: 1, employeeId: 1, role: 'SUPERADMIN', sub: 1 } },
      84,
      data,
    );
    expect(result).toEqual({ id: 89, key: 'CES/0926/05' });
  });
});