// Global variables
//
// === ANTI-CLIPPING & ANTI-POP OPTIMIZATIONS ===
// This file has been optimized to prevent clipping, pops, and clicks through:
// 
// 1. GAIN STAGING: preMaster (-10dB) + DC block before dynamics chain
// 2. HEADROOM: Limiter at -6dB, compressor at 6ms attack, reduced wet/feedback values
// 3. TRANSIENT HANDLING: Minimum 12ms attack for bells, 50ms for choir
// 4. PARAMETER RAMPING: All pitch, pan, and playback rate changes use crossfades (30-60ms)
// 5. FIXED GRAPH: Static band filters morph instead of being rebuilt during playback
// 6. VOICE MANAGEMENT: Reduced polyphony (drone: 6, bell: 5), shorter overlaps (10-12m)
// 7. NOISE ISOLATION: Noise source stays running, only gain envelopes it (engine-compatible)
// 8. STATIC ROUTING: Engine gets exclusive path, direct outputs disconnected (no double-sum)
// 9. CONTEXT TUNING: Balanced latency hint with 40ms lookahead for mobile stability
// 10. BPM RAMPING: Uses AudioParam time directly (not Transport scheduling)
// 11. PROPER DISPOSAL: Bell synth nodes attached for cleanup, choir widener API-safe
// 12. DIAGNOSTICS: Level meter logs high signals, seed exposed for reproducibility
//
// Signal chain: [sources] -> preMaster -> dcBlock -> compressor -> tailEQ -> limiter -> destination

const volumeLimit = -6;

// Static routing mode: "free" = self-routed to preMaster, "engine" = only via rhythm engine
const STATIC_MODE = "engine"; // or "free"

// Audio layer configuration - can be modified to enable/disable layers and adjust volumes
const AUDIO_CONFIG = {
  drone: {
    enabled: true,
    volume: -10
  },
  bell: {
    enabled: true,
    volume: -14
  },
  static: {
    enabled: true,
    volume: -24
  },
  choir: {
    enabled: false,
    volume: -32
  }
};

// Legacy constants for backward compatibility (will use config values)
const DRONE_VOLUME = AUDIO_CONFIG.drone.volume;
const BELL_VOLUME = AUDIO_CONFIG.bell.volume;
const STATIC_VOLUME = AUDIO_CONFIG.static.volume;
const CHOIR_VOLUME = AUDIO_CONFIG.choir.volume;

// Function to update audio configuration
function updateAudioConfig(layer, enabled = null, volume = null) {
  if (!AUDIO_CONFIG[layer]) {
    debugError(`Unknown audio layer: ${layer}`);
    return false;
  }

  if (enabled !== null) {
    AUDIO_CONFIG[layer].enabled = Boolean(enabled);
  }

  if (volume !== null) {
    AUDIO_CONFIG[layer].volume = Number(volume);
  }

  debugLog(`Audio config updated for ${layer}:`, AUDIO_CONFIG[layer]);

  // Update legacy constants to reflect new values
  switch(layer) {
    case 'drone':
      // Update the constant value (this affects any new synths created)
      Object.defineProperty(window, 'DRONE_VOLUME', {
        value: AUDIO_CONFIG.drone.volume,
        writable: false,
        configurable: true
      });
      // If drone synth exists and is playing, update its volume
      if (droneSynth && droneSynth.volume) {
        droneSynth.volume.value = AUDIO_CONFIG.drone.volume;
      }
      break;
    case 'bell':
      Object.defineProperty(window, 'BELL_VOLUME', {
        value: AUDIO_CONFIG.bell.volume,
        writable: false,
        configurable: true
      });
      if (bellSynth && bellSynth.volume) {
        bellSynth.volume.value = AUDIO_CONFIG.bell.volume;
      }
      break;
    case 'static':
      Object.defineProperty(window, 'STATIC_VOLUME', {
        value: AUDIO_CONFIG.static.volume,
        writable: false,
        configurable: true
      });
      if (staticSynth && staticSynth.gain) {
        // Static synth uses gain instead of volume
        staticSynth.gain.gain.value = Tone.dbToGain(AUDIO_CONFIG.static.volume);
      }
      break;
    case 'choir':
      Object.defineProperty(window, 'CHOIR_VOLUME', {
        value: AUDIO_CONFIG.choir.volume,
        writable: false,
        configurable: true
      });
      if (choirSynth && choirSynth.volume) {
        choirSynth.volume.value = AUDIO_CONFIG.choir.volume;
      }
      break;
  }

  return true;
}

// Function to get current audio configuration
function getAudioConfig() {
  return { ...AUDIO_CONFIG };
}

// Debug flag for production logging control
const DEBUG = true;

// Debug logging functions
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugError(...args) {
  // Always show errors, even in production
  console.error(...args);
}

// Dynamic BPM system for microtonal tempo variations
const BPM_CONFIG = {
  baseBPM: 60,
  minBPM: 30,
  maxBPM: 120,
  transitionTimeMin: 30, // seconds
  transitionTimeMax: 120, // seconds
  holdTimeMin: 60, // seconds
  holdTimeMax: 300 // seconds
};

let currentBPM = BPM_CONFIG.baseBPM;
let bpmIntervalId = null;

// Returns a timestamp in the Transport frame if it's running; otherwise falls back to audio-time.
function transportNow() {
  return Tone.getTransport().state === "started"
    ? Tone.getTransport().seconds
    : Tone.now();
}

// Helper function to ramp BPM safely using AudioParam time
function rampBPM(target, seconds) {
  const bpm = Tone.getTransport().bpm;
  const now = Tone.now();
  bpm.cancelScheduledValues(now);
  bpm.setValueAtTime(bpm.value, now);
  bpm.linearRampToValueAtTime(target, now + seconds);
}

// Function to slowly change BPM with randomized timing
function startDynamicBPM() {
  if (bpmIntervalId) return; // Already running

  const changeBPM = () => {
    const targetBPM = seededRandom.nextFloat(BPM_CONFIG.minBPM, BPM_CONFIG.maxBPM);
    const transitionTime = seededRandom.nextFloat(BPM_CONFIG.transitionTimeMin, BPM_CONFIG.transitionTimeMax);

    debugLog(`🎵 BPM changing from ${currentBPM.toFixed(1)} to ${targetBPM.toFixed(1)} over ${transitionTime.toFixed(1)}s`);

    // Ramp BPM directly using AudioContext time (not Transport time)
    rampBPM(targetBPM, transitionTime);

    currentBPM = targetBPM;

    // hold + next change
    const holdTime = seededRandom.nextFloat(BPM_CONFIG.holdTimeMin, BPM_CONFIG.holdTimeMax);
    bpmIntervalId = setTimeout(changeBPM, (transitionTime + holdTime) * 1000);
  };

  // Start the dynamic BPM system
  changeBPM();
}

// Function to stop dynamic BPM changes
function stopDynamicBPM() {
  if (bpmIntervalId) {
    clearTimeout(bpmIntervalId);
    bpmIntervalId = null;
  }
  rampBPM(BPM_CONFIG.baseBPM, 0.05);
  currentBPM = BPM_CONFIG.baseBPM;
}

// Simple seedable PRNG for reproducible randomness (xorshift-based)
class SeededRandom {
  // constructor(seed = Math.floor(Math.random() * 0xFFFFFFFF)) {
  constructor(seed = Math.floor(console.time() * Date.now())) {
    this.state = seed;
  }

  // Xorshift32 algorithm
  next() {
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 0xFFFFFFFF; // Convert to [0, 1)
  }

  // Convenience methods
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min, max) {
    return this.next() * (max - min) + min;
  }

  random() {
    return this.next();
  }
}

// Global PRNG instance (can be seeded for reproducible runs)
let currentSeed = Math.floor(Math.random() * 0xFFFFFFFF);
let seededRandom = new SeededRandom(currentSeed);
debugLog('🎲 Initial random seed:', currentSeed, '(call seedRandom(seed) to reproduce)');

// Function to seed the random number generator
function seedRandom(seed) {
  if (seed === undefined) {
    seed = Date.now(); // Use timestamp if no seed provided
  }
  currentSeed = seed;
  seededRandom = new SeededRandom(seed);
  debugLog('🎲 Random seed set to:', seed, '(save this for reproducible sessions)');
  return seed;
}

// Function to get the current seed
function getCurrentSeed() {
  return currentSeed;
}

// Dynamic BPM system is initialized when play() is called

// iOS detection is now handled by audio-control.js

// Simplified drone synth without offline rendering - now with randomized parameters
function createDroneSynth() {
  // Randomize reverb settings for unique atmosphere each time
  const reverbDecay = 6 + seededRandom.nextFloat(0, 8); // 6-14 seconds
  const reverbWet = 0.4 + seededRandom.nextFloat(0, 0.4); // 0.4-0.8 wet/dry mix

  const reverb = new Tone.Reverb({
    decay: reverbDecay,
    wet: reverbWet
  });

  // Randomize chorus for subtle modulation variations
  const chorusFreq = 0.2 + seededRandom.nextFloat(0, 0.3); // 0.2-0.5 Hz
  const chorusDepth = 0.5 + seededRandom.nextFloat(0, 0.4); // 0.5-0.9 depth
  const chorusWet = Math.min(0.65, 0.7 + seededRandom.nextFloat(0, 0.25)); // Capped at 0.65 to prevent hot levels

  const chorus = new Tone.Chorus({
    frequency: chorusFreq,
    depth: chorusDepth,
    wet: chorusWet
  }).connect(reverb);

  // Randomize delay for varied echo patterns
  const delayTimeOptions = ["2n", "2n.", "4n", "4n.", "8n", "8n.", "16n", "16n.", "32n", "32n.", "64n", "64n."];
  const randomDelayTime = delayTimeOptions[seededRandom.nextInt(0, delayTimeOptions.length - 1)];
  const delayFeedback = Math.min(0.4, 0.2 + seededRandom.nextFloat(0, 0.3)); // Capped at 0.4 to prevent runaway feedback
  const delayWet = Math.min(0.6, 0.5 + seededRandom.nextFloat(0, 0.3)); // Capped at 0.6

  const delay = new Tone.FeedbackDelay({
    delayTime: randomDelayTime,
    feedback: delayFeedback,
    wet: delayWet
  }).connect(chorus);

  const synth = new Tone.PolySynth(Tone.FMSynth, {
    maxPolyphony: 6 // Reduced to avoid voice stealing and CPU spikes
  }).connect(delay);

  // Connect the final output to the premaster bus
  reverb.connect(preMaster); // reverb -> preMaster -> dcBlock -> compressor -> tailEQ -> limiter -> destination

  // Randomize synth parameters for unique timbres
  const randomHarmonicity = 0.3 + seededRandom.nextFloat(0, 0.5); // 0.3-0.8
  const randomModulationIndex = 0.5 + seededRandom.nextFloat(0, 1.5); // 0.5-2.0
  const oscillatorTypes = ["sine", "triangle", "sawtooth"];
  const randomOscType = oscillatorTypes[seededRandom.nextInt(0, oscillatorTypes.length - 1)];

  synth.set({
    harmonicity: randomHarmonicity,
    modulationIndex: randomModulationIndex,
    oscillator: { type: randomOscType },
    envelope: {
      attack: 3 + seededRandom.nextFloat(0, 4),      // 3-7 seconds attack (proportional to longer durations)
      decay: 1 + seededRandom.nextFloat(0, 2),       // 1-3 seconds decay
      sustain: 0.8 + seededRandom.nextFloat(0, 0.15), // 0.8-0.95 sustain
      release: 5 + seededRandom.nextFloat(0, 6)      // 5-11 seconds release (proportional to longer durations)
    },
    modulation: { type: randomOscType },
    modulationEnvelope: {
      attack: 4 + seededRandom.nextFloat(0, 4),       // 4-8 seconds
      decay: 1 + seededRandom.nextFloat(0, 2),        // 1-3 seconds
      sustain: 0.8 + seededRandom.nextFloat(0, 0.15), // 0.8-0.95
      release: 6 + seededRandom.nextFloat(0, 6)       // 6-12 seconds
    }
  });

  // Set volume directly on the synth object, not in config
  synth.volume.value = DRONE_VOLUME;  // Equal volume across all platforms

  return synth;
}

