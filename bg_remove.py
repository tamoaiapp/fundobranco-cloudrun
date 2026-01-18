import sys
from rembg import remove
from PIL import Image

def main():
    if len(sys.argv) < 3:
        print("usage: bg_remove.py input output", file=sys.stderr)
        sys.exit(2)

    inp = sys.argv[1]
    out = sys.argv[2]

    img = Image.open(inp).convert("RGBA")
    result = remove(img)  # rembg[cpu] usa onnxruntime
    result.save(out, "PNG")

if __name__ == "__main__":
    main()
