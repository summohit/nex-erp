import { distanceAllowingAccuracyM, MAX_ACCURACY_TOLERANCE_M } from './geo.util';

/**
 * People inside the office were told they were "12 km away": a phone that has
 * not got a GPS fix answers from mobile towers, and the reading was taken as
 * exact. The accuracy radius now counts in their favour — up to a cap.
 */
describe('distanceAllowingAccuracyM', () => {
  it('measures to the near edge of the accuracy circle', () => {
    // 150 m from the pin with a 60 m GPS margin: could be 90 m away.
    expect(distanceAllowingAccuracyM(0.15, 60)).toBeCloseTo(90);
  });

  it('never goes below zero', () => {
    expect(distanceAllowingAccuracyM(0.02, 50)).toBe(0);
  });

  it('caps the tolerance, so a vague guess cannot put anyone inside', () => {
    // A 12 km reading with a 5 km tower guess stays far outside a 100 m office.
    expect(distanceAllowingAccuracyM(12, 5000)).toBe(12000 - MAX_ACCURACY_TOLERANCE_M);
  });

  it('takes the point as exact when no accuracy is sent (older clients)', () => {
    expect(distanceAllowingAccuracyM(0.15, undefined)).toBeCloseTo(150);
    expect(distanceAllowingAccuracyM(0.15, NaN)).toBeCloseTo(150);
  });
});
