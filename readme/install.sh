#!/usr/bin/env bash
# add as dependency to your project
deno add jsr:@hugojosefson/calendar-filter

# ...or...

# create and enter a directory for the script
mkdir -p "calendar-filter"
cd       "calendar-filter"

# download+extract the script, into current directory
curl -fsSL "https://github.com/hugojosefson/calendar-filter/tarball/main" \
  | tar -xzv --strip-components=1
