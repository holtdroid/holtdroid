let context: AudioContext | null = null

export function buzz(durationMs: number) {
  context ??= new AudioContext()
  const ctx = context
  void ctx.resume()
  const seconds = Math.min(3000, Math.max(150, durationMs || 600)) / 1000
  const start = ctx.currentTime + 0.01
  const end = start + seconds

  const motor = new OscillatorNode(ctx, { type: "sawtooth", frequency: 165 })
  const rattle = new OscillatorNode(ctx, { type: "square", frequency: 23 })
  const rattleSmooth = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 90 })
  const rattleDepth = new GainNode(ctx, { gain: 0.25 })
  const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 440, Q: 2.5 })
  const highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 70 })
  const amp = new GainNode(ctx, { gain: 0 })
  const level = new GainNode(ctx, { gain: 0.75 })

  rattle.connect(rattleSmooth).connect(rattleDepth).connect(level.gain)
  motor.connect(filter).connect(highpass).connect(level).connect(amp).connect(ctx.destination)
  amp.gain.setValueAtTime(0, start)
  amp.gain.linearRampToValueAtTime(0.13, start + 0.03)
  amp.gain.setValueAtTime(0.13, end - 0.04)
  amp.gain.linearRampToValueAtTime(0, end)
  for (const osc of [motor, rattle]) {
    osc.start(start)
    osc.stop(end)
  }
  motor.addEventListener("ended", () => amp.disconnect())
}
