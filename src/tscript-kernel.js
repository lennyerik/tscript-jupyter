const jmp = require("jmp-zeromq6");
const uuid = require("uuid");
const { Interpreter } = require("../tscript/src/lang/interpreter/interpreter.js");
const { Parser } = require("../tscript/src/lang/parser/index.js");
const { defaultOptions } = require("../tscript/src/lang/helpers/options.js");
const { createDefaultServices } = require("../tscript/src/lang/interpreter/defaultService.js");
const { Version: tscriptVersion } = require('../tscript/src/lang/version.js');

const KERNEL_INFO = {
    protocol_version: "5.3",
    implementation: "tscript",
    implementation_version: "0.0.1",
    language_info: {
        name: "tscript",
        version: `${tscriptVersion.major}.${tscriptVersion.minor}.${tscriptVersion.patch}`,
        mimetype: "text/tscript",
        file_extension: ".tscript",
        codemirror_mode: "text/tscript"
    },
    banner: `${tscriptVersion.full()}`,
    help_links: [
        { text: "TScript Documentation", url: "https://tglas.github.io/tscript/?doc=" },
        { text: "TScript Github Repo", url: "https://github.com/tglas/tscript" },
        { text: "TScript Online IDE", url: "https://tglas.github.io/tscript/" }
    ]
}

class TScriptKernel {
    // The constructor takes the parsed connection information
    // JSON file that jupyter calls our application with
    constructor(conninfo) {
        this.promptCounter = 0;
        this.parserVariables = {};
        this.interpreterVariables = [];
        this.activeExecuteRequest = {};

        // Set up JMP Sockets
        this.shellSocket = new jmp.Socket("router", "sha256", conninfo.key);
        this.controlSocket = new jmp.Socket("router", "sha256", conninfo.key);
        this.hbSocket = new jmp.zmq.Socket("rep");
        this.iopubSocket = new jmp.Socket("pub", "sha256", conninfo.key);
        this.stdinSocket = new jmp.Socket("router", "sha256", conninfo.key);

        this.identity = uuid.v4();
        this.shellSocket.identity = this.identity;
        this.controlSocket.identity = this.identity;
        this.hbSocket.identity = this.identity;
        this.stdinSocket.identity = this.identity;

        this.shellSocket.on("message", (msg) => this.shellControlMsgHandler(this.shellSocket, msg));
        this.controlSocket.on("message", (msg) => this.shellControlMsgHandler(this.controlSocket, msg));
        this.hbSocket.on("message", this.hbSocket.send);
        this.iopubSocket.on("message", (msg) => console.log("iopub", msg));   // TODO
        this.stdinSocket.on("message", (msg) => console.log("stdin", msg));   // TODO

        // Connect
        const baseUrl = conninfo.transport + "://" + conninfo.ip + ":";
        this.shellSocket.bindSync(baseUrl + conninfo.shell_port);
        this.controlSocket.bindSync(baseUrl + conninfo.control_port);
        this.hbSocket.bindSync(baseUrl + conninfo.hb_port);
        this.iopubSocket.bindSync(baseUrl + conninfo.iopub_port);
        this.stdinSocket.bindSync(baseUrl + conninfo.stdin_port);

        // Set up TScript interpreter
        this.interpreter = new Interpreter({}, createDefaultServices());
        this.interpreter.stopthread();
        this.interpreter.reset();
        this.interpreter.service.message = this.interpreterMessage.bind(this);
        this.interpreter.service.print = this.tscriptPrint.bind(this);
    }

    busy(msg) {
        msg.respond(this.iopubSocket, "status", {
            execution_state: "busy"
        });
    }

    idle(msg) {
        msg.respond(this.iopubSocket, "status", {
            execution_state: "idle"
        });
    }

    execution_error(error) {
        this.activeExecuteRequest.msg.respond(
            this.activeExecuteRequest.socket,
            "execute_reply",
            {
                status: "error",
                execution_count: this.promptCounter,
                ...error
            }
        );

        this.activeExecuteRequest.msg.respond(
            this.iopubSocket,
            "error",
            {
                execution_count: this.promptCounter,
                ...error
            }
        );
    }

    // Executes the code and returns null or an error structure
    execute(code, silent) {

        // Parse the program
        const parsed = Parser.parse(code, defaultOptions, this.parserVariables);
        if (parsed.errors.length > 0) {
            const err = parsed.errors[0];
            if (!silent) {
                const docsUrl = KERNEL_INFO.help_links.filter((x) => x.text === "TScript Documentation")[0].url;
                this.execution_error({
                    ename: err.name,
                    evalue: err.message,
                    traceback: [
                        "error in line " + err.line + ": " + err.message,
                        `${err.href.replace("#", docsUrl)} for more information`
                    ],
                });
            }
            return;
        }

        // Prepare the interpreter
        this.interpreter.program = parsed.program;
        this.interpreter.options = parsed.program.options;
        this.interpreter.reset();

        // Trick the interpreter into thinking the previous variables are already
        // defined in the current scope
        this.interpreter.stack[0].variables = this.interpreterVariables;

        let tmpVariables = [];
        while (!this.interpreter.halt && this.interpreter.status === "running") {
            this.interpreter.exec_step();

            // Sneaky hack to preserve the variables
            if (this.interpreter.stack.length == 1) {
                tmpVariables = this.interpreter.stack[0].variables;
            }
        }

        if (this.interpreter.status !== "error") {
            this.parserVariables = {
                types: this.interpreter.program.types,
                names: this.interpreter.program.names,
                variables: this.interpreter.program.variables,
            };
            this.interpreterVariables = tmpVariables;
        }

        if (!silent) this.promptCounter++;

    }

    shellControlMsgHandler(socket, msg) {
        switch (msg.header.msg_type) {
            case "kernel_info_request":
                this.busy(msg);
                msg.respond(socket, "kernel_info_reply", KERNEL_INFO);
                this.idle(msg);
                break;
            case "execute_request":
                if (!msg.content.silent) this.busy(msg);
                this.activeExecuteRequest = { socket: socket, msg };
                if (msg.content.code.trim() !== "") {
                    this.execute(msg.content.code, msg.content.silent);
                }
                if (!msg.content.silent) this.idle(msg);
                break
            default:
                console.log("[TScript Kernel] Unexpected shell / control packet: " + msg.header.msg_type);
        }
    }


    // Interpreter services
    interpreterMessage(interpreter_msg) {
        // TODO: Always error...???
        console.log(interpreter_msg);
    }

    tscriptPrint(to_print) {
        this.activeExecuteRequest.msg.respond(
            this.iopubSocket,
            "stream",
            {
                name: "stdout",
                text: to_print,
            },
        );
    }
}

module.exports = { KERNEL_INFO, TScriptKernel };