// Simplified bell synth with distortion - now with randomized parameters
function createBellSynth() {
  // Randomize reverb settings for unique ethereal atmosphere
  const reverbDecay = 8 + seededRandom.nextFloat(0, 8); // 8-16 seconds
  const reverbWet = 0.5 + seededRandom.nextFloat(0, 0.4); // 0.5-0.9 wet/dry mix

  const reverb = new Tone.Reverb({
    decay: reverbDecay,
    wet: reverbWet
  });

  // Create alternative distortion using WaveShaper (doesn't require AudioWorklet)
  const distortionAmount = 0.4 + seededRandom.nextFloat(0, 0.6); // 0.4-1.0 distortion
  const distortionWet = 0.5 + seededRandom.nextFloat(0, 0.4); // 0.5-0.9 wet

  // Create a wave shaper for distortion effect
  const distortionWaveShaper = new Tone.WaveShaper((val) => {
    // Simple distortion curve - can be made more complex
    return Math.tanh(val * distortionAmount * 3);
  });

  // Create dry/wet mix for the distortion effect
  const distortionDry = new Tone.Gain(1 - distortionWet);
  const distortionWetGain = new Tone.Gain(distortionWet);

  // Connect dry path: input -> dry -> output
  distortionDry.connect(reverb);

  // Connect wet path: input -> waveshaper -> wet gain -> output
  distortionWaveShaper.connect(distortionWetGain);
  distortionWetGain.connect(reverb);

  // Create alternative to BitCrusher using filters and noise modulation
  const bitCrushBits = 4 + seededRandom.nextInt(0, 8); // 4-12 bits
  const bitCrushWet = 0.2 + seededRandom.nextFloat(0, 0.4); // 0.2-0.6 wet

  // Simulate bit crushing with aggressive filtering
  const lowpassFreq = 200 + (bitCrushBits * 200); // Lower bits = lower frequency
  const bitCrushFilter = new Tone.Filter({
    type: "lowpass",
    frequency: lowpassFreq,
    rolloff: -24
  });

  // Create dry/wet mix for the bit crush effect
  const bitCrushDry = new Tone.Gain(1 - bitCrushWet);
  const bitCrushWetGain = new Tone.Gain(bitCrushWet);

  // Connect dry path: input -> dry -> output
  bitCrushDry.connect(distortionDry);

  // Connect wet path: input -> bitcrush filter -> wet gain -> output
  bitCrushFilter.connect(bitCrushWetGain);
  bitCrushWetGain.connect(distortionDry);

  // Randomize chebyshev waveshaper for varied harmonic content
  const chebyshevOrder = 15 + seededRandom.nextInt(0, 10); // Capped at 25 to reduce CPU load
  const chebyshevWet = 0.3 + seededRandom.nextFloat(0, 0.4); // 0.3-0.7 wet

  const chebyshev = new Tone.Chebyshev({
    order: chebyshevOrder,
    wet: chebyshevWet
  });

  // Connect chebyshev to the bit crush dry/wet mix
  chebyshev.connect(bitCrushDry);

  // Randomize delay for varied echo patterns
  const bellDelayTimeOptions = ["2n", "2n.", "4n", "4n.", "8n", "8n.", "16n", "16n.", "32n", "32n.", "64n", "64n."];
  const randomBellDelayTime = bellDelayTimeOptions[seededRandom.nextInt(0, bellDelayTimeOptions.length - 1)];
  const bellDelayFeedback = Math.min(0.85, 0.7 + seededRandom.nextFloat(0, 0.25)); // Capped at 0.85
  const bellDelayWet = Math.min(0.75, 0.8 + seededRandom.nextFloat(0, 0.2)); // Capped at 0.75

  const delay = new Tone.FeedbackDelay({
    delayTime: randomBellDelayTime,
    feedback: bellDelayFeedback,
    wet: bellDelayWet
  }).connect(chebyshev);

  const synth = new Tone.PolySynth(Tone.FMSynth, {
    maxPolyphony: 5 // Reduced to avoid voice stealing and CPU spikes
  }).connect(delay);

  // Connect the final output to the premaster bus
  reverb.connect(preMaster); // reverb -> preMaster -> dcBlock -> compressor -> tailEQ -> limiter -> destination

  // Randomize synth parameters for unique timbres
  const randomBellHarmonicity = 1.5 + seededRandom.nextFloat(0, 2); // 1.5-3.5
  const randomBellModulationIndex = 4 + seededRandom.nextFloat(0, 8); // 4-12
  const bellOscillatorTypes = ["sine", "square", "sawtooth", "triangle"];
  const randomBellOscType = bellOscillatorTypes[seededRandom.nextInt(0, bellOscillatorTypes.length - 1)];
  const randomBellModType = bellOscillatorTypes[seededRandom.nextInt(0, bellOscillatorTypes.length - 1)];

  synth.set({
    harmonicity: randomBellHarmonicity,
    modulationIndex: randomBellModulationIndex,
    oscillator: { type: randomBellOscType },
    envelope: {
      attack: 0.012 + seededRandom.nextFloat(0, 0.015),   // Raised minimum to 12ms to prevent clicks
      decay: 0.22 + seededRandom.nextFloat(0, 0.28),      // 0.22-0.5 seconds
      sustain: 0.45 + seededRandom.nextFloat(0, 0.35),    // 0.45-0.8 sustain
      release: 2.2 + seededRandom.nextFloat(0, 2.8)       // 2.2-5 seconds
    },
    modulation: { type: randomBellModType },
    modulationEnvelope: {
      attack: 0.012 + seededRandom.nextFloat(0, 0.015),   // Raised minimum to 12ms to prevent clicks
      decay: 0.16 + seededRandom.nextFloat(0, 0.24),      // 0.16-0.4 seconds
      sustain: 0.72 + seededRandom.nextFloat(0, 0.23),    // 0.72-0.95 sustain
      release: 2.2 + seededRandom.nextFloat(0, 2.8)       // 2.2-5 seconds
    }
  });

  // Set volume directly on the synth object, not in config
  synth.volume.value = BELL_VOLUME;  // Equal volume across all platforms

  // Attach nodes to synth for proper disposal
  synth._nodes = {
    reverb,
    distortionWaveShaper,
    distortionDry,
    distortionWetGain,
    bitCrushFilter,
    bitCrushDry,
    bitCrushWetGain,
    chebyshev,
    delay
  };

  // Add dispose method for the new components
  const originalDispose = synth.dispose.bind(synth);
  synth.dispose = function() {
    Object.values(this._nodes).forEach(n => n?.dispose?.());
    // Call original PolySynth dispose
    originalDispose();
  };

  return synth;
}

