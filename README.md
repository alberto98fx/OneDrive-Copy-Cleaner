# OneDrive Copy Cleaner

A small, portable Electron app for Windows 10 that finds OneDrive-style duplicate image files (e.g., - Copy, - Copia, Copy of …, … (2)), previews them, verifies originals exist in the same folder, optionally hash-verifies content equality before deletion, and watches the filesystem for real‑time updates. It never deletes automatically; it always asks for confirmation and sends files to the Recycle Bin (safe).

Designed so you can build on macOS and ship a single portable .exe for Windows with no extra installs (via electron-builder portable target; requires Wine on macOS).

## Features

Recursively scan a chosen root folder.

Detect likely copies with robust patterns (English/Italian OneDrive variants):

Name - Copy.ext, Name - Copy (2).ext

Name - Copia.ext, Name - Copia (2).ext

Copy of Name.ext / Copia di Name.ext

Name (2).ext, Name (3).ext (only if the base Name.ext exists in the same folder)

Ensure original exists in the same directory before listing as deletable.

Optional strict hash match (SHA-1) to ensure the copy truly matches the original.

Live thumbnail grid with filename, size, original status, hash status, and checkboxes.

Two tabs:

Copies (grid of duplicate candidates);

Folders (tree view with per-folder counts + “Delete all copies in this folder”).

Real-time updates: watches the filesystem; UI reflects changes.

Safe deletion: moves to Recycle Bin (Windows) using trash library; confirms before deleting.

Shows potential space saved overall and for current selection.
