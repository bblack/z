// var OPERAND_TYPES = [
//   {id: 0b00, name: 'LARGE_CONSTANT', size: 2},
//   {id: 0b01, name: 'SMALL_CONSTANT', size: 1},
//   {id: 0b10, name: 'VARIABLE', size: 1},
//   {id: 0b11, name: 'OMITTED', size: 0}
// ];
// var OPERAND_TYPES_BY_ID = OPERAND_TYPES.reduce((acc, el) => {acc[el.id] = el; return acc}, {});
// var OPERAND_TYPES_BY_NAME = OPERAND_TYPES.reduce((acc, el) => {acc[el.name] = el; return acc}, {});

log("Ready.");

window.addEventListener('unhandledrejection', (e) => log(event.reason, 'red'));

// TODO: either pass dv everywhere, or refer to global everywhere.
// started using global ref for convenience.
var dv;
var pc = -1;
var callStack = [];

var input = document.querySelector("input#file")

input.addEventListener("change", function() {
	var file = this.files[0];
	log(`received file ${file.name} of size ${file.size} bytes`);

	file.arrayBuffer().then((ab) => {
		//debugger;
		log(`Read ${ab.byteLength} bytes`);

		dv = new DataView(ab);

		// https://inform-fiction.org/zmachine/standards/z1point1/sect11.html

		var version = dv.getUint8(0x00, false);
		log("Version: " + version);

		var flags = dv.getUint16(0x01, false);
		log("Flags: ");

		var statusLineType = flags & 0x01;
		switch (statusLineType) {
			case 0: log("  Status line type: score/turns"); break;
			case 1: log("  Status line type: hours:mins"); break;
			default: log("  Status line type: UNKNOWN " + statusLineType);
		}

		var storyFileSplitOverTwoDiscs = Boolean(flags & 0x02);
		log("  Story file split over two discs: " + storyFileSplitOverTwoDiscs);

		var statusLineUnavailable = Boolean(flags & 0x08);
		log("  Status line unavailable: " + statusLineUnavailable);

		var screenSplittingAvailable = Boolean(flags & 0x10);
		log("  Screen-splitting available: " + screenSplittingAvailable);

		var isVariablePitchFontDefault = Boolean(flags & 0x20);
		log("  Is variable-pitch font default: " + isVariablePitchFontDefault);

		pc = dv.getUint16(0x06, false);
		// doc says "byte address" - but relative to what?
		// start of all mem? dynamic? static? high?
		log("pc: 0x" + pc.toString(16));

		var storyFileLength = dv.getUint16(0x1a, false);
		log(`Story file length: ${storyFileLength} words (${storyFileLength * 2} bytes)`);

		// and away we go:
    while (true) {
      executeNextInstruction(dv);
    }
	});
});

function executeNextInstruction(dv) {
  log(`Reading next instruction, at address 0x${pc.toString(16)}`);

  // https://www.inform-fiction.org/zmachine/standards/z1point1/sect04.html
  var firstByte = readPC();
  log(`  Found firstByte 0x${firstByte.toString(16).padStart(2, '0')} / 0b${firstByte.toString(2).padStart(8, '0')}`);

  var opcode = firstByte;

  log(`  opcode is ${opcode}`);

  // opcodes by name: https://inform-fiction.org/zmachine/standards/z1point1/sect15.html
  // opcodes by number: https://inform-fiction.org/zmachine/standards/z1point1/sect14.html
  switch (opcode) {
    case 84:
      // add a b -> (result); a is a 'var', b is a 'small constant'
      ops.add_var_small();
      break;
    case 85:
      ops.sub_var_small(); // i guess?
      break;
    case 97:
      ops.je_var_var();
      break;
    case 116:
      ops.add_var_var();
      break;
    case 160:
      ops.jz_var();
      break;
    case 224:
      ops.call();
      break;
		case 225:
			ops.storew();
			break;
    default:
      var formBits = (opcode & 0b11000000) >> 6;
      var form =
        formBits == 0b11 ? 'variable' :
        formBits == 0b10 ? 'short' :
        'long';
      throw `unsupported opcode ${opcode}; form is ${form}; bottom 5 bits are ${opcode & 0b11111}`;
  }
}

