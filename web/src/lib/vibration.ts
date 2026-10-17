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
  const rattleDepth = new GainNode(ctx, { gain: 0.25 })
  const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 480, Q: 4 })
  const amp = new GainNode(ctx, { gain: 0 })
  const level = new GainNode(ctx, { gain: 0.75 })

  rattle.connect(rattleDepth).connect(level.gain)
  motor.connect(filter).connect(level).connect(amp).connect(ctx.destination)
  amp.gain.setValueAtTime(0, start)
  amp.gain.linearRampToValueAtTime(0.2, start + 0.03)
  amp.gain.setValueAtTime(0.2, end - 0.04)
  amp.gain.linearRampToValueAtTime(0, end)
  for (const osc of [motor, rattle]) {
    osc.start(start)
    osc.stop(end)
  }
  motor.addEventListener("ended", () => amp.disconnect())
}
