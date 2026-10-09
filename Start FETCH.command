#!/bin/zsh
# Double-click this file to start FETCH on this computer and open it in the browser.
# Close this Terminal window (or press Ctrl+C in it) to stop the system.

cd "$(dirname "$0")" || exit 1

# Node is installed through nvm on this Mac; load it if it is not already on the PATH.
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org and try again."
  read -r "?Press Enter to close."
  exit 1
fi

# Already running? Then just open it.
if curl -s -o /dev/null http://localhost:8000/login.html; then
  echo "FETCH is already running. Opening it in the browser."
  open "http://localhost:8000"
  exit 0
fi

echo "Starting FETCH at http://localhost:8000 ..."
echo "Leave this window open while you use the system. Close it to stop."
echo

# Open the browser as soon as the server answers.
( for i in {1..60}; do
    if curl -s -o /dev/null http://localhost:8000/login.html; then open "http://localhost:8000"; break; fi
    sleep 1
  done ) &

node backend/server.js
