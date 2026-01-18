import sys
import traceback
from rembg import remove

def main():
    inp = sys.argv[1]
    outp = sys.argv[2]

    with open(inp, "rb") as f:
        input_bytes = f.read()

    output_bytes = remove(input_bytes)

    with open(outp, "wb") as f:
        f.write(output_bytes)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("BG_REMOVE_ERROR:", str(e), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
