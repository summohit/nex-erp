import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AttendanceLeave } from './attendance-leave';

describe('AttendanceLeave', () => {
  let component: AttendanceLeave;
  let fixture: ComponentFixture<AttendanceLeave>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AttendanceLeave],
    }).compileComponents();

    fixture = TestBed.createComponent(AttendanceLeave);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
