export interface DeviceProfile {
  /** URL slug, e.g. samsung-a16 */
  slug: string;
  label: string;
  /** Extra emulator command-line params (screen geometry etc.), passed to the
   * emulator container as EMULATOR_PARAMS. */
  emulatorParams: string;
}

export const DEVICES: Record<string, DeviceProfile> = {
  "pixel-7": {
    slug: "pixel-7",
    label: "Pixel 7",
    emulatorParams: "-skin 1080x2400 -dpi-device 416",
  },
  "samsung-a16": {
    slug: "samsung-a16",
    label: "Samsung Galaxy A16",
    emulatorParams: "-skin 720x1600 -dpi-device 264",
  },
  "pixel-tablet": {
    slug: "pixel-tablet",
    label: "Pixel Tablet",
    emulatorParams: "-skin 2560x1600 -dpi-device 276",
  },
};

export function getDevice(slug: string): DeviceProfile {
  const d = DEVICES[slug];
  if (!d) {
    throw Object.assign(
      new Error(`Unknown device "${slug}". Known: ${Object.keys(DEVICES).join(", ")}`),
      { statusCode: 400 },
    );
  }
  return d;
}
