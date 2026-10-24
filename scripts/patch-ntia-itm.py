"""Apply the documented portability edits to the vendored NTIA ITM sources.

Idempotent. Run from anywhere: python -I patch-ntia-itm.py <path to third_party/ntia-itm>
Edits (see third_party/ntia-itm/MODIFIED.md):
  1. Windows include paths  "..\\include\\X.h"  ->  "../include/X.h"
  2. DLLEXPORT defined as extern "C" (no __declspec) when not compiling for Windows.
"""
import glob
import os
import sys

root = sys.argv[1]
BS = b"\\"
old_prefix = b'#include "..' + BS + b"include" + BS
new_prefix = b'#include "../include/'

changed = 0
for path in glob.glob(os.path.join(root, "src", "*.cpp")):
    data = open(path, "rb").read()
    if old_prefix in data:
        open(path, "wb").write(data.replace(old_prefix, new_prefix))
        changed += 1

hdr = os.path.join(root, "include", "itm.h")
data = open(hdr, "rb").read()
orig = b'#define DLLEXPORT extern "C" __declspec(dllexport)'
if b"#ifdef _WIN32" not in data:
    nl = b"\r\n" if b"\r\n" in data else b"\n"
    data = data.replace(
        orig,
        b"#ifdef _WIN32" + nl + orig + nl + b"#else" + nl + b'#define DLLEXPORT extern "C"' + nl + b"#endif",
    )
    open(hdr, "wb").write(data)
    changed += 1

print(f"patched {changed} file(s)")
