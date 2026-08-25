#!/usr/bin/env bash
# Add the package to your project.
deno add jsr:@hugojosefson/calendar-filter

# Or download the source.

# Create and enter its directory.
mkdir -p "calendar-filter"
cd "calendar-filter"

# Download and extract the source into the current directory.
curl -fsSL "https://github.com/hugojosefson/calendar-filter/tarball/main" \
  | tar -xzv --strip-components=1
