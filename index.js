const { argv, exit } = require("process");
const fs = require("fs");
const uuid = require("uuid");
const jmp = require("jmp-zeromq6");
const { Interpreter } = require("./tscript/src/lang/interpreter/interpreter.js");
const { Parser } = require("./tscript/src/lang/parser/index.js");
const { defaultOptions } = require("./tscript/src/lang/helpers/options.js");
const { createDefaultServices } = require("./tscript/src/lang/interpreter/defaultService.js");

if (argv.length != 3) {
    console.log("Error: TScript kernel not called with connection info json file.");
    exit(0);
}

const KERNEL_INFO = {
    protocol_version: "5.3",
    implementation: "tscript",
    implementation_version: "0.0.1",
    language_info: {
        name: "tscript",
        version: "0.0.1",  // TODO: This should be the TScript version
        mimetype: "text/tscript",
        file_extension: ".tscript",
        codemirror_mode: "text/tscript"
    },
    banner: "TScript",
    help_links: [
        { "text": "TScript Documentation", "url": "https://tglas.github.io/tscript/?doc=" },
        { "text": "TScript Github Repo", "url": "https://github.com/tglas/tscript" },
        { "text": "TScript Online IDE", "url": "https://tglas.github.io/tscript/" }
    ]
};

const conninfo = JSON.parse(fs.readFileSync(argv[2]));
const identity = uuid.v4();

const shellSocket = new jmp.Socket("router", "sha256", conninfo.key);
const controlSocket = new jmp.Socket("router", "sha256", conninfo.key);
const hbSocket = new jmp.zmq.Socket("rep");
const iopubSocket = new jmp.Socket("pub", "sha256", conninfo.key);
const stdinSocket = new jmp.Socket("router", "sha256", conninfo.key);

shellSocket.identity = identity;
controlSocket.identity = identity;
hbSocket.identity = identity;
stdinSocket.identity = identity;

function busy(msg) {
    msg.respond(iopubSocket, "status", {
        execution_state: "busy"
    });
}

function idle(msg) {
    msg.respond(iopubSocket, "status", {
        execution_state: "idle"
    });
}

var prompt_counter = 0;
var prev_program_vars = {};
var prev_variables = [];

const interpreter = new Interpreter({}, createDefaultServices());
interpreter.stopthread();
interpreter.reset();

function shellControlMsgHandler(socket, msg) {
    switch (msg.header.msg_type) {
        case "kernel_info_request":
            busy(msg);
            msg.respond(
                socket,
               "kernel_info_reply",
                KERNEL_INFO
            );
            idle(msg);
            break;
        case "execute_request":
            if (!msg.content.silent) busy(msg);
            if (msg.content.code.trim() !== "") {
                const parsed = Parser.parse(msg.content.code, defaultOptions, prev_program_vars);
                if (parsed.errors.length === 0) {
                    interpreter.program = parsed.program;
                    interpreter.options = parsed.program.options;
                    interpreter.reset();
                    console.log(prev_variables);
                    interpreter.stack[0].variables = prev_variables;

                    interpreter.service.print = (to_print) => {
                        msg.respond(
                            iopubSocket,
                            "stream",
                            {
                                name: "stdout",
                                text: to_print
                            }
                        );
                    };
                    interpreter.service.message = (to_print) => {
                        msg.respond(
                            iopubSocket,
                            "error",
                            {
                                ename: e.name,
                                evalue: e.message,
                                traceback: ["error in line " + e.line + ": " + e.message],
                                execution_count: prompt_counter
                            }
                        );
                    }

                    while (!interpreter.halt && interpreter.status == "running") {
                        interpreter.exec_step();

                        // Sneaky hack to preserve the variables
                        if (interpreter.stack.length == 1) {
                            prev_variables = interpreter.stack[0].variables;
                        }
                    }

                    if (interpreter.status !== "error") {
                        prev_program_vars = {
                            types: interpreter.program.types,
                            names: interpreter.program.names,
                            variables: interpreter.program.variables
                        };
                    }
                } else {
                    let e = parsed.errors[0];
                    // TODO: Display e.href somehow.
                    // It looks like this: '#/errors/syntax/se-49'

                    msg.respond(
                        socket,
                        "execute_reply",
                        {
                            status: "error",
                            ename: e.name,
                            evalue: e.message,
                            traceback: ["error in line " + e.line + ": " + e.message],
                            execution_count: prompt_counter
                        }
                    );
                    msg.respond(
                        iopubSocket,
                        "error",
                        {
                            ename: e.name,
                            evalue: e.message,
                            traceback: ["error in line " + e.line + ": " + e.message],
                            execution_count: prompt_counter
                        }
                    );
                }

                if (!msg.content.silent) prompt_counter++;
            }

            if (!msg.content.silent) idle(msg);
            break;
        default:
            console.log("Unexpected shell/control packet: " + msg.header.msg_type);
    }
}

shellSocket.on("message", (msg) => shellControlMsgHandler(shellSocket, msg));
controlSocket.on("message", (msg) => shellControlMsgHandler(controlSocket, msg));
hbSocket.on("message", hbSocket.send);
iopubSocket.on("message", (msg) => console.log("iopub", msg));
stdinSocket.on("message", (msg) => console.log("stdin", msg));

const baseUrl = conninfo.transport + "://" + conninfo.ip + ":";
shellSocket.bindSync(baseUrl + conninfo.shell_port);
controlSocket.bindSync(baseUrl + conninfo.control_port);
hbSocket.bindSync(baseUrl + conninfo.hb_port);
iopubSocket.bindSync(baseUrl + conninfo.iopub_port);
stdinSocket.bindSync(baseUrl + conninfo.stdin_port);

