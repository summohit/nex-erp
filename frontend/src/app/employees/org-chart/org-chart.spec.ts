import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrgChart } from './org-chart';

describe('OrgChart', () => {
  let component: OrgChart;
  let fixture: ComponentFixture<OrgChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrgChart],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgChart);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