// === Choir instrument ===
// Based on a shared formant bank with per-voice PWM oscillators, noise breath, and amplitude envelopes.
function createChoirSynth({
  voices = 8,
  vowel = "ah",
  register = "bass"
} = {}) {
  // Choir output bus (pre-effects)
  const choirBus = new Tone.Gain(1);

  // ---- Scream mode processing (neutral by default) ----
  const screamPreHP = new Tone.Filter({ type: "highpass", frequency: 220, Q: 0.7 }); // clears mud for high-intensity tones
  const screamDrive = new Tone.WaveShaper(v => Math.tanh(v * 6)); // saturation; amount controlled by .wet
  const screamDriveWet = new Tone.Gain(0.0); // 0..1 morphs from clean to driven
  const screamDriveDry = new Tone.Gain(1.0);

  // singer's formant bump (broad peak around 3k)
  const singersFormant = new Tone.Filter({ type: "peaking", frequency: 3000, Q: 1.2, gain: 0 }); // gain set via API

  // add rasp: broadband noise, high-passed and envelope-gated
  const raspNoise = new Tone.Noise({ type: "white" });
  const raspHP = new Tone.Filter({ type: "highpass", frequency: 2500, Q: 0.7 });
  const raspGain = new Tone.Gain(0.0); // 0..~0.4 in scream
  raspNoise.connect(raspHP).connect(raspGain);

  // spatial + tail
  const widener = new (Tone.StereoWidener || Tone.Gain)(Tone.StereoWidener ? { width: 0.7 } : 1);
  const hall = new Tone.Reverb({ decay: 8 + seededRandom.nextFloat(0, 6), wet: 0.6 });
  const choirTailEQ = new Tone.Filter({ type: "lowpass", frequency: 6000 });

  // Routing: dry/drive blend -> singer's bump -> width -> verb -> tailEQ -> preMaster
  // Also sum in rasp into the chain just before width
  const postBlend = new Tone.Gain(1);
  choirBus.connect(screamPreHP);
  screamPreHP.connect(screamDriveDry);
  screamPreHP.connect(screamDrive);
  screamDrive.connect(screamDriveWet);

  // sum dry+wet drive
  const driveSum = new Tone.Gain(1);
  screamDriveDry.connect(driveSum);
  screamDriveWet.connect(driveSum);

  // singer's formant and rasp injection
  driveSum.connect(singersFormant);
  raspGain.connect(singersFormant);

  // width & space
  singersFormant.connect(widener);
  widener.connect(hall);
  hall.connect(choirTailEQ);
  choirTailEQ.connect(preMaster);

  // Shared formant bank per vowel and register
  // Numbers are center frequencies with light per-voice wobble applied via LFOs
  // Tables adapted from common vowel formant references for singing
  const FORMANTS = {
    bass: {
      ah: [
        { f: 600,  q: 8,  gain: 0 },
        { f: 1040, q: 8,  gain: -1 },
        { f: 2250, q: 8,  gain: -2 },
        { f: 2450, q: 9,  gain: -3 },
        { f: 2750, q: 9,  gain: -6 }
      ],
      oo: [
        { f: 300,  q: 8,  gain: 0 },
        { f: 870,  q: 8,  gain: -2 },
        { f: 2240, q: 8,  gain: -4 },
        { f: 2600, q: 9,  gain: -6 },
        { f: 2900, q: 9,  gain: -8 }
      ],
      eh: [
        { f: 530,  q: 8,  gain: 0 },
        { f: 1840, q: 8,  gain: -1 },
        { f: 2480, q: 9,  gain: -3 },
        { f: 2900, q: 9,  gain: -5 },
        { f: 3350, q: 10, gain: -6 }
      ]
    },
    tenor: {
      ah: [
        { f: 650,  q: 8,  gain: 0 },
        { f: 1080, q: 8,  gain: -1 },
        { f: 2650, q: 9,  gain: -2 },
        { f: 2900, q: 9,  gain: -3 },
        { f: 3250, q: 10, gain: -6 }
      ]
    }
  };

  const bank = (FORMANTS[register] && FORMANTS[register][vowel]) ? FORMANTS[register][vowel] : FORMANTS.bass.ah;

  // Build shared formant filters fed by a sum bus of all voices
  const preFormantSum = new Tone.Gain(1).connect(choirBus);
  // Split into parallel bandpass branches with individual gains, then re-sum
  const formantSplits = [];
  const formantOutSum = new Tone.Gain(1);
  formantOutSum.disconnect();

  // Rebuild routing: preFormantSum -> N bandpass branches -> sum -> choirBus
  preFormantSum.disconnect();
  const branchSum = new Tone.Gain(1);
  const branches = bank.map(({ f, q, gain }) => {
    const bp = new Tone.Filter({ type: "bandpass", frequency: f, Q: q });
    const g = new Tone.Gain(Tone.dbToGain(gain));
    const lfo = new Tone.LFO({
      frequency: 0.3 + seededRandom.nextFloat(0, 0.7),
      min: f * 0.96,
      max: f * 1.04,
      phase: seededRandom.nextFloat(0, 360)
    }).start();
    lfo.connect(bp.frequency);
    formantSplits.push({ bp, g, lfo });
    // Connect branch
    const tap = new Tone.Gain(1);
    preFormantSum.connect(tap);
    tap.connect(bp);
    bp.connect(g);
    g.connect(branchSum);
    return tap;
  });

  // Final sum of branches goes to choirBus effects chain
  branchSum.connect(choirBus);

  // Per-voice builders
  const voicesArr = [];
  for (let i = 0; i < voices; i++) {
    const detCents = (seededRandom.nextFloat(0, 1) - 0.5) * 16; // ±8 cents
    const width = 0.55 + seededRandom.nextFloat(0, 0.25);       // PWM width 0.55..0.8
    const breathLevel = 0.06 + seededRandom.nextFloat(0, 0.06); // subtle breath
    const attack = Math.max(0.05, 0.35 + seededRandom.nextFloat(0, 0.5)); // Minimum 50ms to prevent clicks
    const decay = 0.4 + seededRandom.nextFloat(0, 0.3);
    const sustain = 0.6 + seededRandom.nextFloat(0, 0.25);
    const release = 0.9 + seededRandom.nextFloat(0, 0.8);

    // Source: PWM pulse plus a little noise
    const osc = new Tone.OmniOscillator({
      type: "pulse",
      width,
      phase: seededRandom.nextFloat(0, 360)
    });

    // Gentle vibrato per voice
    const vib = new Tone.LFO({
      frequency: 5.5 + seededRandom.nextFloat(0, 1.5),
      min: -5,
      max: 5,
      phase: seededRandom.nextFloat(0, 360)
    }).start();
    vib.connect(osc.detune);

    // Fast, shallow jitter (disabled until scream mode)
    const jitterLFO = new Tone.LFO({
      frequency: 20 + seededRandom.nextFloat(0, 15),  // 20–35 Hz "roughness"
      min: -30,  // cents
      max: 30,
      phase: seededRandom.nextFloat(0, 360)
    });
    jitterLFO.connect(osc.detune);
    jitterLFO.stop(); // only start in scream mode

    // Breath noise
    const noise = new Tone.Noise({ type: "white", volume: Tone.gainToDb(breathLevel) });

    // Simple lowpass to soften the buzz before formants
    const soften = new Tone.Filter({ type: "lowpass", frequency: 6000, Q: 0.5 });

    // Voice amp env and per-voice gain
    const env = new Tone.AmplitudeEnvelope({ attack, decay, sustain, release });
    const voiceGain = new Tone.Gain(Tone.dbToGain(-3 + seededRandom.nextFloat(0, 2)));

    // Mix osc and noise, then into soft LPF, then to preFormantSum
    const mix = new Tone.Gain(1);
    const noiseGain = new Tone.Gain(breathLevel);
    osc.connect(mix);
    noise.connect(noiseGain);
    noiseGain.connect(mix);
    mix.connect(soften);
    soften.connect(env);
    env.connect(voiceGain);
    voiceGain.connect(preFormantSum);

    voicesArr.push({ osc, vib, jitterLFO, noise, env, voiceGain, soften, mix, noiseGain, detCents });
  }

  debugLog('🎵 Choir synth: Starting all oscillators and noise sources...');
  // Start all oscillators immediately to avoid scheduling issues
  // (Tone.js requires oscillators to be started before parameter changes can be scheduled)
  voicesArr.forEach(voice => {
    if (voice.osc.state !== "started") {
      voice.osc.start();
    }
    if (voice.noise.state !== "started") {
      voice.noise.start();
    }
  });
  debugLog('✅ Choir synth: All oscillators and noise sources started');

  // Scream mode variables (need to be in scope for API methods)
  let screamEnabled = false,
      screamIntensity = 0.0;

  // Public API similar to PolySynth
  const api = {
    volume: new Tone.Gain(1), // shim to mirror .volume.value interface
    triggerAttackRelease(notesOrHz, dur, when = Tone.getTransport().seconds) {
      const freqs = (Array.isArray(notesOrHz) ? notesOrHz : [notesOrHz]).map(n => {
        const f = typeof n === "number" ? n : Tone.Frequency(n).toFrequency();
        return f;
      });

      // Voice assignment round-robin
      let v = 0;
      const dSec = typeof dur === "number" ? dur : Tone.Time(dur).toSeconds();
      freqs.forEach(f0 => {
        voicesArr.forEach((voice, idx) => {
          const slightSpread = (seededRandom.nextFloat(0, 1) - 0.5) * 6; // extra ±3 cents per event
          const detTotal = voice.detCents + slightSpread;
          voice.osc.frequency.setValueAtTime(f0, when);
          voice.osc.detune.setValueAtTime(detTotal, when);
        });
        // Stagger choir entrances a touch
        const stagger = when + seededRandom.nextFloat(0, 0.12);
        voicesArr.forEach((voice, idx) => {
          // Only a subset sings each note to avoid mush
          if (seededRandom.nextFloat(0, 1) < 0.7) {
            voice.env.triggerAttack(stagger);
            voice.env.triggerRelease(stagger + dSec);
          }
        });
        v = (v + 1) % voicesArr.length;
      });
    },
    setVowel(nextVowel = "ah", nextRegister = register) {
      const newBank = (FORMANTS[nextRegister] && FORMANTS[nextRegister][nextVowel])
        ? FORMANTS[nextRegister][nextVowel]
        : FORMANTS.bass.ah;

      debugLog('🎵 Choir setVowel: Changing from', register + '/' + vowel, 'to', nextRegister + '/' + nextVowel, 'with', newBank.length, 'formants');
      formantSplits.forEach((split, i) => {
        const spec = newBank[i % newBank.length];
        split.lfo.min = spec.f * 0.96;
        split.lfo.max = spec.f * 1.04;
        split.bp.Q.value = spec.q;
        split.g.gain.value = Tone.dbToGain(spec.gain);
      });
    },

    // Scream mode methods
    setScream: (enabled = true, { intensity = 0.8, registerHint = "tenor" } = {}) => {
      screamEnabled = !!enabled;
      screamIntensity = Math.max(0, Math.min(1, intensity));

      if (screamEnabled) {
        debugLog('🎵 Choir setScream: ACTIVATING scream mode', { intensity, registerHint });
        // push the vowel bank toward a brighter register if available
        api.setVowel("ah", registerHint);
        // more drive + singer's formant gain + rasp based on intensity
        screamDriveWet.gain.rampTo(Math.min(1, 0.15 + intensity * 0.85), 0.05);
        singersFormant.gain.rampTo(4 + intensity * 10, 0.05); // +4 to +14 dB (AudioParam)
        raspGain.gain.rampTo(Math.min(0.45, intensity * 0.45), 0.03);
        // start rasp noise source
        if (raspNoise.state !== "started") raspNoise.start();
        // brighten the reverb a touch and widen more (Tone v15.1.22 Params)
        widener.width.rampTo(Math.min(1, 0.7 + intensity * 0.25), 0.2);
        hall.wet.rampTo(Math.min(1, 0.6 + intensity * 0.25), 0.2);
        choirTailEQ.frequency.rampTo(8000 + intensity * 4000, 0.2);
        // start jitter
        voicesArr.forEach(v => v.jitterLFO.start());
        // slight overall level bump for presence (Limiter will protect)
        const newVolume = Math.min(api.volume.value + 2, CHOIR_VOLUME + 4);
        api.volume.value = newVolume;
        debugLog('🎵 Choir setScream: Volume boosted to', newVolume, 'dB');
      } else {
        debugLog('🎵 Choir setScream: DEACTIVATING scream mode');
        // disable scream voicing
        screamDriveWet.gain.rampTo(0.0, 0.1);
        singersFormant.gain.rampTo(0, 0.1); // AudioParam
        raspGain.gain.rampTo(0.0, 0.1);
        // stop rasp noise source
        if (raspNoise.state === "started") raspNoise.stop();
        // restore neutral settings (Tone v15.1.22 Params)
        widener.width.rampTo(0.7, 0.3);
        hall.wet.rampTo(0.6, 0.3);
        choirTailEQ.frequency.rampTo(6000, 0.3);
        // stop jitter
        voicesArr.forEach(v => v.jitterLFO.stop());
        api.volume.value = CHOIR_VOLUME;
        debugLog('🎵 Choir setScream: Volume restored to', CHOIR_VOLUME, 'dB');
      }
    },

    // One-shot scream burst with glide & shortened envelope feel
    screamBurst: (notesOrHz, dur = 0.6, { up = true, intensity = 0.9, when = Tone.getTransport().seconds } = {}) => {
      debugLog('🎵 Choir screamBurst: Starting burst', { frequency: notesOrHz, duration: dur, up, intensity });
      // ensure scream voicing is active during the burst
      const prev = screamEnabled;
      api.setScream(true, { intensity, registerHint: "tenor" });

      const dSec = typeof dur === "number" ? dur : Tone.Time(dur).toSeconds();
      const glide = up ? (80 + intensity * 160) : -(80 + intensity * 160); // cents
      debugLog('🎵 Choir screamBurst: Glide amount', glide, 'cents', up ? 'up' : 'down');

      // quick collective upward or downward scream glide
      voicesArr.forEach(v => {
        const cur = v.osc.detune.value;
        v.osc.detune.cancelScheduledValues(when);
        v.osc.detune.setValueAtTime(cur, when);
        v.osc.detune.linearRampToValueAtTime(cur + glide, when + Math.min(0.2 + intensity * 0.2, 0.35));
      });

      const startT = when;
      api.triggerAttackRelease(notesOrHz, dSec, startT);

      // brief extra rasp spike at onset
      Tone.getTransport().scheduleOnce(t => {
        const pre = raspGain.gain.value;
        raspGain.gain.setValueAtTime(Math.min(0.7, intensity * 0.9), t);
        raspGain.gain.rampTo(pre, 0.08);
        debugLog('🎵 Choir screamBurst: Rasp spike applied');
      }, startT + 0.01);

      // optional: restore previous scream state after the burst
      Tone.getTransport().scheduleOnce(() => {
        if (!prev) {
          debugLog('🎵 Choir screamBurst: Restoring previous scream state (disabled)');
          api.setScream(false);
        }
      }, startT + dSec + 0.05);

      debugLog('🎵 Choir screamBurst: Burst scheduled for', startT, 'with duration', dSec);
    },

    dispose() {
      try {
        voicesArr.forEach(v => {
          v.osc.dispose();
          v.vib.dispose();
          v.jitterLFO.dispose();
          v.noise.dispose();
          v.env.dispose();
          v.voiceGain.dispose();
          v.soften.dispose();
          v.mix.dispose();
          v.noiseGain.dispose();
        });
        formantSplits.forEach(s => {
          s.lfo.dispose();
          s.bp.dispose();
          s.g.dispose();
        });
        [preFormantSum, branchSum, choirBus,
         screamPreHP, screamDrive, screamDriveWet, screamDriveDry, singersFormant,
         raspNoise, raspHP, raspGain,
         widener, hall, choirTailEQ].forEach(n => n?.dispose?.());
      } catch (e) {
        debugError("Choir dispose error", e);
      }
    }
  };

  // Simple .volume.value interface for parity with your other instruments
  Object.defineProperty(api.volume, "value", {
    get() { return Tone.gainToDb(choirBus.gain.value); },
    set(db) { choirBus.gain.value = Tone.dbToGain(db); }
  });
  api.volume.value = CHOIR_VOLUME;

  return api;
}

