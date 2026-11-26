// Progress, in percent, cumulative (glossary). Shared because both modules use it: a task's approved progress and a
// report item's reported progress (research R3, feature 002).

export const MIN_PROGRESS = 0;
export const MAX_PROGRESS = 100;

declare const progressBrand: unique symbol;

/** An integer from 0 to 100. Branded so an unchecked number cannot pass as one. */
export type Progress = number & { readonly [progressBrand]: true };

export function isProgress(value: number): value is Progress {
  return Number.isInteger(value) && value >= MIN_PROGRESS && value <= MAX_PROGRESS;
}

/**
 * For values already guaranteed valid, such as a column with a CHECK constraint. Rules that must name what is wrong
 * (BR-5) check with isProgress and throw their own error instead.
 */
export function toProgress(value: number): Progress {
  if (!isProgress(value)) {
    throw new RangeError(`Progress must be an integer from ${MIN_PROGRESS} to ${MAX_PROGRESS}, got ${value}.`);
  }
  return value;
}
