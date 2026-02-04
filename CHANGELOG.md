CHANGELOG
===

0.2.1
---

Validate selector strings passed to `createXMLEditor` (for now, very basic.
Just making sure there is only one space between element names in each
selector).

Fix issue where in some cases a selectors would match against the
suffixes/endings of elements, and not always the full element name
(e.g.,the selector `"steak"` would sometimes match elements like
`<mistake>`).

0.2.0
---

Significantly improve performance of selector matching.

Add validation checks for created or modified XML element attribute names.

Add config option, currently just with 1. the ability to disable validation
of outgoing XML, and 2. configuring the "saxes" parser.

Hopefully more helpful, additional text in README.md.

0.1.1
---

Whoops, include the finished README.md and this file (CHANGELOG.md).

0.1.0
---

Initial release
