# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## Unreleased

### Added
- Added a new `anyToHex` API to the `Transformations` module. This uses a canvas to convert any value to a hex colour #TINY-7480

### Changed
- `HexColour.fromString` will now normalize the hex value to strip the leading `#` if present and uppercase the values #TINY-7480
