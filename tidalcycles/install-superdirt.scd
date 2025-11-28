// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  SUPERDIRT INSTALLATION SCRIPT FOR TIDALCYCLES                            ║
// ║  Run these steps ONCE to install SuperDirt and its dependencies          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: INSTALL SUPERDIRT QUARK
// Select the code block below and press Cmd+Enter to evaluate
// ═══════════════════════════════════════════════════════════════════════════

(
"╔═══════════════════════════════════════════════════════╗".postln;
"║  Installing SuperDirt and dependencies...            ║".postln;
"║  This may take 2-5 minutes. Please wait.             ║".postln;
"╚═══════════════════════════════════════════════════════╝".postln;

Quarks.checkForUpdates({
    Quarks.install("SuperDirt", "v1.7.3");
    
    "".postln;
    "╔═══════════════════════════════════════════════════════╗".postln;
    "║  ✓ SuperDirt installed successfully!                 ║".postln;
    "║                                                       ║".postln;
    "║  NEXT STEP:                                           ║".postln;
    "║  Press Cmd+Shift+L to recompile class library        ║".postln;
    "║  Or: Menu → Language → Recompile Class Library       ║".postln;
    "╚═══════════════════════════════════════════════════════╝".postln;
});
)

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: RECOMPILE CLASS LIBRARY
// After installation completes above, press: Cmd+Shift+L
// You should see: "compiled XXX files" with NO ERRORS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: START SUPERDIRT
// After recompiling, select and evaluate this code block (Cmd+Enter)
// ═══════════════════════════════════════════════════════════════════════════

(
s.reboot { 
    s.waitForBoot {
        "".postln;
        "╔═══════════════════════════════════════════════════════╗".postln;
        "║  Booting SuperDirt...                                 ║".postln;
        "╚═══════════════════════════════════════════════════════╝".postln;
        
        ~dirt.free; // Free any existing instance
        ~dirt = SuperDirt(2, s); // 2 output channels
        
        // Load all sample banks
        ~dirt.loadSoundFiles;
        
        // Optional: Add custom sample folders
        // ~dirt.loadSoundFiles("~/Music/Samples/*");
        
        s.sync; // Wait for samples to load
        
        // Start listening on port 57120 with 12 orbits
        ~dirt.start(57120, 0 ! 12);
        
        "".postln;
        "╔═══════════════════════════════════════════════════════╗".postln;
        "║  ✓ SuperDirt is running on port 57120                ║".postln;
        "║  ✓ Ready for TidalCycles!                            ║".postln;
        "║                                                       ║".postln;
        "║  Next: In Cursor/VS Code, open start.tidal           ║".postln;
        "║  Then: Cmd+Shift+P → 'TidalCycles: Start Tidal'      ║".postln;
        "╚═══════════════════════════════════════════════════════╝".postln;
    };
};
)

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUPERDIRT (Optional)
// Play a test sound to verify everything works
// ═══════════════════════════════════════════════════════════════════════════

// Play a kick drum
(~dirt.noteOn(60, (sound: "bd", orbit: 0)))

// Play a pattern for 4 beats
(
Tdef(\test, {
    4.do {
        ~dirt.noteOn(60, (sound: "bd", orbit: 0));
        0.5.wait;
        ~dirt.noteOn(60, (sound: "sn", orbit: 0));
        0.5.wait;
    };
}).play;
)

// Stop the test pattern
Tdef(\test).stop;

// ═══════════════════════════════════════════════════════════════════════════
// TROUBLESHOOTING
// ═══════════════════════════════════════════════════════════════════════════

// Check if SuperDirt is installed:
Quarks.installed;
// Look for "SuperDirt" in the list

// Check which version is installed:
Quarks.installed.detect({|q| q.name == "SuperDirt"}).version;

// Uninstall SuperDirt if you need to reinstall:
Quarks.uninstall("SuperDirt");

// Check if server is running:
s.status;

// Boot server manually if needed:
s.boot;

// Reboot server:
s.reboot;

// Kill and restart everything:
(
s.quit;
s.waitForBoot {
    ~dirt.free;
    ~dirt = SuperDirt(2, s);
    ~dirt.loadSoundFiles;
    s.sync;
    ~dirt.start(57120, 0 ! 12);
    "SuperDirt restarted!".postln;
};
)

// Check available synths (should see superfm, supersaw, etc.):
SynthDescLib.global.synthDescs.keys.asArray.sort.do(_.postln);

// View loaded samples:
~dirt.soundLibrary.postln;

// ═══════════════════════════════════════════════════════════════════════════
// COMMON ERRORS
// ═══════════════════════════════════════════════════════════════════════════

/*
ERROR: "Class not defined" for SuperDirt
→ SuperDirt not installed yet. Run STEP 1 above.

ERROR: "Quark not found"
→ Run: Quarks.checkForUpdates; then try installing again

ERROR: Server failed to boot
→ Check: System Preferences → Security → Allow SuperCollider
→ Or run: s.options.device = nil; s.boot;

ERROR: Port 57120 already in use
→ Another instance is running. Run: s.quit; then try again

No sound when playing patterns
→ Check volume/audio output in macOS System Preferences
→ Run: s.volume = 0.5; to test server output
→ Check: ~dirt.orbits.do(_.outBus.postln); // should show audio buses
*/