// Static scratchy synth - creates intermittent static scratch sounds with organic timing
function createStaticSynth({ mode = STATIC_MODE } = {}) {
  // Randomize noise type for varied character
  const noiseTypes = ["white", "pink", "brown"];
  const randomNoiseType = noiseTypes[seededRandom.nextInt(0, noiseTypes.length - 1)];

  // Create the base noise source for static sound with randomized type
  const noise = new Tone.Noise({
    type: randomNoiseType,
    volume: -24 // Start quieter to allow for dynamic range
  });

  // Create multiple high-pass filters for more complex frequency shaping
  const highpass1Freq = 500 + seededRandom.nextFloat(0, 2000); // 500-2500 Hz (much more varied)
  // Valid rolloff values for Tone.js filters: -12, -24, -48, -96
  const rolloffOptions = [-12, -24, -48, -96];
  const randomRolloff1 = rolloffOptions[seededRandom.nextInt(0, rolloffOptions.length - 1)];
  const highpass1 = new Tone.Filter({
    type: "highpass",
    frequency: highpass1Freq,
    rolloff: randomRolloff1
  });

  // Second high-pass for more extreme filtering
  const highpass2Freq = highpass1Freq + 1000 + seededRandom.nextFloat(0, 3000); // 1500-6500 Hz
  const randomRolloff2 = rolloffOptions[seededRandom.nextInt(0, rolloffOptions.length - 1)];
  const highpass2 = new Tone.Filter({
    type: "highpass",
    frequency: highpass2Freq,
    rolloff: randomRolloff2
  });

  // Create low-pass filter with extreme randomization
  const lowpassFreq = 2000 + seededRandom.nextFloat(0, 18000); // 2000-20000 Hz (huge range!)
  const randomRolloff3 = rolloffOptions[seededRandom.nextInt(0, rolloffOptions.length - 1)];
  const lowpass = new Tone.Filter({
    type: "lowpass",
    frequency: lowpassFreq,
    rolloff: randomRolloff3
  });

  // Create distortion for more aggressive scratchy sound with extreme randomization
  const distortionAmount = 0.1 + seededRandom.nextFloat(0, 0.9); // 0.1-1.0 (much more varied)
  const distortionWet = 0.3 + seededRandom.nextFloat(0, 0.7); // 0.3-1.0 wet mix

  // Use WaveShaper instead of Distortion to avoid AudioWorklet requirement
  const distortionWaveShaper = new Tone.WaveShaper((val) => {
    // More aggressive distortion curve for static sounds
    return Math.sign(val) * (1 - Math.exp(-Math.abs(val) * distortionAmount * 5));
  });

  // Create dry/wet mix for the distortion effect
  const distortionDry = new Tone.Gain(1 - distortionWet);
  const distortionWetGain = new Tone.Gain(distortionWet);

  // Add bit crushing for digital artifact variations using filters
  const bitCrushBits = 2 + seededRandom.nextInt(0, 14); // 2-16 bits (extreme variation)
  const bitCrushWet = 0.1 + seededRandom.nextFloat(0, 0.8); // 0.1-0.9 wet

  // Simulate bit crushing with very low-pass filter
  const bitCrushFreq = 100 + (bitCrushBits * 100); // Lower bits = lower frequency
  const bitCrushFilter = new Tone.Filter({
    type: "lowpass",
    frequency: bitCrushFreq,
    rolloff: -48 // Very steep rolloff
  });

  // Create dry/wet mix for the bit crush effect
  const bitCrushDry = new Tone.Gain(1 - bitCrushWet);
  const bitCrushWetGain = new Tone.Gain(bitCrushWet);

  // Create multiple LFOs for more complex modulation patterns
  const lfo1Freq = 2 + seededRandom.nextFloat(0, 40); // 2-42 Hz (much wider range)
  const lfo1Depth = 0.2 + seededRandom.nextFloat(0, 0.8); // 0.2-1.0 depth

  const lfo2Freq = 0.1 + seededRandom.nextFloat(0, 15); // 0.1-15.1 Hz (slower modulation)
  const lfo2Depth = 0.3 + seededRandom.nextFloat(0, 0.7); // 0.3-1.0 depth

  // Create LFO modulation patterns for high-pass filter 1
  const hp1LfoMin = highpass1Freq * (0.1 + seededRandom.nextFloat(0, 0.8)); // 10%-90% of base freq
  const hp1LfoMax = highpass1Freq * (1.2 + seededRandom.nextFloat(0, 2.0)); // 120%-320% of base freq
  const hp1Range = hp1LfoMax - hp1LfoMin;

  const lfo1 = new Tone.LFO({
    frequency: lfo1Freq,
    min: 0,
    max: 1.0,
    phase: seededRandom.nextFloat(0, 360) // Random phase for variation
  });

  const hp1Mul = new Tone.Multiply(hp1Range);
  const hp1Add = new Tone.Add(hp1LfoMin);
  lfo1.connect(hp1Mul);
  hp1Mul.connect(hp1Add);
  hp1Add.connect(highpass1.frequency);

  // Create second LFO for high-pass filter 2
  const hp2LfoMin = highpass2Freq * (0.3 + seededRandom.nextFloat(0, 0.6)); // 30%-90% of base freq
  const hp2LfoMax = highpass2Freq * (0.8 + seededRandom.nextFloat(0, 1.5)); // 80%-230% of base freq

  const lfo2 = new Tone.LFO({
    frequency: lfo2Freq,
    min: 0,
    max: 1.0,
    phase: seededRandom.nextFloat(0, 360)
  });

  const hp2Range = hp2LfoMax - hp2LfoMin;
  const hp2Mul = new Tone.Multiply(hp2Range);
  const hp2Add = new Tone.Add(hp2LfoMin);
  lfo2.connect(hp2Mul);
  hp2Mul.connect(hp2Add);
  hp2Add.connect(highpass2.frequency);

  // Create LFO for low-pass filter
  const lpLfoMin = lowpassFreq * (0.2 + seededRandom.nextFloat(0, 0.7)); // 20%-90% of base freq
  const lpLfoMax = lowpassFreq * (1.1 + seededRandom.nextFloat(0, 3.0)); // 110%-410% of base freq

  // Use LFO1 for low-pass as well for interconnected modulation
  const lpRange = lpLfoMax - lpLfoMin;
  const lpMul = new Tone.Multiply(lpRange);
  const lpAdd = new Tone.Add(lpLfoMin);
  lfo1.connect(lpMul);
  lpMul.connect(lpAdd);
  lpAdd.connect(lowpass.frequency);

  // Core audio path up to lowpass (shared for both modes)
  noise.connect(highpass1);
  highpass1.connect(highpass2);
  highpass2.connect(lowpass);

  // Split to bitcrush dry/wet, then to distortion
  lowpass.connect(bitCrushDry);
  lowpass.connect(bitCrushFilter);
  bitCrushFilter.connect(bitCrushWetGain);
  bitCrushWetGain.connect(distortionDry);

  bitCrushDry.connect(distortionWaveShaper);
  distortionWaveShaper.connect(distortionWetGain);

  // Create gain and panner for "free" mode
  const gainNode = new Tone.Gain(0.3 + seededRandom.nextFloat(0, 0.7)); // 0.3-1.0 gain
  const panner = new Tone.Panner(0);

  // In FREE mode only, complete direct routing to preMaster
  if (mode === "free") {
    distortionWetGain.connect(preMaster); // wet path
    bitCrushDry.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(preMaster);            // dry path
  }

  // Note: noise source will be started by static engine when needed
  // Return the complete static synth object with all components
  const synth = {
    mode,
    noise: noise,
    highpass1: highpass1,
    highpass2: highpass2,
    lowpass: lowpass,
    distortionWaveShaper: distortionWaveShaper,
    distortionDry: distortionDry,
    distortionWetGain: distortionWetGain,
    bitCrushFilter: bitCrushFilter,
    bitCrushDry: bitCrushDry,
    bitCrushWetGain: bitCrushWetGain,
    lfo1: lfo1,
    lfo2: lfo2,
    gain: gainNode,
    panner: panner,
    hp1Mul: hp1Mul,
    hp1Add: hp1Add,
    hp2Mul: hp2Mul,
    hp2Add: hp2Add,
    lpMul: lpMul,
    lpAdd: lpAdd,
    isPlaying: false,
    pendingBursts: [],

    // For ENGINE mode, provide a hook to connect the lowpass node to an external bus
    connectForEngine(targetNode) {
      if (this.mode !== "engine") return;
      // caller will build bands etc. starting from lowpass
      this.lowpass.connect(targetNode);
    },

    // Static burst (no more stopping the shared noise source)
    triggerStatic: function(duration = "8n", volume = -12, startTime = null) {
      if (this.isPlaying) {
        this.pendingBursts.push({ duration, volume });
        return;
      }
      this.isPlaying = true;

      const attack = 0.01 + seededRandom.nextFloat(0, 0.05);
      const randomVolume = volume + (seededRandom.nextFloat(0, 1) - 0.5) * 24;
      const baseSec = Tone.Time(duration).toSeconds();
      const actualSec = baseSec + (seededRandom.nextFloat(0, 1) - 0.5) * 0.5;
      const jitter = seededRandom.nextFloat(0, 0.2);
      // Use Transport seconds so all scheduling is Transport-relative
      const t0 = startTime ?? Tone.getTransport().seconds;
      const t1 = t0 + Math.max(0.01, actualSec + jitter);
      const fade = 0.02 + seededRandom.nextFloat(0, 0.08);

      const panValue = (seededRandom.nextFloat(0, 1) - 0.5) * 0.8;
      const pitchShift = (seededRandom.nextFloat(0, 1) - 0.5) * 400;
      const pitchMult = Math.pow(2, pitchShift / 1200);
      const newPitch = Math.max(0.01, (Math.max(0.01, this.noise.playbackRate) * pitchMult));

      Tone.getTransport().scheduleOnce((time) => {
        this.lfo1.start(time);
        this.lfo2.start(time);
        const r = this.noise.playbackRate;
        r.cancelScheduledValues(time);
        r.setValueAtTime(r.value, time);
        r.linearRampToValueAtTime(newPitch, time + 0.03);

        // In ENGINE mode, the burst amplitude shaping happens *after* lowpass (engine gate).
        // In FREE mode, we shape the local dry path gain.
        if (this.mode === "free") {
          const g = this.gain.gain;
          g.cancelScheduledValues(time);
          g.setValueAtTime(0, time);
          g.linearRampToValueAtTime(Tone.dbToGain(randomVolume), time + attack);

          const p = this.panner.pan;
          p.cancelScheduledValues(time);
          p.setValueAtTime(p.value, time);
          p.linearRampToValueAtTime(panValue, time + 0.06);
        }
      }, t0);

      Tone.getTransport().scheduleOnce((time) => {
        if (this.mode === "free") {
          const g = this.gain.gain;
          g.cancelScheduledValues(time);
          g.setValueAtTime(g.value, time);
          g.linearRampToValueAtTime(0, time + fade);
        }
        // DO NOT stop noise; just stop LFOs
        this.lfo1.stop(time + fade);
        this.lfo2.stop(time + fade);

        this.isPlaying = false;
        if (this.pendingBursts.length > 0) {
          const next = this.pendingBursts.shift();
          Tone.getTransport().scheduleOnce((nt) => {
            this.triggerStatic(next.duration, next.volume, nt);
          }, time + 0.01);
        }
      }, t1);
    },

    // Method to dispose of all components
    dispose() {
      [
        noise, highpass1, highpass2, lowpass,
        distortionWaveShaper, distortionDry, distortionWetGain,
        bitCrushFilter, bitCrushDry, bitCrushWetGain,
        lfo1, lfo2, gainNode, panner,
        hp1Mul, hp1Add, hp2Mul, hp2Add, lpMul, lpAdd
      ].forEach(n => n?.dispose?.());
      this.isPlaying = false;
      this.pendingBursts = [];
    }
  };

  // Start with muted gain in FREE mode
  if (mode === "free") {
    synth.gain.gain.value = 0;
  }

  return synth;
}

// Shuffle array function for randomizing chord order on page load
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = seededRandom.nextInt(0, i);
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// Generate a boolean Euclidean pattern of length `steps` with `fills` pulses and optional rotation
function euclid(steps, fills, rotate = 0) {
  const pattern = [];
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += fills;
    if (bucket >= steps) {
      bucket -= steps;
      pattern.push(true);
    } else {
      pattern.push(false);
    }
  }
  if (rotate) {
    const r = ((rotate % steps) + steps) % steps;
    return pattern.slice(-r).concat(pattern.slice(0, -r));
  }
  return pattern;
}

// Microtonal and randomness utilities (now working with Hz frequencies)
function addMicrotonalVariation(note, centsRange = 50) {
  // Convert note to frequency, add random cents offset, return Hz
  const freq = Tone.Frequency(note).toFrequency();
  const centsOffset = (seededRandom.nextFloat(0, 1) - 0.5) * centsRange; // -centsRange/2 to +centsRange/2
  const newFreq = freq * Math.pow(2, centsOffset / 1200);
  return newFreq; // Return Hz number, not note name
}

function addRandomTimingVariation(baseTime, variationRange = 0.5) {
  // Add random timing variation in seconds
  const variation = (seededRandom.nextFloat(0, 1) - 0.5) * variationRange;
  return baseTime + variation;
}

function addRandomDurationVariation(baseDuration, variationPercent = 0.3) {
  // Add random duration variation as percentage, but ensure minimum duration
  const variation = (seededRandom.nextFloat(0, 1) - 0.5) * variationPercent;
  const newDuration = baseDuration * (1 + variation);
  // Ensure duration is never zero or negative
  return Math.max(newDuration, 0.1);
}

function createMicrotonalChord(baseChord, microtonalIntensity = 0.7) {
  // Apply microtonal variations to chord notes (now working with Hz)
  return baseChord.map(note => {
    // Only apply microtonal variation to some notes (controlled randomness)
    if (seededRandom.nextFloat(0, 1) < microtonalIntensity) {
      return addMicrotonalVariation(note, 30); // 30 cents range, returns Hz
    }
    // Convert note to Hz if not applying microtonal variation
    return Tone.Frequency(note).toFrequency();
  });
}

function addRandomModulationVariation(synth, baseParams) {
  // Add random variations to modulation parameters
  const variations = {
    harmonicity: baseParams.harmonicity + (seededRandom.nextFloat(0, 1) - 0.5) * 0.2,
    modulationIndex: baseParams.modulationIndex + (seededRandom.nextFloat(0, 1) - 0.5) * 2,
    // Add random LFO-like variations to parameters
    randomLFO: {
      frequency: 0.1 + seededRandom.nextFloat(0, 0.3), // 0.1-0.4 Hz
      depth: 0.1 + seededRandom.nextFloat(0, 0.2)      // 0.1-0.3 depth
    }
  };
  
  // Apply variations if synth exists
  if (synth && synth.set) {
    synth.set({
      harmonicity: variations.harmonicity,
      modulationIndex: variations.modulationIndex
    });
  }
  
  return variations;
}

// Microtonal scales and intervals (now working with Hz frequencies)
function createMicrotonalScale(baseNote, scaleType = 'quarterTone') {
  const baseFreq = Tone.Frequency(baseNote).toFrequency();
  const scales = {
    quarterTone: [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550], // Quarter-tone scale
    justIntonation: [0, 112, 204, 316, 386, 498, 590, 702, 814, 884, 996, 1088], // Just intonation intervals
    bohlenPierce: [0, 146, 293, 439, 585, 732, 878, 1024, 1170, 1317, 1463], // Bohlen-Pierce scale
    harmonic: [0, 702, 1200, 1902, 2400, 3102, 3600, 4302, 4800, 5502, 6000] // Harmonic series intervals
  };

  const selectedScale = scales[scaleType] || scales.quarterTone;
  return selectedScale.map(cents => {
    const freq = baseFreq * Math.pow(2, cents / 1200);
    return freq; // Return Hz number, not note name
  });
}

function createMicrotonalChordFromScale(baseNote, scaleType = 'quarterTone', chordSize = 5) {
  const scale = createMicrotonalScale(baseNote, scaleType);
  const chord = [];

  // Select random frequencies from the scale to create a chord
  for (let i = 0; i < chordSize; i++) {
    const randomIndex = seededRandom.nextInt(0, scale.length - 1);
    chord.push(scale[randomIndex]);
  }

  return chord;
}

function addPitchDrift(note, driftAmount = 10) {
  // Add subtle pitch drift over time
  const freq = Tone.Frequency(note).toFrequency();
  const drift = (seededRandom.nextFloat(0, 1) - 0.5) * driftAmount; // -driftAmount/2 to +driftAmount/2 cents
  const newFreq = freq * Math.pow(2, drift / 1200);
  return newFreq; // Return Hz number, not note name
}

// Vibrato functions for PolySynth (using simple LFO approach)
function attachVibratoToPolySynth(poly, { freq=1.2, depthCents=20, phase=0 } = {}) {
  // For now, skip vibrato to avoid connection issues
  // TODO: Implement proper vibrato for PolySynth
  debugLog('Vibrato attachment skipped for compatibility');
  return; // Early return to prevent any connection attempts
}

function detachVibratoFromPolySynth(poly){
  // Vibrato not currently implemented
}

// Helper function to count active voices
function countActiveVoices(poly) {
  try {
    return poly.activeVoices || 0;
  } catch {
    return 0;
  }
}

