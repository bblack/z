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
// we start with this special, mostly-empty frame in the call stack, because
// we need a "substack" at the bottom: apparently we're supposed to be able to
// push data into "the stack" even if we're not inside a routine.
var callStack = [
	{
		returnAddress: null,
		storeVariable: null,
		localVars: null,
		substack: []
	}
];

const alphabets = [
	new Array(6).fill(undefined).concat('abcdefghijklmnopqrstuvwxyz'.split('')),
	new Array(6).fill(undefined).concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
	new Array(6).fill(undefined).concat(' \n0123456789.,!?_#\'"/\-:()'.split('')),
];

var input = document.querySelector("input#file")

input.addEventListener("change", function() {
	var file = this.files[0];
	log(`received file ${file.name} of size ${file.size} bytes`);

	file.arrayBuffer().then((ab) => {
		log(`Read ${ab.byteLength} bytes`);

		dv = new DataView(ab);

		// https://inform-fiction.org/zmachine/standards/z1point1/sect11.html

		var version = dv.getUint8(0x00, false);
		log("  Version: " + version);

		var flags = dv.getUint16(0x01, false);
		log("  Flags: ");

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

		logObjectTable(dv);

		// and away we go:
    while (true) {
      executeNextInstruction(dv);
    }
	});
});

function logObjectTable(dv) {
	var addr = dv.getUint16(0x0a, false);
	log(`  Object table location: ${addr}`);

	log(`  Property defaults:`);
	// says it has 31 words, not 32, idk
	for (var i = 0; i < 31; i += 1) {
		log(`    ${i}. ${dv.getUint16(addr, false)}`);
		addr += 2;
	}

	log(`  Objects:`);
	for (var i = 0; i < 256; i += 1) {
		var attrFlags = dv.getUint32(addr, false);
		var parentId = dv.getUint8(addr + 4, false);
		var siblingId = dv.getUint8(addr + 5, false);
		var childId = dv.getUint8(addr + 6, false);
		var propertiesAddr = dv.getUint16(addr + 7, false);

		// 12.3
		// Objects are numbered consecutively from 1 upward, with object number 0 being used to mean "nothing" (though there is formally no such object).
		log(`    ${i + 1}.`)
		log(`      attrFlags: ${attrFlags.toString(2).padStart(32, '0')}`);
		log(`      parentId: ${parentId}`);
		log(`      siblingId: ${siblingId}`);
		log(`      childId: ${childId}`);
		log(`      propertiesAddr: ${propertiesAddr.toString(16).padStart(4, '0')}`);
		log(`      properties table:`)

		// unsure whether we actually need the length?
		var shortNameLength = dv.getUint8(propertiesAddr, false);
		var shortNameBytePtr = propertiesAddr + 1;
		var shortName = readString(shortNameBytePtr);

		log(`        name: ${shortName}`);

		// TODO: rest of properties

		addr += 9;
	}
}

function readString(addr) {
	var s = "";
	var alphabet = 0;
	var abbrevPage = 0;

	while (true) {
		var word = dv.getUint16(addr);
		addr += 2;
		var c0 = (word & 0b0111_1100_0000_0000) >> 10;
		var c1 = (word & 0b0000_0011_1110_0000) >> 5;
		var c2 = (word & 0b0000_0000_0001_1111);

		[c0, c1, c2].forEach((c) => {
			if (abbrevPage > 0) {
				var abbrevTableAddr = dv.getUint16(0x18, false);
				//  "...the interpreter must look up entry 32(z-1)+x in the abbreviations table and print the string at that word address"
				var abbrevTableEntryNum = 32 * (abbrevPage - 1) + c;
				// entries are 2 bytes i guess, since they contain addresses...
				var abbrevTableEntry = abbrevTableAddr + 2 * abbrevTableEntryNum;
				// ...and then i guess because they're WORD addresses, we must double
				// to get the BYTE address:
				var abbrevAddr = dv.getUint16(abbrevTableEntry, false) * 2;
				var abbrev = readString(abbrevAddr);

				s += abbrev;
				abbrevPage = 0;

				return;
			}

			// 3.2.3
			// In Versions 3 and later, the current alphabet is always A0 unless changed for 1 character only: Z-characters 4 and 5 are shift characters.
			// TODO: handle each of 0-5 properly
			// TODO: newlines
			// TODO: A2-0x06 ten bit thing
			switch (c) {
				case 0:
					// 3.5.1
					// The Z-character 0 is printed as a space (ZSCII 32).
					s += " ";
					break;
				case 1:
				case 2:
				case 3:
					abbrevPage = c;
					break;
				case 4:
					alphabet = (alphabet + 1) % 3;
					break;
				case 5:
					alphabet = (alphabet + 2) % 3;
					break;
				default:
					if (alphabet == 2 && c == 6) {
						throw "ten-bit thing not supported";
					}

					s += alphabets[alphabet][c];
					alphabet = 0;
					break;
			}
		});

		if (word & 0b1000_0000_0000_0000) {
			return s;
		}
	}

	return s;
}

