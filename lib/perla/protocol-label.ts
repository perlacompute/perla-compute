/** Product labels for existing compatibility identifiers. Never used for verification. */
export function protocolLabel(identifier: string): string {
  if (identifier === 'perla-pearl-plain-v4') return 'Perla Matrix v4';
  if (identifier === 'perla-pearl-plain-v3') return 'Perla Matrix v3';
  return 'Unrecognized protocol';
}
