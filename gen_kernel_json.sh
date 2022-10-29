#!/bin/sh

sed "s|{{KERNEL_DIR}}|$(realpath "$(pwd)")|" kernel.json.template > kernel.json

