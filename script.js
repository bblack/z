// var OPERAND_TYPES = [
//   {id: 0b00, name: 'LARGE_CONSTANT', size: 2},
//   {id: 0b01, name: 'SMALL_CONSTANT', size: 1},
//   {id: 0b10, name: 'VARIABLE', size: 1},
//   {id: 0b11, name: 'OMITTED', size: 0}
// ];
// var OPERAND_TYPES_BY_ID = OPERAND_TYPES.reduce((acc, el) => {acc[el.id] = el; return acc}, {});
// var OPERAND_TYPES_BY_NAME = OPERAND_TYPES.reduce((acc, el) => {acc[el.name] = el; return acc}, {});

log("Ready.");

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
  var firstByte = dv.getUint8(pc, false);
  log(`  Found firstByte 0x${firstByte.toString(16).padStart(2, '0')} / 0b${firstByte.toString(2).padStart(8, '0')}`);

  var opcode = firstByte;

  log(`  opcode is ${opcode}`);

  switch (opcode) {
    // opcodes by name: https://inform-fiction.org/zmachine/standards/z1point1/sect15.html
    // opcodes by number: https://inform-fiction.org/zmachine/standards/z1point1/sect14.html
    case 84:
      // add a b -> (result); a is a 'var', b is a 'small constant'
      ops.add_var_small();
      break;
    case 97:
      ops.je_var_var();
      break;
    case 116:
      ops.add_var_var();
      break;
    case 224:
      ops.call();
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
    var operandTypesByte = dv.getUint8(pc + 1, false);
    var operandTypes = [
      (operandTypesByte & 0b11000000) >> 6,
      (operandTypesByte & 0b00110000) >> 4,
      (operandTypesByte & 0b00001100) >> 2,
      (operandTypesByte & 0b00000011)
    ];
    var operands = [];
    var operandIndex = 0;
    var operandPointer = pc + 2;

    while (true) {
      if (operandIndex > operandTypes.length) break;

      var operandType = operandTypes[operandIndex];

      if (operandType == 0b11) break;

      var operand;

      switch (operandType) {
        case 0b00: // large constant
          operand = dv.getUint16(operandPointer, false);
          operandPointer += 2;
          break;
        case 0b01: // small constant
          operand = dv.getUint8(operandPointer, false);
          operandPointer += 1;
          break;
        case 0b10: // variable
          operand = dv.getUint8(operandPointer, false);
          operandPointer += 1;
          break;
        default:
          throw "unrecognized operand type 0x" + operandType.toString(16);
      }

      operands.push(operand);
      operandIndex += 1;
    }

    var storeVariable = dv.getUint8(operandPointer, false);
    operandPointer += 1;

    log("  operand types: " + operandTypes.join(", "));
    log("  operands: " + operands.map((o) => '0x' + o.toString(16)).join(", "));
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
      returnAddress: operandPointer,
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
    var a = readVar(dv.getUint8(pc + 1, false));
    var b = dv.getUint8(pc + 2, false);
    var resultVar = dv.getUint8(pc + 3, false);

    writeVar(resultVar, a + b);

    pc += 4;
  },
  add_var_var: function() {
    var a = readVar(dv.getUint8(pc + 1, false));
    var b = readVar(dv.getUint8(pc + 2, false));
    var resultVar = dv.getUint8(pc + 3, false);

    writeVar(resultVar, a + b);

    pc += 4;
  },
  je_var_var: function() {
  	// je a b ?(label)
    // that is: check whether a == b. (that is, compare the VALUES in VARS a and b.)
    // what to do with the result depends on the byte after b:
    // (see 4.7)
    // this says it gives an OFFSET as a SIGNED 14-bit number. does that mean
    // relative to the current... instruction?
    var a = readVar(dv.getUint8(pc + 1, false));
    var b = readVar(dv.getUint8(pc + 2, false));
    var branchInfo1 = readVar(dv.getUint8(pc + 3, false));

    var willJump = (a == b);
    if (branchInfo1 & 0b1000_0000 == 0) {
      willJump = !willJump;
    }

    // "If bit 6 is clear, then the offset is a signed 14-bit number given in bits 0 to 5 of the first byte followed by all 8 of the second."
    // ...okay, but in what order? assuming straight left-to-right...
    var offset;
    if (branchInfo1 & 0b0100_0000) {
      offset = (branchInfo1 & 0b0011_1111);
    } else {
      var offsetBits = dv.getInt16(pc + 3, false) & 0b0011_1111_1111_1111;

      offset = offsetBits & 0b0001_1111_1111_1111;
      if (offsetBits & 0b0010_0000_0000_0000) {
        offset = -offset + 1;
      }
    }

    pc += offset;
  }
};

function readVar(n) {
  if (n == 0) {
    throw "popping from stack not yet implemented";
  }
  if (n < 0x10) {
    return topCallStackFrame().localVars[n - 1];
  }

  return dv.getUint16(globalVarAddress(n));
}

function writeVar(n, x) {
  if (n == 0) throw "pushing to stack not yet implemented";
  if (n >= 0x10) throw "writing global vars not yet implemented";

  var frame = topCallStackFrame();
  var localVarCount = frame.localVars.length;

  if (n - 1 > localVarCount) {
    throw `illegal to write to var ${n}; frame only has ${localVarCount} local vars`;
  }

  frame.localVars[n - 1] = x;
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

function log(s) {
	var outline = `${new Date().toISOString()} ${s}`;

	console.log(outline);

	var log = document.querySelector("#log");
	var logpane = document.querySelector("#logpane");

	log.textContent += (outline + "\n");
	logpane.scrollTo(0, logpane.scrollHeight);
}
