# Hershey fonts

Three Hershey fonts in James Hurt's JHF format, read into hands by
`hdf hand --hershey <file> --name <id>` (plan 4.0 T3, `core/hershey.js`):

| file | from | hand | map |
|---|---|---|---|
| `romans.jhf` | `rowmans.jhf` (Roman simplex) | `hershey-romans` | ascii |
| `scripts.jhf` | `scripts.jhf` (Script simplex) | `hershey-script` | ascii |
| `cyrillic.jhf` | `cyrillic.jhf` (Cyrillic complex) | `hershey-cyrillic` | cyrillic |

Taken unchanged from <https://github.com/kamalmostafa/hershey-fonts>
(`hershey-fonts/*.jhf`), which has the rest (Greek, Gothic, Italic, the
duplex and triplex romans, symbols). Each file gives 96 glyphs in ASCII order,
space to DEL; the map says which character each place holds.

## Licence

This distribution of the Hershey Fonts may be used by anyone for any purpose,
commercial or otherwise, providing that:

1. The following acknowledgements must be distributed with the font data:
   - The Hershey Fonts were originally created by Dr. A. V. Hershey while
     working at the U. S. National Bureau of Standards.
   - The format of the Font data in this distribution was originally created
     by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA
     01821 (mit-eddie!ci-dandelion!hurt)
2. The font data in this distribution may be converted into any other format
   *EXCEPT* the format distributed by the U.S. NTIS (which organization holds
   the rights to the distribution and use of the font data in that particular
   format).

A hand made from these files carries the acknowledgements as its `credit`.
