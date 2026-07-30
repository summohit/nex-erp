import { TestBed } from '@angular/core/testing';

import { Leaves } from './leaves';

describe('Leaves', () => {
  let service: Leaves;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Leaves);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
