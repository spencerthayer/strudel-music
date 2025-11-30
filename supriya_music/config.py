import logging
import os
import yaml


SUPRIYA_CONFIG_PATH = os.environ.get("SUPRIYA_CONFIG_PATH")
if SUPRIYA_CONFIG_PATH and os.path.exists(SUPRIYA_CONFIG_PATH):
    CONFIG_PATH = SUPRIYA_CONFIG_PATH
else:
    CONFIG_PATH = os.path.join(os.getcwd(), "supriya.config.yaml")

try:
    with open(CONFIG_PATH, "r") as config_file:
        CONFIG = yaml.safe_load(config_file)
except (FileNotFoundError, Exception) as e  :
    logging.warning(
        f"Could not load configuration from {CONFIG_PATH}: {e}"
    )
    CONFIG = {}
