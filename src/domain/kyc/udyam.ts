// District 00 doesn't exist in reality, but every number in the data pack uses it.
const UDYAM_PATTERN = /^UDYAM-([A-Z]{2})-00-\d{7}$/;

// Codes as used in the data pack. KR for Karnataka differs from the usual KA.
const STATE_BY_CODE: Readonly<Record<string, string>> = {
  AP: 'Andhra Pradesh',
  BR: 'Bihar',
  DL: 'Delhi',
  GJ: 'Gujarat',
  KL: 'Kerala',
  KR: 'Karnataka',
  MH: 'Maharashtra',
  MP: 'Madhya Pradesh',
  PB: 'Punjab',
  RJ: 'Rajasthan',
  TN: 'Tamil Nadu',
  TS: 'Telangana',
  UP: 'Uttar Pradesh',
  WB: 'West Bengal',
};

export function isValidUdyamFormat(value: string): boolean {
  return UDYAM_PATTERN.test(value);
}

export function udyamStateName(value: string): string | null {
  const code = UDYAM_PATTERN.exec(value)?.[1];
  return code ? (STATE_BY_CODE[code] ?? null) : null;
}