const ops = {
	call: function() {
		var operands = readOperandsVAR();
    var storeVariable = readPC();

    log("  store var: " + storeVariable);

    // A call gives an address (first arg, i guess?) which is... a "packed address"? (1.2.3),
    // so just double it to get the byte address?
    var routineAddress = operands[0] * 2;

    if (routineAddress == 0) {
      throw "special call to address 0 not yet implemented (see 6.4.3)";
    }

    var routineLocalVarCount = dv.getUint8(routineAddress, false);

    if (routineLocalVarCount < 0 || routineLocalVarCount > 15) {
      throw `routine at 0x${routineAddress.toString(16)} has illegal number of local vars ${routineLocalVarCount}`;
    }

    // Let's verify that memory at this address looks like a routine:
    // 03 00 00 00 00 00  00 e0 2f 2a 43 01 03 e1 ...
    // 5.2: A routine begins with one byte indicating the number of local variables it has (between 0 and 15 inclusive).
    // => 3 local vars.
    // 5.2.1: In Versions 1 to 4, that number of 2-byte words follows, giving initial values for these local variables.
    // => 00 00, 00 00, 00 00
    // 5.2: Execution of instructions begins from the byte after this header information. There is no formal 'end-marker' for a routine (it is simply assumed that execution eventually results in a return taking place).
    // first one is: e0. that's another CALL....

    // 6.4.1: "All routines return a value". So...
    // i guess there follows a single byte giving which variable to 'store' the result? (4.6)

    // "the stack" is referred to in docs... is there just one for the whole machine? is it
    // separate from the call stack?
    // or, a "substack" per call stack frame? so each call stack needs maintain a "substack length"
    // and/or pointer?

    // TODO:
    // setup local vars:
    // 1. count as given by routine itself
    var localVars = new Uint16Array(routineLocalVarCount);
    // 2. values of locals given by routine itself
    for (var i = 0; i < routineLocalVarCount; i++) {
      localVars[i] = dv.getUint16(routineAddress + 1 + i, 0);
    }
    // 3. values of first N locals replaced by ARGS
    for (var i = 0; i < routineLocalVarCount; i++) {
      if (operands.length > i) {
        localVars[i] = operands[i + 1];
      }
    }

    var newStackFrame = {
      returnAddress: pc,
      // routine result value goes here - 0x00 means pushed onto substack of CALLING frame,
      // 0x01 - 0x0f means into a local var of CALLING frame;
      // 0x10 - 0xff means into a GLOBAL var.
      storeVariable: storeVariable,
      localVars: localVars
      //
    };

    callStack.push(newStackFrame);
    pc = routineAddress + 1 + (2 * routineLocalVarCount);

    // TODO: set pc via fn, which also logs its new value

    // throw "opcode 'call' is recognized but not yet supported";
    // debugger;
  },
  add_var_small: function() {
    var a = readVar(readPC());
    var b = readPC();
    var resultVar = readPC();

    writeVar(resultVar, a + b);
  },
  add_var_var: function() {
    var a = readVar(readPC());
    var b = readVar(readPC());
    var resultVar = readPC();

    writeVar(resultVar, a + b);
  },
  je_var_var: function() {
  	// je a b ?(label)
    // that is: check whether a == b. (that is, compare the VALUES in VARS a and b.)
    // what to do with the result depends on the byte after b:
    // (see 4.7)
    // this says it gives an OFFSET as a SIGNED 14-bit number. does that mean
    // relative to the current... instruction?

		// TODO: still dry this up more better across jump instructions!
    var a = readVar(readPC());
    var b = readVar(readPC());
    var branchInfo1 = readPC();
		var branchInfo2; // sometimes present; presence given by a bit in prior byte
		var offset;

    var willJump = (a == b);
    if ((branchInfo1 & 0b1000_0000) == 0) {
      willJump = !willJump;
    }

		if (branchInfo1 & 0b0100_0000) { // is there a second "branch info" byte?
			// no, only one byte - 6-bit unsigned; range [0, 63]
			offset = (branchInfo1 & 0b0011_1111);
		} else {
			// yes, two bytes - 14-bit SIGNED
			branchInfo2 = readPC();
			offset = ((branchInfo1 & 0b0011_1111) << 8) | branchInfo2;

			if (offset & 0b0010_0000_0000_0000) {
				offset = -offset + 1;
			}
		}

		if (willJump) {
			pc += (offset - 2);
		}
  },
  jz_var: function() {
    // jump if a == 0.
		// TODO: still dry this up more better across jump instructions!
		var a = readVar(readPC());
    var b = 0;
    var branchInfo1 = readPC();
		var branchInfo2; // sometimes present; presence given by a bit in prior byte
		var offset;

    var willJump = (a == b);
    if ((branchInfo1 & 0b1000_0000) == 0) {
      willJump = !willJump;
    }

		if (branchInfo1 & 0b0100_0000) { // is there a second "branch info" byte?
			// no, only one byte - 6-bit unsigned; range [0, 63]
			offset = (branchInfo1 & 0b0011_1111);
		} else {
			// yes, two bytes - 14-bit SIGNED
			branchInfo2 = readPC();
			offset = ((branchInfo1 & 0b0011_1111) << 8) | branchInfo2;

			if (offset & 0b0010_0000_0000_0000) {
				offset = -offset + 1;
			}
		}

		if (willJump) {
			pc += (offset - 2);
		}
  },
  sub_var_small: function() {
    var a = readVar(readPC());
    var b = readPC();
    var resultVar = readPC();

    writeVar(resultVar, a - b);
  },
	storew: function() {
		// https://inform-fiction.org/zmachine/standards/z1point1/sect15.html#storew
		debugger;

		// here we go - we need to
		// 1) read the operand TYPES (and count i guess, though for storew it's always 3)
		// 2) use that to get the operand VALUES (reading from vars if indicated)
		// 3) dry this shit up with "call"

		var operands = readOperandsVAR();

		var arrayAddress = operands[0];
		var elementIndex = operands[1];
		var value = operands[2];
		var elementAddress = arrayAddress + (2 * elementIndex);
		dv.setUint16(elementAddress, value, false);
	}
};

