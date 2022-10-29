#!/usr/bin/env bash

sed "s|{{KERNEL_DIR}}|$(realpath "$(pwd)")|" kernel.json.template > kernel.json