function executeNextInstruction(dv) {
  log(`Reading next instruction, at address 0x${pc.toString(16)}`);

  // https://www.inform-fiction.org/zmachine/standards/z1point1/sect04.html
  var firstByte = readPC();
  log(`  Found firstByte 0x${firstByte.toString(16).padStart(2, '0')} / 0b${firstByte.toString(2).padStart(8, '0')}`);

  var opcode = firstByte;
  log(`  opcode is ${opcode}`);

	var operands;

	switch ((opcode & 0b1100_0000) >> 6) { // form=?
		case 0b11: // variable
			operands = readOperandsVAR();
			break;
		case 0b10: // short
			operands = readOperandsShort(firstByte);
			break;
		default: // long
			operands = readOperandsLong(firstByte);
			break;
	}

  // opcodes by name: https://inform-fiction.org/zmachine/standards/z1point1/sect15.html
  // opcodes by number: https://inform-fiction.org/zmachine/standards/z1point1/sect14.html
  switch (opcode) {
	  case 13:
	 		ops.store(operands);
  		break;
		case 79:
			ops.loadw(operands);
			break;
    case 84:
      // add a b -> (result); a is a 'var', b is a 'small constant'
      ops.add(operands);
      break;
    case 85:
      ops.sub(operands);
      break;
    case 97:
      ops.je(operands);
      break;
    case 116:
      ops.add(operands);
      break;
		case 140:
			ops.jump(operands);
			break;
    case 160:
      ops.jz_var(operands);
      break;
		case 171:
			ops.ret(operands);
			break;
    case 224:
      ops.call(operands);
      break;
		case 225:
			ops.storew(operands);
			break;
		case 227:
			ops.put_prop(operands);
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
	store: function(operands) {
		var varName = operands[0];
		var value = operands[1];

		// TODO: double check this?
		// in zzo38, if op0 is 0, he REPLACES the value at atop the stack,
		// rather than pushing onto it, which seems wrong...
		// that's in function "xstore" which takes 2 args.
		// but his function "store" which is analogous but takes 1 arg
		// (and reads the var from the "special" var byte after the instruction)
		// pushes in that case as expected. weird...
		// i'm gonna go with pushing, which is how i read 6.3.
		//
		// also: vars are 16-bit values, but operand can be 8 bit, so... do we interpret
		// values as signed and pad left with 0xf's?
		writeVar(varName, value);
	},
	loadw: function(operands) {
		var arrayAddress = operands[0];
		var elementIndex = operands[1];
		var resultVar = readPC();
		var elementAddress = arrayAddress + (2 * elementIndex);
		var word = dv.getUint16(elementAddress, false);

		writeVar(resultVar, word);
	},
	call: function(operands) {
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
      localVars: localVars,
			// unsure if this is right, but this is my understanding of what is meant
			// by "the stack" in section 6:
			// 6.3
			// Writing to the stack pointer (variable number $00) pushes a value onto the stack; reading from it pulls a value off. Stack entries are 2-byte words as usual.
			//
			// 6.3.1
			// The stack is considered as empty at the start of each routine: it is illegal to pull values from it unless values have first been pushed on.
			//
			// 6.3.2
			// The stack is left empty at the end of each routine: when a return occurs, any values pushed during the routine are thrown away.
			substack: []
    };

		log("Pushing onto callstack: " + JSON.stringify(newStackFrame));

    callStack.push(newStackFrame);
    pc = routineAddress + 1 + (2 * routineLocalVarCount);

    // TODO: set pc via fn, which also logs its new value

    // throw "opcode 'call' is recognized but not yet supported";
    // debugger;
  },
	add: function(operands) {
		var a = operands[0];
		var b = operands[1];
		var resultVar = readPC();

		writeVar(resultVar, a + b);
	},
  je: function(operands) {
  	// je a b ?(label)
    // that is: check whether a == b. (that is, compare the VALUES in VARS a and b.)
    // what to do with the result depends on the byte after b:
    // (see 4.7)
    // this says it gives an OFFSET as a SIGNED 14-bit number. does that mean
    // relative to the current... instruction?

		// TODO: still dry this up more better across jump instructions!
    var a = operands[0];
    var b = operands[1];
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
  jz_var: function(operands) {
    // jump if a == 0.
		// TODO: still dry this up more better across jump instructions!
		var a = operands[0];
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
  sub: function(operands) {
    var a = operands[0];
    var b = operands[1];
    var resultVar = readPC();

    writeVar(resultVar, a - b);
  },
	storew: function(operands) {
		// https://inform-fiction.org/zmachine/standards/z1point1/sect15.html#storew
		var arrayAddress = operands[0];
		var elementIndex = operands[1];
		var value = operands[2];
		var elementAddress = arrayAddress + (2 * elementIndex);
		dv.setUint16(elementAddress, value, false);
	},
	put_prop: function(operands) {
		var objectId = operands[0];
		var propertyId = operands[1];
		var value = operands[2];

		// TODO: dry w/ logObjectTable
		// remember, objects start from 1, not 0
		var propAddressPtr = dv.getUint16(0x0a, false)
			+ 31 * 2             // skip past property defaults table
			+ (objectId - 1) * 9 // skip to the right object
			+ 7;                 // object's properties table addr given in byte 7
		var propAddr = dv.getUint16(propAddressPtr, false);
		// first up is the byte giving the length of the short name (in words, not
		// bytes), then the short name itself. skip past those:
		propAddr += (1 + (2 * dv.getUint8(propAddr, false)));

		// scan the obejct's properties until we find the right one
		while (true) {
			var propSizeByte = dv.getUint8(propAddr, false);
			// 12.4.1
			// "the size byte is arranged as 32 times the number of data bytes minus one, plus the property number."
			// strange way of saying:
			// - property number given in bottom 5 bits (range 0-31)
			// - size (bytes?) given in top 3 bits (range 0-7) - but add one to that!
			var currentPropertyId = propSizeByte & 0b0001_1111;
			var currentPropertySize = ((propSizeByte & 0b1110_0000) >> 5) + 1;

			if (currentPropertyId == propertyId) {
				// we found it
				switch (currentPropertySize) {
					case 1:
						// "If the property length is 1, then the interpreter should store only the least significant byte of the value."
						dv.setUint8(propAddr + 1, value & 0xff, false);
						break;
					case 2:
						dv.setUint16(propAddr + 1, value, false);
						break;
					default:
						// "As with get_prop the property length must not be more than 2: if it is, the behaviour of the opcode is undefined."
						throw `unsupported property value size: ${currentPropertySize}`;
				}
				
				return;
			}

			if (currentPropertyId == 0) {
				// end of object's property list
				throw `object ${objectId} does not have property ${propertyId}`;
			}

			propAddr += (1 + currentPropertySize);
		}
	},
	ret: function(operands) {
		var returnValue = operands[0];
		var topFrame = callStack.pop();

		// this fuckin fails if "storeVariable" is 0 - which means top of stack -
		// and call stack is empty.
		// how zzo does this shit is:
		// 1.
		writeVar(topFrame.storeVariable, returnValue);
		pc = topFrame.returnAddress;
	},
	jump: function(operands) {
		// unconditional jump. not a "branch"; op0 is the destination offset:
		var offset = operands[0];
		if (offset & 0x8000) {
			// it was pulled from the DataView as an unsigned 16-bit value, but
			// it's a signed 16-bit value; negate it properly:
			offset -= 0x10000;
		}
		pc += (offset - 2);
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

function readOperandsShort(firstByte) {
	var operandType = (firstByte & 0b0011_0000) >> 4;

	switch (operandType) {
		case 0b11: // none; 0OP
			return [];
		default: // 1OP
			return [readNextOperand(operandType)];
	}
}

function readOperandsLong(firstByte) {
	// 4.3.2
	// In long form the operand count is always 2OP. The opcode number is given in the bottom 5 bits.
	// 4.4.2
	// In long form, bit 6 of the opcode gives the type of the first operand, bit 5 of the second. A value of 0 means a small constant and 1 means a variable. (If a 2OP instruction needs a large constant as operand, then it should be assembled in variable rather than long form.)
	var operandTypes = [
		(firstByte & 0b0100_0000) ? 0b10 : 0b01,
		(firstByte & 0b0010_0000) ? 0b10 : 0b01
	];
	var operands = [
		readNextOperand(operandTypes[0]),
		readNextOperand(operandTypes[1])
	];
	return operands;
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

		var operand = readNextOperand(operandType);

		operands.push(operand);
		operandIndex += 1;
	}

	log("  operand types: " + operandTypes.join(", "));
	log("  operands: " + operands.map((o) => '0x' + o.toString(16)).join(", "));

	return operands;
}

function readNextOperand(operandType) {
	switch (operandType) {
		case 0b00: // large constant
			return readPC16();
		case 0b01: // small constant
			return readPC();
		case 0b10: // variable
			return readVar(readPC());
		default:
			throw "unrecognized operand type 0x" + operandType.toString(16);
	}
}

function readVar(n) {
  if (n == 0) {
    return topCallStackFrame().substack.pop();
  }

  if (n < 0x10) {
    // TODO: validate frame has this many vars
    return topCallStackFrame().localVars[n - 1];
  }

  return dv.getUint16(globalVarAddress(n), false);
}

function writeVar(n, x) {
  if (n == 0) {
    topCallStackFrame().substack.push(x);
		return;
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

	// logOnPage(s);
}

function logOnPage(s) {
	var log = document.querySelector("#log");
	var logpane = document.querySelector("#logpane");
  var div = document.createElement('div');

  if (color) { div.style.color = color; }

	div.textContent = outline;

  log.append(div);

	// this accounts for 97% of program time?
	logpane.scrollTo(0, logpane.scrollHeight);
}