// Voice budget guard for adaptive release times
function adaptiveRelease(poly, voicesPerBar, target=6){
  const factor = Math.min(1, target / Math.max(1, voicesPerBar));
  const desiredRelease = 4 + 5 * factor; // 4..9 seconds
  try {
    const currentEnvelope = poly.get().envelope || {
      attack: 0.01,
      decay: 0.1,
      sustain: 0.5,
      release: 5
    };
    poly.set({ envelope: { ...currentEnvelope, release: desiredRelease } });
    debugLog('🎛️ Adaptive release:', desiredRelease.toFixed(1), 's (factor:', factor.toFixed(2), ')');
  } catch (e) {
    debugError('⚠️ Adaptive release failed:', e.message);
  }
}

function addVibratoVariation(synth, baseParams) {
  // Add random vibrato/LFO variations to synth parameters using seeded random
  const vibratoFreq = 0.5 + seededRandom.nextFloat(0, 2); // 0.5-2.5 Hz vibrato
  const vibratoDepth = 0.1 + seededRandom.nextFloat(0, 0.3);   // 0.1-0.4 depth

  // Create a vibrato LFO that modulates the oscillator frequency
  const vibratoLFO = new Tone.LFO({
    frequency: vibratoFreq,
    min: -vibratoDepth * 100, // Convert to cents (±10-40 cents)
    max: vibratoDepth * 100,
    phase: seededRandom.nextFloat(0, 360)
  });

  // Connect vibrato LFO to synth frequency (if supported)
  if (synth && synth.frequency) {
    vibratoLFO.connect(synth.frequency);
  }

  const vibratoVariations = {
    lfo: vibratoLFO,
    frequency: vibratoFreq,
    depth: vibratoDepth,
    phase: seededRandom.nextFloat(0, 360)
  };

  // Apply additional pitch modulation
  if (synth && synth.set) {
    synth.set({
      modulationIndex: baseParams.modulationIndex + (seededRandom.nextFloat(0, 1) - 0.5) * 0.5
    });
  }

  return vibratoVariations;
}

function createRandomChordVoicing(baseChord, voicingIntensity = 0.5) {
  // Create random chord voicing variations (now working with Hz)
  const voicing = [...baseChord];

  // Randomly transpose some notes up or down octaves
  voicing.forEach((freq, index) => {
    if (seededRandom.nextFloat(0, 1) < voicingIntensity) {
      const octaveShift = seededRandom.nextInt(0, 2) - 1; // -1, 0, or +1 octaves
      if (octaveShift !== 0) {
        // freq might be Hz or note name, handle both cases
        const currentFreq = typeof freq === 'string' ? Tone.Frequency(freq).toFrequency() : freq;
        const newFreq = currentFreq * Math.pow(2, octaveShift);
        voicing[index] = newFreq; // Store as Hz
      }
    } else if (typeof freq === 'string') {
      // Convert note names to Hz if not applying voicing variation
      voicing[index] = Tone.Frequency(freq).toFrequency();
    }
  });

  return voicing;
}

// Lightweight random walk utilities for long-horizon drift
// Bounded random walk that updates on a clock
function makeRandomWalk({min=0, max=1, step=0.1, start=null}) {
  let v = (start == null) ? (min + (max-min)/2) : start;
  return () => {
    const dir = seededRandom.nextFloat(0,1) < 0.5 ? -1 : 1;
    v = Math.min(max, Math.max(min, v + dir * (seededRandom.nextFloat(0, step))));
    return v;
  };
}

// Slowly varying 0..1 value using smoothed dice
function makeDriftLFO({stepBeats="2m", smoothing=0.6}) {
  let target = seededRandom.nextFloat(0,1);
  let cur = target;
  Tone.getTransport().scheduleRepeat(() => {
    target = seededRandom.nextFloat(0,1);
  }, stepBeats);
  return () => {
    cur = cur * smoothing + target * (1 - smoothing);
    return cur;
  };
}

// Rhythmic Static Engine - syncs static layer to Transport and dynamic BPM with evolving patterns
function createStaticRhythmEngine(staticSynth) {
  const gateGain = new Tone.Gain(0).connect(preMaster);

  const trem = new Tone.Tremolo({ frequency: "4n", depth: 0.25, spread: 180 }).start();
  const autoPan = new Tone.AutoPanner({ frequency: "2m", depth: 0.35 }).start();
  const ampEnv = new Tone.Envelope({ attack: 0.004, decay: 0.09, sustain: 0.0, release: 0.08 });

  const mkBand = (freq) => new Tone.Filter({ type: "bandpass", frequency: freq, Q: 8 });
  const bandCount = 4;
  const bands = new Array(bandCount).fill(0).map(() => mkBand(500));

  // Dedicated static bus for the engine
  const staticBus = new Tone.Gain(1);

  // *** NEW: connect lowpass into engine bus only when in ENGINE mode
  if (staticSynth.mode === "engine") {
    staticSynth.connectForEngine(staticBus);
  } else {
    // If someone accidentally uses FREE mode with engine, still sync via tap:
    staticSynth.lowpass.connect(staticBus);
  }

  const bandsSum = new Tone.Gain(1);
  bands.forEach(b => { staticBus.connect(b); b.connect(bandsSum); });
  bandsSum.connect(trem).connect(autoPan).connect(gateGain);
  ampEnv.connect(gateGain.gain);

  // Swing can drift a little over time
  Tone.getTransport().swingSubdivision = "8n";

  // Long-horizon modulators
  const densityWalk = makeRandomWalk({min: 0.1, max: 0.95, step: 0.08});
  const rotateWalk16 = makeRandomWalk({min: 0, max: 15, step: 3});
  const rotateWalk12 = makeRandomWalk({min: 0, max: 11, step: 2});
  const rotateWalk7  = makeRandomWalk({min: 0, max: 6, step: 1});
  const fillsDrift16 = makeDriftLFO({stepBeats:"4m", smoothing:0.8});
  const fillsDrift12 = makeDriftLFO({stepBeats:"6m", smoothing:0.85});
  const fillsDrift7  = makeDriftLFO({stepBeats:"8m", smoothing:0.9});
  const swingDrift   = makeDriftLFO({stepBeats:"16m", smoothing:0.92});
  const panDrift     = makeDriftLFO({stepBeats:"8m", smoothing:0.85});

  // Occasional polymeter step count jitter
  let steps16 = 16, steps12 = 12, steps7 = 7;

  // Pattern state
  let pat16 = euclid(steps16, 5, 0);
  let pat12 = euclid(steps12, 4, 0);
  let pat7  = euclid(steps7, 3, 0);

  // Accents evolve
  let accents = [1.0, 0.85, 1.2, 0.9, 0.8, 1.15, 0.95, 0.75];

  // Scene system
  let sceneIndex = 0;
  function applyScene(scene) {
    // Envelope flavor
    ampEnv.attack  = scene.envAttack;
    ampEnv.decay   = scene.envDecay;
    ampEnv.release = scene.envRelease;

    // Morph band parameters instead of rebuilding (Tone v15.1.22 Params)
    bands.forEach(b => b.Q.rampTo(scene.bandQ, 0.05));

    // Pan and trem feel (Tone v15.1.22 Params)
    autoPan.depth.rampTo(scene.autoPanDepth, 0.05);
    trem.depth.rampTo(scene.tremDepth, 0.05);

    // Subtle swing evolve
    Tone.getTransport().swing = 0.08 + swingDrift() * 0.12; // 0.08..0.2

    // Accent recipe
    accents = scene.accents;

    // Scene-based scream mode
    try {
      if (choirSynth && choirSynth.setScream) {
        const sceneFactor = [0.5, 0.8, 0.65][sceneIndex % 3]; // subtle differences per scene
        const wantScream = seededRandom.nextFloat(0,1) < 0.4;  // 40% of scenes go a bit aggressive
        debugLog('🎵 Scene change: Choir scream mode', wantScream ? 'ENABLED' : 'DISABLED', 'with intensity', sceneFactor);
        choirSynth.setScream(wantScream, { intensity: sceneFactor, registerHint: "tenor" });
      }
    } catch(e) {
      debugError('Scene->choir scream tweak failed', e);
    }
  }

  const scenes = [
    { envAttack: 0.004, envDecay: 0.08, envRelease: 0.07, bandQ: 8,  autoPanDepth: 0.35, tremDepth: 0.25, accents: [1.0, 0.85, 1.2, 0.9, 0.8, 1.15, 0.95, 0.75] },
    { envAttack: 0.006, envDecay: 0.11, envRelease: 0.09, bandQ: 10, autoPanDepth: 0.45, tremDepth: 0.18, accents: [0.9, 1.25, 0.8, 1.1, 0.95, 0.85, 1.2, 0.8] },
    { envAttack: 0.003, envDecay: 0.06, envRelease: 0.06, bandQ: 12, autoPanDepth: 0.25, tremDepth: 0.32, accents: [1.2, 0.8, 0.95, 1.1, 0.85, 1.0, 0.75, 1.15] },
  ];

  function nextScene() {
    sceneIndex = (sceneIndex + 1) % scenes.length;
    applyScene(scenes[sceneIndex]);
  }
  applyScene(scenes[sceneIndex]);

  // Retune bands toward current chord tones
  function retuneBands() {
    // Prefer the densest currently updated chord set, fall back gracefully
    const candidates = [
      currentChoirChordHz,
      currentDroneChordHz,
      currentBellChordHz
    ];
    const chord = candidates.find(arr => Array.isArray(arr) && arr.length) || [];
    if (chord.length === 0) return;
    for (let i = 0; i < bands.length; i++) {
      const base = chord[seededRandom.nextInt(0, chord.length - 1)];
      const oct = [-1, 0, 0, 1][seededRandom.nextInt(0, 3)];
      const cents = seededRandom.nextFloat(-18, 18);
      const freq = base * Math.pow(2, oct) * Math.pow(2, cents / 1200);
      bands[i].frequency.rampTo(freq, 0.05);
      const newQ = 6 + seededRandom.nextFloat(0, 8);
      bands[i].Q.rampTo(newQ, 0.05);
    }
  }

  // Hit generator with BPM-aware gate
  function hit(vel = 1.0, divisor = "16n", t) {
    retuneBands();
    // Scale envelope time to BPM so hits stay snappy at slow tempos
    const bpm = Tone.getTransport().bpm.value;
    const scale = bpm <= 50 ? 1.15 : bpm >= 90 ? 0.85 : 1.0;
    const dur = Tone.Time(divisor).toSeconds() * scale;

    const now = t ?? Tone.getTransport().seconds;
    ampEnv.triggerAttack(now);
    ampEnv.triggerRelease(now + dur);

    // Pan drift (Tone v15.1.22 Param)
    const pan = (panDrift() - 0.5) * 0.6;
    autoPan.depth.rampTo(0.25 + panDrift() * 0.3, 0.08);

    // Occasionally sprinkle your old free bursts for grit
    if (seededRandom.nextFloat(0,1) < 0.05) {
      const durs = ["16n","8n","4n","8t","32n"];
      const v = -22 + seededRandom.nextFloat(0,10);
      // Crossfade playback rate to prevent clicks
      const targetRate = 0.7 + seededRandom.nextFloat(0, 1.0);
      const r = staticSynth.noise.playbackRate;
      r.cancelScheduledValues(now);
      r.setValueAtTime(r.value, now);
      r.linearRampToValueAtTime(targetRate, now + 0.03);
      staticSynth.triggerStatic(durs[seededRandom.nextInt(0, durs.length-1)], v, now);
    }
  }

  // Pattern morph clock
  Tone.getTransport().scheduleRepeat(() => {
    // Drift fills with bounds
    const f16 = Math.max(1, Math.min(12, Math.round(2 + fillsDrift16()*10)));
    const f12 = Math.max(1, Math.min(8,  Math.round(2 + fillsDrift12()*6)));
    const f7  = Math.max(1, Math.min(5,  Math.round(1 + fillsDrift7()*4)));
    // Occasional polymeter size nudge
    if (seededRandom.nextFloat(0,1) < 0.15) steps16 = [15,16,17][seededRandom.nextInt(0,2)];
    if (seededRandom.nextFloat(0,1) < 0.12) steps12 = [11,12,13][seededRandom.nextInt(0,2)];
    if (seededRandom.nextFloat(0,1) < 0.10) steps7  = [6,7,8][seededRandom.nextInt(0,2)];

    pat16 = euclid(steps16, f16, Math.round(rotateWalk16()));
    pat12 = euclid(steps12, f12, Math.round(rotateWalk12()));
    pat7  = euclid(steps7,  f7,  Math.round(rotateWalk7()));

    // Slight swing move
    Tone.getTransport().swing = 0.08 + swingDrift() * 0.12;
  }, "2m");

  // Scene changer every phrase
  Tone.getTransport().scheduleRepeat(() => {
    nextScene();
  }, "16m", "9m"); // first switch mid-phrase

  // Density map decides how many hits survive each bar
  function allowHit() {
    const base = densityWalk();  // 0.1..0.95 slowly wandering
    // Lean on tempo: faster tempo lowers density slightly
    const bpm = Tone.getTransport().bpm.value;
    const tempoFactor = bpm > 80 ? 0.9 : bpm < 50 ? 1.1 : 1.0;
    const threshold = Math.min(0.98, Math.max(0.08, base * tempoFactor));
    return seededRandom.nextFloat(0,1) < threshold;
  }

  // Sequences with evolving step counts
  const seq16 = new Tone.Sequence((time, i) => {
    if (i >= pat16.length) return;
    if (pat16[i] && allowHit()) {
      const vel = accents[i % accents.length];
      hit(vel, "16n", time);
      if (seededRandom.nextFloat(0,1) < 0.12) {
        hit(vel*0.7, "32n", time + Tone.Time("32t"));
      }
    }
  }, new Array(32).fill(0).map((_, i) => i), "16n"); // buffer longer than 16 so length changes are ok

  const seq12 = new Tone.Sequence((time, i) => {
    if (i >= pat12.length) return;
    if (pat12[i] && allowHit()) {
      hit(0.85, "16n", time);
    }
  }, new Array(24).fill(0).map((_, i) => i), "8t");

  const seq7 = new Tone.Sequence((time, i) => {
    if (i >= pat7.length) return;
    if (pat7[i] && allowHit()) {
      hit(1.1, "8n", time);
    }
  }, new Array(16).fill(0).map((_, i) => i), "4n");

  // Short windows where we temporarily bypass the grid
  Tone.getTransport().scheduleRepeat(() => {
    const open = seededRandom.nextFloat(0,1) < 0.25; // 25% chance per phrase
    if (!open) return;

    const windowLen = ["2m","4m","6m"][seededRandom.nextInt(0,2)];
    const startTime = Tone.now();

    const id = Tone.getTransport().scheduleRepeat((time) => {
      // Fire a couple of organic bursts
      const dur = ["16n","8n.","4n","8t","2n"][seededRandom.nextInt(0,4)];
      const vol = -26 + seededRandom.nextFloat(0, 14);
      // Crossfade playback rate to prevent clicks
      const targetRate = 0.6 + seededRandom.nextFloat(0, 1.2);
      const r = staticSynth.noise.playbackRate;
      r.cancelScheduledValues(time);
      r.setValueAtTime(r.value, time);
      r.linearRampToValueAtTime(targetRate, time + 0.03);
      staticSynth.triggerStatic(dur, vol, time);
    }, "8n", startTime);

    Tone.getTransport().scheduleOnce(() => {
      Tone.getTransport().clear(id);
    }, Tone.Time(windowLen).toSeconds() + startTime);
  }, "16m", "1m");

  // Start/stop
  return {
    start(at="5m") {
      // Start noise source slightly before sequences - use Transport scheduling to get AudioContext time
      // Ultra-safe clamp prevents negative time values
      Tone.getTransport().scheduleOnce((t) => {
        staticSynth.noise.start(Math.max(Tone.now() + 0.001, t - 0.01));
      }, at);
      seq16.start(at);
      seq12.start(at);
      seq7.start(at);
    },
    stop() {
      seq16.stop();
      seq12.stop();
      seq7.stop();
      staticSynth.noise.stop();
    },
    dispose() {
      [seq16, seq12, seq7, ampEnv, trem, autoPan, gateGain, bandsSum, staticBus].forEach(n => n?.dispose?.());
      bands.forEach(b => b.dispose());
    }
  };
}

