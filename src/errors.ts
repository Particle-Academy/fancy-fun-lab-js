/**
 * The refusals, by kind. Messages match laravel-fun-lab's word for word
 * (the shared tables compare them), which is why some read PHP-ish.
 */

/** Bad input: an unknown metric, a missing recipient, a setup field of the wrong type. PHP's InvalidArgumentException. */
export class InvalidArgumentError extends Error {
  override name = "InvalidArgumentError";
}

/**
 * An award refused by policy rather than by bad input. `kind` is one of
 * `cap_exceeded`, `pipeline_rejected`, `opted_out`. PHP's AwardRejectedException.
 */
export class AwardRejectedError extends InvalidArgumentError {
  override name = "AwardRejectedError";
  constructor(
    message: string,
    readonly kind: "cap_exceeded" | "pipeline_rejected" | "opted_out" | string = "rejected",
  ) {
    super(message);
  }
}

/**
 * A daily, weekly or monthly leaderboard asked for while the event log is off.
 * The log is the only record of WHEN XP was earned, and an empty board would
 * read exactly like a quiet week, so it is refused.
 */
export class PeriodLeaderboardUnavailableError extends InvalidArgumentError {
  override name = "PeriodLeaderboardUnavailableError";
}
