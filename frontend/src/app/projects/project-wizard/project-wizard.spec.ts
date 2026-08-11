import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProjectWizard } from './project-wizard';

describe('ProjectWizard', () => {
  let component: ProjectWizard;
  let fixture: ComponentFixture<ProjectWizard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectWizard],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectWizard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