// Chord progressions - lower octaves for deeper drone
const droneChordBase = [
    // Original Set (A#/D# tonality)
    ["A#1", "F2", "A#2", "D#3", "F3"],     // A# major extended
    ["D#1", "A#1", "C2", "G2", "A#2"],     // D# major extended with extensions
    ["F1", "C2", "D#2", "A#2", "C3"],      // F major extended
    ["A#1", "D#2", "G2", "C3", "D#3"],     // A# major with extensions
    
    // Set 2 (F Major/D Minor tonality)
    ["F1", "C2", "F2", "A2", "C3"],        // F major extended
    ["A1", "F2", "G2", "D3", "F3"],        // D minor over A bass
    ["C1", "G1", "C2", "E2", "G2"],        // C major extended
    ["D1", "A1", "D2", "F2", "A2"],        // D minor extended
    
    // Set 3 (C Major/A Minor tonality)
    ["C1", "G1", "C2", "E2", "G2"],        // C major extended
    ["A1", "E2", "A2", "C3", "E3"],        // A minor extended
    ["F1", "C2", "F2", "A2", "C3"],        // F major extended
    ["G1", "D2", "G2", "B2", "D3"],        // G major extended
    
    // Set 4 (G Major/E Minor tonality)
    ["G1", "D2", "G2", "B2", "D3"],        // G major extended
    ["E1", "B1", "E2", "G2", "B2"],        // E minor extended
    ["C1", "G1", "C2", "E2", "G2"],        // C major extended
    ["D1", "A1", "D2", "F#2", "A2"],       // D major extended
    
    // Set 5 (D Major/B Minor tonality)
    ["D1", "A1", "D2", "F#2", "A2"],       // D major extended
    ["B1", "F#2", "B2", "D3", "F#3"],      // B minor extended
    ["G1", "D2", "G2", "B2", "D3"],        // G major extended
    ["A1", "E2", "A2", "C#3", "E3"],       // A major extended
    
    // Set 6 (Ab Major/F Minor tonality)
    ["Ab1", "Eb2", "Ab2", "C3", "Eb3"],    // Ab major extended
    ["F1", "C2", "F2", "Ab2", "C3"],       // F minor extended
    ["Db1", "Ab1", "Db2", "F2", "Ab2"],    // Db major extended
    ["Bb1", "F2", "Bb2", "D3", "F3"],      // Bb major extended
    
    // Set 7 (E Major/C# Minor tonality)
    ["E1", "B1", "E2", "G#2", "B2"],       // E major extended
    ["C#1", "G#1", "C#2", "E2", "G#2"],    // C# minor extended
    ["A1", "E2", "A2", "C#3", "E3"],       // A major extended
    ["B1", "F#2", "B2", "D#3", "F#3"],     // B major extended
    
    // Set 8 (Microtonal variations - quarter-tone intervals)
    ["C1", "E1", "G1", "B1", "D2"],        // C major with microtonal extensions
    ["F1", "A1", "C2", "E2", "G2"],        // F major with microtonal extensions
    ["G1", "B1", "D2", "F#2", "A2"],       // G major with microtonal extensions
    ["D1", "F#1", "A1", "C#2", "E2"],      // D major with microtonal extensions
    
    // Set 9 (Just intonation inspired - pure intervals)
    ["C1", "E1", "G1", "Bb1", "D2"],       // C major with just intonation flavor
    ["F1", "A1", "C2", "Eb2", "G2"],       // F major with just intonation flavor
    ["G1", "B1", "D2", "F2", "A2"],        // G major with just intonation flavor
    ["D1", "F#1", "A1", "C2", "E2"],       // D major with just intonation flavor
    
    // Set 10 (Microtonal scales - quarter-tone variations)
    createMicrotonalChordFromScale("C1", "quarterTone", 5),
    createMicrotonalChordFromScale("F1", "quarterTone", 5),
    createMicrotonalChordFromScale("G1", "quarterTone", 5),
    createMicrotonalChordFromScale("D1", "quarterTone", 5),
    
    // Set 11 (Just intonation microtonal chords)
    createMicrotonalChordFromScale("C1", "justIntonation", 4),
    createMicrotonalChordFromScale("F1", "justIntonation", 4),
    createMicrotonalChordFromScale("G1", "justIntonation", 4),
    createMicrotonalChordFromScale("D1", "justIntonation", 4),
    
    // Set 12 (Bohlen-Pierce microtonal chords)
    createMicrotonalChordFromScale("C1", "bohlenPierce", 4),
    createMicrotonalChordFromScale("F1", "bohlenPierce", 4),
    createMicrotonalChordFromScale("G1", "bohlenPierce", 4),
    createMicrotonalChordFromScale("D1", "bohlenPierce", 4)
  ];
  
  const bellChordBase = [
    // Original Set (A#/D# tonality)
    ["A#3", "F4", "A#4"],                  // A# major triad
    ["D#3", "A#3", "C4"],                  // D# major triad
    ["F3", "C4", "D#4"],                   // F major triad
    ["A#3", "D#4", "G4"],                  // A# major triad
    
    // Set 2 (F Major/D Minor tonality)
    ["F3", "C4", "F4"],                    // F major triad
    ["A3", "D4", "F4"],                    // D minor triad
    ["C3", "E4", "G4"],                    // C major triad
    ["D3", "F4", "A4"],                    // D minor triad
    
    // Set 3 (C Major/A Minor tonality)
    ["C3", "G4", "C4"],                    // C major triad
    ["A3", "C4", "E4"],                    // A minor triad
    ["F3", "A4", "C4"],                    // F major triad
    ["G3", "B4", "D4"],                    // G major triad
    
    // Set 4 (G Major/E Minor tonality)
    ["G3", "D4", "G4"],                    // G major triad
    ["E3", "G4", "B4"],                    // E minor triad
    ["C3", "E4", "G4"],                    // C major triad
    ["D3", "F#4", "A4"],                   // D major triad
    
    // Set 5 (D Major/B Minor tonality)
    ["D3", "A4", "D4"],                    // D major triad
    ["B3", "D4", "F#4"],                   // B minor triad
    ["G3", "B4", "D4"],                    // G major triad
    ["A3", "C#4", "E4"],                   // A major triad
    
    // Set 6 (Ab Major/F Minor tonality)
    ["Ab3", "Eb4", "Ab4"],                 // Ab major triad
    ["F3", "Ab4", "C4"],                   // F minor triad
    ["Db3", "F4", "Ab4"],                  // Db major triad
    ["Bb3", "D4", "F4"],                   // Bb major triad
    
    // Set 7 (E Major/C# Minor tonality)
    ["E3", "B4", "E4"],                    // E major triad
    ["C#3", "E4", "G#4"],                  // C# minor triad
    ["A3", "C#4", "E4"],                   // A major triad
    ["B3", "D#4", "F#4"],                  // B major triad
    
    // Set 8 (Microtonal bell chords - quarter-tone variations)
    createMicrotonalChordFromScale("C3", "quarterTone", 3),
    createMicrotonalChordFromScale("F3", "quarterTone", 3),
    createMicrotonalChordFromScale("G3", "quarterTone", 3),
    createMicrotonalChordFromScale("D3", "quarterTone", 3),
    
    // Set 9 (Just intonation bell chords)
    createMicrotonalChordFromScale("C3", "justIntonation", 3),
    createMicrotonalChordFromScale("F3", "justIntonation", 3),
    createMicrotonalChordFromScale("G3", "justIntonation", 3),
    createMicrotonalChordFromScale("D3", "justIntonation", 3)
  ];

// Master headroom and DC block - prevent pre-dynamics clipping
const preMaster = new Tone.Gain(Tone.dbToGain(-10));  // 10 dB headroom for rowdy scenes
const dcBlock = new Tone.Filter({ type: "highpass", frequency: 18, Q: 0.7 });

// Add master compressor for better loudness normalization
const masterCompressor = new Tone.Compressor({
  threshold: -18,    // Compress when signal exceeds -18dB
  ratio: 3,          // 3:1 compression ratio
  attack: 0.006,     // 6ms attack - lets micro-transients through (sources already ≥12ms)
  release: 0.25      // Gentle release
});

// Add master limiter to prevent volume from exceeding safe level
const masterLimiter = new Tone.Limiter(-6);

// Add tail EQ for darker reverb tails
const tailEQ = new Tone.Filter({ type: "lowpass", frequency: 4500 });

// New chain: [sources] -> preMaster -> dcBlock -> masterCompressor -> tailEQ -> masterLimiter -> Destination
preMaster.connect(dcBlock);
dcBlock.connect(masterCompressor);
masterCompressor.connect(tailEQ);
tailEQ.connect(masterLimiter);
masterLimiter.toDestination();

// Lightweight diagnostics for monitoring levels (Meter reports RMS/level, not true peaks)
const meter = new Tone.Meter({ channels: 2 });
masterLimiter.connect(meter);

function logLevel() {
  const v = meter.getValue();
  const level = Array.isArray(v) ? Math.max(...v) : v;
  if (level > -3) debugLog("⚠️ Master level high:", level.toFixed(2), "dB (approaching limiter)");
}
let levelLogId = setInterval(logLevel, 2000);

// Shuffle on load for unique experience each time
const droneChords = shuffleArray(droneChordBase);
const bellChords = shuffleArray(bellChordBase);

let droneSynth = null;
let bellSynth = null;
let staticSynth = null;
let choirSynth = null;
let droneLoop = null;
let bellLoop = null;
let staticLoop = null;
let choirLoop = null;
let staticEngine = null;

// Track active chord frequencies in Hz for static layer tuning
let currentDroneChordHz = [];
let currentBellChordHz = [];
let currentChoirChordHz = [];

