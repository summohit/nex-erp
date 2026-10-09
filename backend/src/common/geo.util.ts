/** Great-circle distance between two GPS coordinates, in kilometers. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * The most a phone's reported inaccuracy may count in someone's favour.
 *
 * A browser location comes with an accuracy radius: a GPS fix is good to a few
 * metres, a guess from mobile towers or Wi-Fi can be off by kilometres. Taking
 * the point as exact turned people sitting inside the office into "12 km away".
 * So the distance is measured to the nearest edge of that circle — but only up
 * to this cap, or a vague enough guess would put anybody anywhere "inside".
 */
export const MAX_ACCURACY_TOLERANCE_M = 300;

/** Distance in metres from the pin to the nearest point the person could be. */
export function distanceAllowingAccuracyM(distanceKm: number, accuracyM?: number | null): number {
  const metres = distanceKm * 1000;
  const acc = Number(accuracyM);
  const tolerance = Number.isFinite(acc) && acc > 0 ? Math.min(acc, MAX_ACCURACY_TOLERANCE_M) : 0;
  return Math.max(0, metres - tolerance);
}
