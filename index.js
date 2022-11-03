const { argv, exit } = require("process");
const fs = require("fs");
const { TScriptKernel } = require("./src/tscript-kernel");

if (argv.length != 3) {
    console.log("Error: TScript kernel not called with connection info json file.");
    exit(0);
}

const conninfo = JSON.parse(fs.readFileSync(argv[2]));
const kernel = new TScriptKernel(conninfo);
