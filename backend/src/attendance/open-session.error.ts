import { BadRequestException } from '@nestjs/common';

/**
 * "You still have a session open from an earlier day."
 *
 * A typed error rather than a bare BadRequestException because the client has
 * to do something specific with it: the mobile app and the web clock widget
 * both need to offer "clock out from that day" instead of showing a red toast
 * the user can only stare at. Matching on a message string would break the
 * first time somebody rewords it, so the payload carries a stable `code` and
 * the date the open session belongs to.
 */
export class OpenSessionError extends BadRequestException {
  static readonly CODE = 'OPEN_PREVIOUS_SESSION';

  static forDate(date: Date): OpenSessionError {
    const day = date.toISOString().slice(0, 10);
    return new OpenSessionError({
      statusCode: 400,
      code: OpenSessionError.CODE,
      /** The day whose session is still open, as YYYY-MM-DD. */
      openSessionDate: day,
      message:
        'You have an open clock-in session from the previous shift. '
        + 'Please clock out from the previous shift before starting a new shift.',
      error: 'Bad Request',
    });
  }
}

/**
 * "This belongs to a previous day — tell us why you are closing it now."
 *
 * Also typed, and for the same reason: the client has to respond by opening a
 * prompt and retrying with `reason`, not by showing an error. `openSessionDate`
 * is the day being closed so the prompt can name it.
 */
export class LateClockOutError extends BadRequestException {
  static readonly CODE = 'LATE_CLOCK_OUT_REASON_REQUIRED';

  constructor(date: Date) {
    const day = date.toISOString().slice(0, 10);
    super({
      statusCode: 400,
      code: LateClockOutError.CODE,
      openSessionDate: day,
      message: `You are clocking out for ${day}, a previous day. Please provide a reason.`,
      error: 'Bad Request',
    });
  }
}

/**
 * A General Shift clock-in or clock-out outside the office radius (B3).
 *
 * Not a refusal: the client shows a reason box (with an optional attachment)
 * and sends the same request again with `outsideReason`, which is accepted and
 * left for an administrator to review.
 */
export class OutsideOfficeError extends BadRequestException {
  static readonly CODE = 'OUTSIDE_OFFICE_REASON_REQUIRED';

  constructor(direction: 'in' | 'out', branchName: string, distanceKm: number | null, radiusM: number) {
    const where = distanceKm == null
      ? 'Your location could not be read'
      : `You're ${distanceKm.toFixed(2)} km from ${branchName}`;
    super({
      statusCode: 400,
      code: OutsideOfficeError.CODE,
      direction,
      distanceKm,
      radiusM,
      branchName,
      message: `${where}, outside the ${radiusM} m office radius. `
        + `Give a reason to clock ${direction} — an administrator will review it.`,
      error: 'Bad Request',
    });
  }
}
