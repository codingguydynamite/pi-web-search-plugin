# SearXNG instance for pi-searxng-search.
#
# Uses the official SearXNG image (AGPL-3.0) with a minimal settings file
# that enables the JSON API this plugin needs.
#
#   docker build -t searxng-local .
#   docker run -d --name searxng-local \
#     -p 8080:8080 \
#     -v searxng-settings:/etc/searxng \
#     searxng-local
#
# (Or just use docker-compose.example.yml, which is the easier path.)

FROM searxng/searxng:latest

# Minimal local settings: JSON API enabled, LAN binding, no limiter.
# The entrypoint only creates settings.yml if it is missing, so mounting
# this file makes it take effect.
COPY searxng/settings.yml /etc/searxng/settings.yml
