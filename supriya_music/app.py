import typer
from pathlib import Path
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from .hello import hello
from .info import info_app

app = typer.Typer(
    name="supriya music",
    help="Supriya music toolkit command line interface.",
    no_args_is_help=False,
)
app.add_typer(info_app, name="info", help="Display information about Supriya Music Toolkit.")

console = Console()

app.command(name="hello")(hello)


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context):
    """Main callback that runs greet by default when no command is specified."""
    if ctx.invoked_subcommand is None:
        # Read and render the README.md file
        readme_path = Path(__file__).parent / "README.md"

        try:
            readme_content = readme_path.read_text()
            markdown = Markdown(readme_content)

            # Display the README with a panel
            console.print(
                Panel(
                    markdown,
                    title="🎵 Supriya Music Toolkit",
                    border_style="bright_blue",
                    padding=(1, 2),
                )
            )

        except FileNotFoundError:
            console.print(
                Panel(
                    "Welcome to Supriya Music!\n\nThis toolkit provides basic examples for using the Supriya system.",
                    title="🎵 Supriya Music Toolkit",
                    border_style="bright_blue",
                )
            )


if __name__ == "__main__":
    app()