function readPC() {
	var out = dv.getUint8(pc, false);
	pc += 1;
	return out;
}

function readPC16() {
	var out = dv.getUint16(pc, false);
	pc += 2;
	return out;
}

function readOperandsVAR() {
	var operandTypesByte = readPC();
	var operandTypes = [
		(operandTypesByte & 0b11000000) >> 6,
		(operandTypesByte & 0b00110000) >> 4,
		(operandTypesByte & 0b00001100) >> 2,
		(operandTypesByte & 0b00000011)
	];
	var operands = [];
	var operandIndex = 0;

	while (true) {
		if (operandIndex > operandTypes.length) break;

		var operandType = operandTypes[operandIndex];

		if (operandType == 0b11) break;

		var operand;

		switch (operandType) {
			case 0b00: // large constant
				operand = readPC16();
				break;
			case 0b01: // small constant
				operand = readPC();
				break;
			case 0b10: // variable
				operand = readVar(readPC());
				break;
			default:
				throw "unrecognized operand type 0x" + operandType.toString(16);
		}

		operands.push(operand);
		operandIndex += 1;
	}

	log("  operand types: " + operandTypes.join(", "));
	log("  operands: " + operands.map((o) => '0x' + o.toString(16)).join(", "));

	return operands;
}

function readVar(n) {
  if (n == 0) {
    throw "popping from stack not yet implemented";
  }

  if (n < 0x10) {
    // TODO: validate frame has this many vars
    return topCallStackFrame().localVars[n - 1];
  }

  return dv.getUint16(globalVarAddress(n), false);
}

function writeVar(n, x) {
  if (n == 0) {
    throw "pushing to stack not yet implemented";
  }

  if (n < 0x10) {
    var frame = topCallStackFrame();
    var localVarCount = frame.localVars.length;

    if (n - 1 > localVarCount) {
      throw `illegal to write to var ${n}; frame only has ${localVarCount} local vars`;
    }

    frame.localVars[n - 1] = x;

    return;
  }

  dv.setUint16(globalVarAddress(n), x, false);
}

function globalVarAddress(n) {
  if (n < 0x10 || n > 0xff)
    throw `0x${n.toString(16)} is not a global var number`;

  // 6.2: 240 2-byte words, starting @ addr given at 0x0c in header
  return dv.getUint16(0x0c, false) + (2 * (n - 0x10));
}

function topCallStackFrame() {
  return callStack[callStack.length - 1];
}

function log(s, color) {
	var outline = `${new Date().toISOString()} ${s}`;

	console.log(outline);

	var log = document.querySelector("#log");
	var logpane = document.querySelector("#logpane");
  var div = document.createElement('div');

  if (color) { div.style.color = color; }

	div.textContent = outline;

  log.append(div);
	logpane.scrollTo(0, logpane.scrollHeight);
}
