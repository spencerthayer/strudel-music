import typer
from rich.console import Console
from rich.table import Table

import pandas as pd
import sounddevice as sd
import supriya.scsynth


info_app = typer.Typer(
    name="info",
    help="Display information about Supriya Music Toolkit.",
)


console = Console()


@info_app.callback(invoke_without_command=True)
def info(ctx: typer.Context):
    console.print("[bold green]Supriya Music Toolkit[/bold green]")
    console.print("Version: [cyan]1.0.0[/cyan]")
    console.print(
        "Description: [cyan]A toolkit for music synthesis and algorithmic composition using Supriya.[/cyan]"
    )
    scsynth_location = supriya.scsynth.find()
    console.print(f"scsynth Location: [cyan]{scsynth_location}[/cyan]")


@info_app.command(name="devices")
def devices(
    columns: list[str] = typer.Option(
        None, "--columns", "-c", help="Specify columns to display."
    )
):
    console.print("[bold green]Audio Devices[/bold green]")
    devices = list(sd.query_devices())

    df = pd.DataFrame(devices)
    df = df.round(2)
    if columns:
        df = df[columns]
    table = Table(show_header=True, header_style="bold magenta")
    for col in df.columns:
        col_name = "\n".join(col.split("_"))
        table.add_column(col_name)
    for _, row in df.iterrows():
        table.add_row(*[str(row[col]) for col in df.columns])
    console.print(table)