function play() {
  debugLog('=== DRONE PLAY CALLED ===');
  
  // Set context tuning for stability and mobile optimization
  try {
    if (!Tone.context._initialized) {
      Tone.setContext(new Tone.Context({
        latencyHint: "balanced",
        lookAhead: 0.04
      }));
      Tone.context._initialized = true;
      debugLog('✅ Audio context tuned for balanced latency');
    }
  } catch (e) {
    debugLog('⚠️ Context already initialized, skipping tuning');
  }
  
  debugLog('Audio context state:', Tone.context.state);
  debugLog('Transport state before:', Tone.getTransport().state);

  // Sync with audio control state
  const state = syncAudioState();
  debugLog('Synced audio state - isPlaying:', state.isPlaying, 'audioStarted:', state.audioStarted);

  // Ensure audio context is running
  if (!ensureAudioContext()) {
    debugError('❌ Cannot start playback - audio context not running');
    debugError('Context state:', Tone.context.state);
    return;
  }

  // Transport will be started at the end after all setup is complete
  debugLog('Transport state before setup:', Tone.getTransport().state);
  
  // Create synths if they don't exist (only for enabled layers)
  if (!droneSynth && AUDIO_CONFIG.drone.enabled) {
    debugLog('🔧 Creating synths...');
    if (AUDIO_CONFIG.drone.enabled) {
      droneSynth = createDroneSynth();
      debugLog('✅ Drone synth created, volume:', droneSynth.volume.value);
    }
    if (AUDIO_CONFIG.bell.enabled) {
      bellSynth = createBellSynth();
      debugLog('✅ Bell synth created, volume:', bellSynth.volume.value);
    }
    if (AUDIO_CONFIG.static.enabled) {
      // Build the static synth explicitly in ENGINE mode so it doesn't self-route
      staticSynth = createStaticSynth({ mode: "engine" });
      debugLog('✅ Static synth created (engine mode)');
    }
    if (AUDIO_CONFIG.choir.enabled) {
      choirSynth = createChoirSynth({ voices: 10, vowel: "ah", register: "bass" }); // new
      debugLog('✅ Choir synth created, volume:', choirSynth?.volume?.value ?? '(n/a)');
    }

    // Vibrato attachment temporarily disabled for compatibility
    // TODO: Re-implement vibrato properly for PolySynth
    debugLog('Vibrato attachment disabled for compatibility');

    debugLog('📊 Master volume:', Tone.Destination.volume.value);
    debugLog('🔗 Master limiter threshold:', masterLimiter ? `${masterLimiter.threshold.value} dB` : 'Not found');
  } else {
    debugLog('♻️ Using existing synths');
  }
  
  // Start with a random chord immediately for variety
  const initialDroneChord = createRandomChordVoicing(
    createMicrotonalChord(droneChords[seededRandom.nextInt(0, droneChords.length - 1)], 0.5),
    0.3
  );
  const initialBellChord = createRandomChordVoicing(
    createMicrotonalChord(bellChords[seededRandom.nextInt(0, bellChords.length - 1)], 0.3),
    0.2
  );

  // Build an initial choir chord that blends with the drone chord
  const initialChoirChord = createRandomChordVoicing(
    createMicrotonalChord(
      // reuse the same base chord pool to feel harmonically glued
      droneChords[seededRandom.nextInt(0, droneChords.length - 1)],
      0.45 // slightly less detune than drone
    ),
    0.25
  );

  debugLog('🎵 Choir initial chord computed:', initialChoirChord, 'Hz');

  // Track chord frequencies in Hz for static layer tuning
  currentDroneChordHz = initialDroneChord.map(f => Number(f)); // already Hz
  currentBellChordHz = initialBellChord.map(f => Number(f));
  currentChoirChordHz = initialChoirChord.map(f => Number(f));
  
  // Play initial chords with scheduled timing
  debugLog('🎵 Playing initial microtonal chords:', initialDroneChord, initialBellChord);
  debugLog('🎵 Audio context state before playing:', Tone.context.state);
  debugLog('🎵 Transport state:', Tone.getTransport().state);

  try {
    // Play initial chords with long durations for continuous drone from the start (only for enabled layers)
    if (AUDIO_CONFIG.drone.enabled && droneSynth) {
      Tone.getTransport().scheduleOnce((t) => {
        droneSynth.triggerAttackRelease(initialDroneChord, "10m", t);
        debugLog('✅ Drone chord triggered successfully');
      }, "+0");
    }

    // Start bells with overlapping timing for continuous sound
    if (AUDIO_CONFIG.bell.enabled && bellSynth) {
      Tone.getTransport().scheduleOnce((time) => {
        try {
        bellSynth.triggerAttackRelease(initialBellChord, "12m", time);

        // Optional: duck static when bells strike for clearer articulation
        if (AUDIO_CONFIG.static.enabled && staticSynth && staticSynth.gain) {
          const g = staticSynth.gain.gain;
          const pre = Math.max(0.0001, g.value); // Guard against zero values
          g.cancelScheduledValues(time);
          g.setTargetAtTime(pre * 0.6, time, 0.02);        // quick dip at scheduled time
          g.setTargetAtTime(pre, time + 0.15, 0.1);        // smooth return
        }

          debugLog('✅ Bell chord scheduled successfully');
        } catch (error) {
          debugError('❌ Error triggering bell chord:', error);
        }
      }, "+0.5m"); // Start bells after 0.5 measures for immediate overlap
    }

    // Schedule initial choir entrance a hair after drone to avoid transient pileup
    if (AUDIO_CONFIG.choir.enabled && choirSynth) {
      Tone.getTransport().scheduleOnce((time) => {
        try {
          choirSynth.triggerAttackRelease(initialChoirChord, "10m", time);

          // Duck static slightly on choir entrances
          if (AUDIO_CONFIG.static.enabled && staticSynth && staticSynth.gain) {
            const g = staticSynth.gain.gain;
            const pre = Math.max(0.0001, g.value);
            g.cancelScheduledValues(time);
            g.setTargetAtTime(pre * 0.7, time, 0.03);
            g.setTargetAtTime(pre, time + 0.18, 0.12);
          }

          debugLog('✅ Choir initial chord scheduled');
        } catch (e) {
          debugError('❌ Error triggering choir initial chord:', e);
        }
      }, "+0.75m");
    }

    debugLog('✅ Initial microtonal chords scheduled');
  } catch (error) {
    debugError('❌ Error triggering drone chord:', error);
  }

  debugLog('🔗 Drone synth initialized:', !!droneSynth && droneSynth.volume ? 'Yes' : 'No');
  debugLog('🔗 Bell synth initialized:', !!bellSynth && bellSynth.volume ? 'Yes' : 'No');
  
  // Create drone loop - ultra-frequent for continuous drone with heavy overlap (only if enabled)
  if (AUDIO_CONFIG.drone.enabled && droneSynth) {
    let lastDroneIndex = -1;
    const loopInterval = "2m"; // Very frequent for continuous sound
    const baseNoteDuration = 10; // Reduced from 12 to lower overlap and voice stealing
    const noteDuration = "10m"; // Long duration for continuous sound

    droneLoop = new Tone.Loop((time) => {
      // Randomly select a chord, but avoid repeating the same one twice in a row
      let randomIndex;
      do {
        randomIndex = seededRandom.nextInt(0, droneChords.length - 1);
      } while (randomIndex === lastDroneIndex && droneChords.length > 1);

      lastDroneIndex = randomIndex;
      const baseChord = droneChords[randomIndex];

      // Apply microtonal variations to the chord
      const microtonalChord = createMicrotonalChord(baseChord, 0.6); // 60% of notes get microtonal variation

      // Add random chord voicing variations
      const voicedChord = createRandomChordVoicing(microtonalChord, 0.4); // 40% of notes get voicing variation

      // Add random timing variation (reduced for continuous sound)
      const variedTime = addRandomTimingVariation(time, 0.1);

      // Add random duration variation using numeric base duration (smaller variation for continuous sound)
      const variedDurationMeasures = addRandomDurationVariation(baseNoteDuration, 0.1);
      const variedDuration = Tone.Time(variedDurationMeasures + "m").toSeconds();

      // Add random modulation variations to the synth (outside of scheduled callback to avoid timing issues)
      const baseParams = {
        harmonicity: 0.5,
        modulationIndex: 1
      };
      addRandomModulationVariation(droneSynth, baseParams);

      // Track chord frequencies in Hz for static layer tuning
      currentDroneChordHz = voicedChord.map(f => Number(f));

      debugLog('🎵 Drone loop playing microtonal voiced chord:', voicedChord, 'at varied time:', variedTime);
      // Play notes with microtonal variations and controlled randomness
      try {
      droneSynth.triggerAttackRelease(voicedChord, variedDuration, variedTime);
        debugLog('✅ Drone loop chord triggered');
      } catch (error) {
        debugError('❌ Error in drone loop:', error);
      }
    }, loopInterval).start("3m"); // Start drone loop after 3 measures for overlap with initial chord
    debugLog('🔄 Drone loop created and started');
  }

  // Create bell loop with random chord selection and random timing - ultra-frequent for continuous drone (only if enabled)
  if (AUDIO_CONFIG.bell.enabled && bellSynth) {
    let lastBellIndex = -1;
    const bellInterval = "2.5m"; // Very frequent for continuous sound with slight offset from drone
    const baseBellDuration = 12; // Reduced from 14 to lower overlap and voice stealing
    const bellDuration = "12m"; // Long duration for continuous sound

    bellLoop = new Tone.Loop((time) => {
    // Randomly select a bell chord, avoiding immediate repetition
    let randomIndex;
    do {
      randomIndex = seededRandom.nextInt(0, bellChords.length - 1);
    } while (randomIndex === lastBellIndex && bellChords.length > 1);
    
    lastBellIndex = randomIndex;
    const baseChord = bellChords[randomIndex];
    
    // Apply microtonal variations to the bell chord (more subtle than drone)
    const microtonalChord = createMicrotonalChord(baseChord, 0.4); // 40% of notes get microtonal variation
    
    // Add random chord voicing variations for bells
    const voicedBellChord = createRandomChordVoicing(microtonalChord, 0.3); // 30% of notes get voicing variation
    
    // Add random delay with minimal variation to avoid gaps
    const randomDelay = seededRandom.nextFloat(0, 1);  // Minimal delay variation for continuous sound

    // Add random duration variation for bells using numeric base duration (smaller variation)
    const variedBellDurationMeasures = addRandomDurationVariation(baseBellDuration, 0.1);
    const variedBellDuration = Tone.Time(variedBellDurationMeasures + "m").toSeconds();
    
    // Add random modulation variations to the bell synth (outside of scheduled callback to avoid timing issues)
    const bellBaseParams = {
      harmonicity: 2.5,
      modulationIndex: 8
    };
    addRandomModulationVariation(bellSynth, bellBaseParams);

    // Track chord frequencies in Hz for static layer tuning
    currentBellChordHz = voicedBellChord.map(f => Number(f));

    Tone.getTransport().scheduleOnce((scheduledTime) => {
      debugLog('🎵 Bell loop playing microtonal voiced chord:', voicedBellChord, 'at scheduled time:', scheduledTime);
      try {
      bellSynth.triggerAttackRelease(voicedBellChord, variedBellDuration, scheduledTime);

      // Optional: duck static when bells strike for clearer articulation
      if (staticSynth && staticSynth.gain) {
        const g = staticSynth.gain.gain;
        const pre = Math.max(0.0001, g.value); // Guard against zero values
        g.cancelScheduledValues(scheduledTime);
        g.setTargetAtTime(pre * 0.6, scheduledTime, 0.02);        // quick dip at scheduled time
        g.setTargetAtTime(pre, scheduledTime + 0.15, 0.1);        // smooth return
      }

        debugLog('✅ Bell loop chord triggered');
      } catch (error) {
        debugError('❌ Error in bell loop:', error);
      }
    }, time + randomDelay);
    }, bellInterval).start("4m"); // Start bell loop after 4 measures for overlap with initial chords and drone loop
    debugLog('🔄 Bell loop created and started');
  }

  // Choir loop - long phrases with gentle vowel morphs (only if enabled)
  if (AUDIO_CONFIG.choir.enabled && choirSynth) {
    let lastChoirIndex = -1;
    const choirInterval = "3m";        // slower than drone, faster than bells
    const baseChoirDurM = 12;          // long sustain to layer
    const choirVowels = ["ah","oo","eh","ah"]; // simple cycle in bass register

    let choirVowelIndex = 0;

    choirLoop = new Tone.Loop((time) => {
    // choose a base chord from either drone or bell pool to keep harmonic glue
    const useDronePool = seededRandom.nextFloat(0,1) < 0.6;
    const pool = useDronePool ? droneChords : bellChords;

    let idx;
    do {
      idx = seededRandom.nextInt(0, pool.length - 1);
    } while (idx === lastChoirIndex && pool.length > 1);
    lastChoirIndex = idx;

    const baseChord = pool[idx];

    // Subtle microtonalization and light voicing spread
    const micro = createMicrotonalChord(baseChord, 0.35);
    const voiced = createRandomChordVoicing(micro, 0.25);

    // Duration and tiny start jitter
    const durM = addRandomDurationVariation(baseChoirDurM, 0.1);
    const durSec = Tone.Time(`${durM}m`).toSeconds();
    const t0 = addRandomTimingVariation(time, 0.06);

    // Occasionally change the vowel
    if (seededRandom.nextFloat(0,1) < 0.35) {
      choirVowelIndex = (choirVowelIndex + 1) % choirVowels.length;
      const nextVowel = choirVowels[choirVowelIndex];
      debugLog('🎵 Choir loop: Morphing vowel to', nextVowel);
      choirSynth.setVowel(nextVowel, "bass");
    }

    // Update shared chord tracker for static engine tuning
    currentChoirChordHz = voiced.map(f => Number(f));

    // 10% chance to throw a short scream burst on top of the sustained chord
    if (seededRandom.nextFloat(0,1) < 0.10) {
      const pick = voiced[seededRandom.nextInt(0, voiced.length - 1)];
      const up = seededRandom.nextFloat(0,1) < 0.6;
      const when = t0 + seededRandom.nextFloat(0.05, 0.25);
      const duration = 0.5 + seededRandom.nextFloat(0, 0.25);
      debugLog('🎵 Choir loop: Triggering scream burst', { frequency: pick, duration, up, intensity: 0.85 });
      choirSynth.screamBurst(pick, duration, { up, intensity: 0.85, when });
    }

    // Sidechain static on entrance for clarity
    Tone.getTransport().scheduleOnce((tt) => {
      try {
        choirSynth.triggerAttackRelease(voiced, durSec, tt);

        if (staticSynth && staticSynth.gain) {
          const g = staticSynth.gain.gain;
          const pre = Math.max(0.0001, g.value);
          g.cancelScheduledValues(tt);
          g.setTargetAtTime(pre * 0.7, tt, 0.02);
          g.setTargetAtTime(pre, tt + 0.15, 0.1);
        }

        debugLog('🎶 Choir loop chord triggered', voiced);
      } catch (e) {
        debugError('❌ Choir loop error:', e);
      }
    }, t0);

  }, choirInterval).start("3.5m"); // starts between drone (3m) and bell (4m)
  debugLog('🔄 Choir loop created and started');
  }

  // Create rhythmic static engine (only if enabled)
  if (AUDIO_CONFIG.static.enabled && staticSynth) {
    // No need to disconnect - static synth was created in ENGINE mode (never connected directly)
    if (!staticEngine) {
      staticEngine = createStaticRhythmEngine(staticSynth);
    }

    // Start the rhythmic static engine instead of random loop
    staticEngine.start("5m");
    debugLog('🔄 Static rhythm engine started');
  }

  // Keep the old staticLoop variable for compatibility but don't use it
  staticLoop = {
    stop: () => {
      if (staticEngine) staticEngine.stop();
    },
    dispose: () => {
      if (staticEngine) staticEngine.dispose();
      staticEngine = null;
    }
  };

  // Removed old random static loop - replaced with rhythmic engine above

  // Start dynamic BPM system for microtonal tempo variations
  startDynamicBPM();

  // Start the transport (only once, after all setup is complete)
  if (Tone.getTransport().state === "stopped") {
    Tone.getTransport().start();
    debugLog('Transport started with dynamic BPM system');
  }
}

