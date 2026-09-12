// Capabilities expose ranges, not a list of valid width/height/FPS combinations.
// Verify negotiated settings rather than assuming both range maxima form a mode.
export async function maximizeResolution(track, supported = {}, active = () => true) {
  let caps = {};
  try { caps = track.getCapabilities?.() || {}; } catch { /* Older WebKit. */ }
  const positive = n => Number.isFinite(n) && n > 0;
  const width = positive(caps.width?.max) ? caps.width.max : 32768;
  const height = positive(caps.height?.max) ? caps.height.max : 32768;
  const native = (caps.resizeMode ? caps.resizeMode.includes('none') : supported.resizeMode)
    ? { resizeMode: { exact: 'none' } } : {};
  let best = track.getSettings();
  const area = s => (s.width || 0) * (s.height || 0);
  async function attempt(constraints) {
    if (!active()) return;
    try {
      await track.applyConstraints({ ...native, ...constraints });
      const current = track.getSettings();
      if (area(current) >= area(best)) best = current;
    } catch (error) {
      // Unsupported combinations leave the existing stream usable.
      if (!['OverconstrainedError', 'NotSupportedError'].includes(error.name)) throw error;
    }
  }
  await attempt({ width: { ideal: width }, height: { ideal: height } });
  if (active() && positive(caps.width?.max) && best.width < width)
    await attempt({ width: { exact: width }, height: { ideal: height } });
  if (active() && positive(caps.height?.max) && best.height < height)
    await attempt({ width: { ideal: width }, height: { exact: height } });
  // Only request smooth playback after fixing the best verified dimensions.
  // A frame-rate preference must never trade away resolution.
  if (active() && positive(best.width) && positive(best.height)) {
    const dimensions = { width: { exact: best.width }, height: { exact: best.height } };
    await attempt({ ...dimensions, frameRate: { ideal: 30 } });
    if (area(track.getSettings()) < area(best)) await attempt(dimensions);
  }
  return track.getSettings();
}
