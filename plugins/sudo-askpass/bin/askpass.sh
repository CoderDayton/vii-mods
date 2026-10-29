#!/bin/sh
# SUDO_ASKPASS helper: shows the command Claude wants to run as root and reads the
# password in a dialog. The password goes to sudo on stdout and nowhere else.
# Exit status is non-zero on Cancel or timeout, which fails the sudo call.
cmd=${CLAUDE_SUDO_CMD:-unknown command}
shown=$(printf '%s' "$cmd" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')

exec zenity --entry --hide-text --modal \
  --timeout="${CLAUDE_SUDO_TIMEOUT:-120}" \
  --title="Claude Code wants root" \
  --text="Claude is running:

$shown

Enter your password to allow it. Cancel refuses."
