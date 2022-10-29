# tscript-jupyter
This project aims to build a fully functional [jupyter notebook](https://jupyter.org/) kernel for the [TScript](https://github.com/tglas/tscript) programming language.

## Installation
To install the tscript-jupyter kernel run:

    mkdir -p ~/.local/share/jupyter/kernels/
    cd ~/.local/share/jupyter/kernels/
    git clone --recursive https://github.com/lennyerik/tscript-jupyter
    cd tscript-jupyter
    npm i
    git apply parser.patch --directory tscript/
    npx tsc
    ./gen_kernel_json.sh
