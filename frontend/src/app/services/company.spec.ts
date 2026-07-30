import { TestBed } from '@angular/core/testing';

import { Company } from './company';

describe('Company', () => {
  let service: Company;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Company);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
