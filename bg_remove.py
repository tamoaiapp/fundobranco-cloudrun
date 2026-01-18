import sys
from rembg import remove

inp = sys.argv[1]
outp = sys.argv[2]

with open(inp, "rb") as f:
    input_bytes = f.read()

output_bytes = remove(input_bytes)

with open(outp, "wb") as f:
    f.write(output_bytes)
