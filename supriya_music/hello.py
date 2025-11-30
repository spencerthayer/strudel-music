import sys
import time

import supriya
from supriya import Envelope, synthdef
from supriya.exceptions import ServerCannotBoot
from supriya.ugens import EnvGen, Out, SinOsc
from rich.console import Console
from rich.panel import Panel
from rich.tree import Tree

from .config import CONFIG, CONFIG_PATH


def _explain():
    """Explain the steps that the hello function performs using Rich formatting."""
    console = Console()

    # Create a tree structure to show the process
    tree = Tree("🎵 [bold blue]Supriya Hello Example Steps[/bold blue]")

    # Server setup
    server_branch = tree.add("🖥️  [bold green]Server Setup[/bold green]")
    server_branch.add("Create Supriya server instance")
    server_branch.add("Boot SuperCollider synthesis server (scsynth)")

    # SynthDef creation
    synthdef_branch = tree.add("🔧 [bold yellow]SynthDef Creation[/bold yellow]")
    synthdef_branch.add("Define [cyan]simple_sine[/cyan] synthdef with parameters:")
    params_branch = synthdef_branch.add("Parameters:")
    params_branch.add("[magenta]frequency[/magenta] = 440 Hz (default)")
    params_branch.add("[magenta]amplitude[/magenta] = 0.1 (volume)")
    params_branch.add("[magenta]gate[/magenta] = 1 (envelope trigger)")

    audio_branch = synthdef_branch.add("Audio signal chain:")
    audio_branch.add("SinOsc.ar() → Generate sine wave")
    audio_branch.add("EnvGen.kr() → Apply ADSR envelope")
    audio_branch.add("Out.ar() → Output to speakers (stereo)")

    # Synthesis process
    synth_branch = tree.add("🎶 [bold cyan]Synthesis Process[/bold cyan]")
    synth_branch.add("Add synthdef to server")
    synth_branch.add("Synchronize server state")
    synth_branch.add("Create group to organize synths")

    play_branch = synth_branch.add("Play sequence:")
    play_branch.add("Create synth at 220 Hz (A3)")
    play_branch.add("Create synth at 440 Hz (A4) - one octave higher")
    play_branch.add("Create synth at 880 Hz (A5) - two octaves higher")
    play_branch.add("Each synth plays for 1 second")

    cleanup_branch = synth_branch.add("Cleanup:")
    cleanup_branch.add("Free each synth individually")
    cleanup_branch.add("Wait 1 second between each release")

    # Server teardown
    teardown_branch = tree.add("🔚 [bold red]Server Teardown[/bold red]")
    teardown_branch.add("Quit SuperCollider server")
    teardown_branch.add("Clean up resources")

    # Display the explanation
    console.print(
        Panel(
            tree,
            title="🎵 Supriya Hello Example Explanation",
            border_style="bright_blue",
            padding=(1, 2),
        )
    )

    # Additional technical details
    console.print("\n[bold]Technical Notes:[/bold]")
    console.print("• [cyan]SinOsc.ar()[/cyan] - Audio rate sine wave oscillator")
    console.print("• [cyan]EnvGen.kr()[/cyan] - Control rate envelope generator")
    console.print("• [cyan]ADSR[/cyan] - Attack, Decay, Sustain, Release envelope")
    console.print(
        "• [cyan]done_action=2[/cyan] - Free the synth when envelope completes"
    )
    console.print("• [cyan]Frequencies[/cyan] - Each octave doubles the frequency")


def hello(explain: bool = False):
    console = Console()
    if explain:
        _explain()
        return

    # Construct a Supriya server

    # Boot the server - Start a SCSynth process
    # Use configuration options if available
    if CONFIG.get("audio"):
        console.print(f"Booting server with audio configuration from {CONFIG_PATH}.")
        console.print(f"Attempting Configuration:", CONFIG["audio"])

        options = supriya.Options(**CONFIG["audio"])
        try:

            server = supriya.Server()
            server.boot(options=options)
        except ServerCannotBoot:
            console.print(
                f"[bold red]Failed to boot server with provided options, doublecheck your configuration in {CONFIG_PATH}.[/bold red]"
            )
            console.print(
                "[bold red]For more information try running 'supriya_music info devices' (`python -m supriya_music info devices`) to list available audio devices.[/bold red]"
            )
            sys.exit(1)
    else:
        console.print(
            "No audio configuration found, booting server with default options."
        )
        server = supriya.Server()
        server.boot()

    # Define a simple sine wave synthdef
    @synthdef()
    def simple_sine(frequency=440, amplitude=0.1, gate=1):
        sine = SinOsc.ar(frequency=frequency) * amplitude
        envelope = EnvGen.kr(envelope=Envelope.adsr(), gate=gate, done_action=2)
        Out.ar(bus=0, source=[sine * envelope] * 2)

    try:
        # Add the synthdef to the server
        server.add_synthdefs(simple_sine)

        # Ensure the server is synchronized
        server.sync()

        # Create a group to hold the synths
        group = server.add_group()

        # Create and play multiple synths with different frequencies
        for i in range(3):
            freq = 220 * (2**i)
            synth = group.add_synth(simple_sine, frequency=freq, amplitude=0.1)
            time.sleep(1)

        # Free each synth after a delay
        for synth in group.children:
            synth.free()
            time.sleep(1)
    finally:
        # Quit the server
        server.quit()


if __name__ == "__main__":
    hello()
