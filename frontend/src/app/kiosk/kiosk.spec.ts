import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Kiosk } from './kiosk';

describe('Kiosk', () => {
  let component: Kiosk;
  let fixture: ComponentFixture<Kiosk>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Kiosk],
    }).compileComponents();

    fixture = TestBed.createComponent(Kiosk);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
