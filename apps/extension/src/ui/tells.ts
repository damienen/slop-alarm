/**
 * Shared wording for a tell's strength, used by both the popup and the on-page card so a raw
 * percentage (which reads as false precision, e.g. "Inflated language 100%") never appears next
 * to a tell. The strength bar still encodes the exact value visually.
 */
export function tellStrengthLabel(strength: number): 'Strong' | 'Moderate' {
  return strength >= 0.85 ? 'Strong' : 'Moderate';
}
