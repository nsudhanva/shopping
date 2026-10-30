// These limits are the same as the Firestore rules, so Firestore does not reject a write.
export const maxItemTextLength = 120;
export const maxListNameLength = 60;
export const maxUnitLength = 16;

// Removes floating-point errors, for example 1.1 - 1 = 0.10000000000000009.
export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}