function stop() {
  if (AUDIO_CONFIG.drone.enabled && droneLoop) droneLoop.stop();
  if (AUDIO_CONFIG.bell.enabled && bellLoop) bellLoop.stop();
  if (AUDIO_CONFIG.choir.enabled && choirLoop) choirLoop.stop();
  if (AUDIO_CONFIG.static.enabled && staticEngine) staticEngine.stop();

  // Stop dynamic BPM system
  stopDynamicBPM();

  Tone.getTransport().stop();
  // State will be synced by audio-control.js
  debugLog('Playback stopped');
}

// Proper teardown function for complete cleanup
function disposeAll(){
  // Only dispose loops that were actually created (for enabled layers)
  if (AUDIO_CONFIG.drone.enabled && droneLoop) droneLoop.dispose();
  if (AUDIO_CONFIG.bell.enabled && bellLoop) bellLoop.dispose();
  if (AUDIO_CONFIG.choir.enabled && choirLoop) choirLoop.dispose();
  if (AUDIO_CONFIG.static.enabled && staticEngine) { staticEngine.dispose(); staticEngine = null; }

  // Only dispose synths that were actually created (for enabled layers)
  if (AUDIO_CONFIG.drone.enabled && droneSynth) droneSynth.dispose();
  if (AUDIO_CONFIG.bell.enabled && bellSynth) bellSynth.dispose();
  if (AUDIO_CONFIG.choir.enabled && choirSynth) choirSynth.dispose();
  if (AUDIO_CONFIG.static.enabled && staticSynth) {
    if (staticSynth.dispose) staticSynth.dispose();
    else if (staticSynth.noise) staticSynth.noise?.dispose?.();
  }

  // Clean up dynamic BPM system
  stopDynamicBPM();

  // Stop level logging to prevent background spam
  if (levelLogId) {
    clearInterval(levelLogId);
    levelLogId = null;
  }

  // Clear all references
  droneLoop=bellLoop=choirLoop=staticLoop=droneSynth=bellSynth=choirSynth=staticSynth=null;
}

function resume() {
  const state = syncAudioState();
  if (state.audioStarted && !state.isPlaying) {
    play();
  }
}

// Simple test tone for debugging
function testTone() {
  const synth = new Tone.Synth().connect(masterCompressor);
  const t = transportNow();
  // Use a Transport callback if the Transport is running; else trigger immediately at audio-time.
  if (Tone.getTransport().state === "started") {
    Tone.getTransport().scheduleOnce((time) => {
      synth.triggerAttackRelease("C4", "8n", time);
      Tone.getTransport().scheduleOnce(() => synth.dispose(), "+0.6");
    }, "+0");
  } else {
    synth.triggerAttackRelease("C4", "8n", t);
    setTimeout(() => synth.dispose(), 600);
  }
  debugLog('Test tone played');
}

// Integration with audio-control.js - this will be set up when audio-control.js loads
let audioControlReady = false;

// Wait for audio-control.js to be ready and set up callbacks
function initializeAudioIntegration() {
  if (window.audioControl && !audioControlReady) {
    audioControlReady = true;
    window.audioControl.setCallbacks({
      start: play,
      stop: stop,
      resume: resume
    });
    debugLog('Audio integration initialized');
  }
}

// Check periodically for audio control readiness
const checkAudioControl = setInterval(() => {
  if (window.audioControl) {
    initializeAudioIntegration();
    clearInterval(checkAudioControl);
  }
}, 100);

// Also check if Tone.js context is ready
async function ensureAudioContext() {
  if (Tone.context.state !== 'running') {
    try {
      await Tone.start(); // must be inside user-initiated call path
      debugLog('Audio context started');
    } catch (e) {
      debugError('Failed to start audio context', e);
      return false;
    }
  }
  return true;
}
      
// Audio state management - synced with audio-control.js
// Variables are declared in audio-control.js to avoid conflicts

// Update local state when audio control state changes
function syncAudioState() {
  if (window.audioControl) {
    const state = window.audioControl.getState();
    // Access state through audioControl instead of local variables
    return {
      isPlaying: state.isPlaying,
      audioStarted: state.audioStarted
    };
  }
  return { isPlaying: false, audioStarted: false };
}

// Smoke test to verify audio bus works
function smokeTest() {
  const s = new Tone.Synth().connect(masterCompressor); // goes through tailEQ -> limiter
  s.volume.value = -6;
  const t = transportNow();

  if (Tone.getTransport().state === "started") {
    Tone.getTransport().scheduleOnce((time) => {
      s.triggerAttackRelease("A4", 1, time);
    }, "+0");
    Tone.getTransport().scheduleOnce(() => s.dispose(), "+1.2");
  } else {
    s.triggerAttackRelease("A4", 1, t);
    setTimeout(() => s.dispose(), 1200);
  }
}

// Expose functions to window for debugging
window.debugAudio = {
  testTone: testTone,
  seedRandom: seedRandom,
  getCurrentSeed: getCurrentSeed,
  smokeTest: smokeTest,
  startDynamicBPM: startDynamicBPM,
  stopDynamicBPM: stopDynamicBPM,
  updateAudioConfig: updateAudioConfig,
  getAudioConfig: getAudioConfig,
  rampBPM: rampBPM,
  transportNow: transportNow,
  testStatic: () => {
    debugLog('Testing static synth directly...');

    if (Tone.context.state !== 'running') {
      debugLog('Starting audio context...');
      Tone.start().then(() => debugLog('Audio context started'));
    }

    if (!staticSynth) {
      debugLog('Creating static synth for testing...');
      staticSynth = createStaticSynth();
    }

    const t = transportNow();
    staticSynth.noise.playbackRate.value = 0.8 + Math.random() * 0.8;

    if (Tone.getTransport().state === "started") {
      // triggerStatic() now defaults to Transport time; make it explicit:
      staticSynth.triggerStatic("8n", -12, t);
    } else {
      // Fallback: let its internal default use Tone.now()
      staticSynth.triggerStatic("8n", -12);
    }

    debugLog('Test static burst scheduled');
  },
  testSynth: () => {
    debugLog('Testing synth directly...');

    if (Tone.context.state !== 'running') {
      debugLog('Starting audio context...');
      Tone.start().then(() => debugLog('Audio context started'));
    }

    const testSynth = new Tone.PolySynth(Tone.FMSynth).connect(masterCompressor);
    testSynth.volume.value = -5;

    const t = transportNow();
    const play = (time) => testSynth.triggerAttackRelease(["C3","E3","G3"], "2n", time);

    if (Tone.getTransport().state === "started") {
      Tone.getTransport().scheduleOnce((time) => play(time), "+0");
      Tone.getTransport().scheduleOnce(() => { testSynth.dispose(); debugLog('Test synth disposed'); }, "+2.2");
    } else {
      play(t);
      setTimeout(() => { testSynth.dispose(); debugLog('Test synth disposed'); }, 2200);
    }
  },
  testChoir: () => {
    debugLog('🎵 Testing choir synth...');

    if (Tone.context.state !== 'running') {
      debugLog('Starting audio context...');
      Tone.start().then(() => debugLog('✅ Audio context started'));
    }

    if (!choirSynth) {
      debugLog('🔧 Creating choir synth for testing...');
      choirSynth = createChoirSynth({ voices: 8, vowel: "ah", register: "bass" });
      debugLog('✅ Choir synth created');
    }

    const t = transportNow();
    const doPlay = (time) => choirSynth.triggerAttackRelease([220, 330, 440], "2n", time);

    if (Tone.getTransport().state === "started") {
      Tone.getTransport().scheduleOnce((time) => doPlay(time), "+0");
    } else {
      doPlay(t);
    }

    debugLog('✅ Test choir scheduled');
  },
  testScream: () => {
    debugLog('🎵 Testing choir scream mode...');

    if (Tone.context.state !== 'running') {
      debugLog('Starting audio context...');
      Tone.start().then(() => debugLog('✅ Audio context started'));
    }

    if (!choirSynth) {
      debugLog('🔧 Creating choir synth for testing...');
      choirSynth = createChoirSynth({ voices: 8, vowel: "ah", register: "bass" });
      debugLog('✅ Choir synth ready for scream testing');
    }

    const t = transportNow();
    const doBurst = (time) => choirSynth.screamBurst(440, 1.0, { up: true, intensity: 0.9, when: time });

    if (Tone.getTransport().state === "started") {
      Tone.getTransport().scheduleOnce((time) => doBurst(time), "+0");
    } else {
      doBurst(t);
    }

    debugLog('✅ Test scream scheduled');
  },
  play: play,
  stop: stop,
  resume: resume,
  disposeAll: disposeAll,
  status: () => {
    debugLog('=== Drone Audio Status ===');
    const state = syncAudioState();
    debugLog('Audio started:', state.audioStarted);
    debugLog('Is playing:', state.isPlaying);
    debugLog('Current seed:', currentSeed, '(use seedRandom(' + currentSeed + ') to reproduce)');
    debugLog('Tone.js loaded:', typeof Tone !== 'undefined');
    if (typeof Tone !== 'undefined') {
      debugLog('Context state:', Tone.context.state);
      debugLog('Transport state:', Tone.getTransport().state);
      debugLog('Transport BPM:', Tone.getTransport().bpm.value);
      debugLog('Destination muted:', Tone.Destination.mute);
      debugLog('Master volume:', Tone.Destination.volume.value, 'dB');
      debugLog('PreMaster gain:', Tone.gainToDb(preMaster.gain.value).toFixed(1), 'dB');
    }
    debugLog('Drone synth exists:', !!droneSynth);
    debugLog('Bell synth exists:', !!bellSynth);
    debugLog('Choir synth exists:', !!choirSynth);
    debugLog('Static synth exists:', !!staticSynth);
    debugLog('Master limiter active:', !!masterLimiter);
    if (masterLimiter) {
      debugLog('Limiter threshold:', `${masterLimiter.threshold.value} dB (prevents output from exceeding this level)`);
    }
    debugLog('Audio configuration:', getAudioConfig());
    if (window.audioControl) {
      debugLog('Audio control integration:', 'Active');
      const controlState = window.audioControl.getState();
      debugLog('Control state:', controlState);
    } else {
      debugLog('Audio control integration:', 'Not loaded yet');
    }
  }
};

debugLog('🎵 Drone.js loaded. Audio controls are managed by audio-control.js');