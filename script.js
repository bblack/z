// var OPERAND_TYPES = [
//   {id: 0b00, name: 'LARGE_CONSTANT', size: 2},
//   {id: 0b01, name: 'SMALL_CONSTANT', size: 1},
//   {id: 0b10, name: 'VARIABLE', size: 1},
//   {id: 0b11, name: 'OMITTED', size: 0}
// ];
// var OPERAND_TYPES_BY_ID = OPERAND_TYPES.reduce((acc, el) => {acc[el.id] = el; return acc}, {});
// var OPERAND_TYPES_BY_NAME = OPERAND_TYPES.reduce((acc, el) => {acc[el.name] = el; return acc}, {});

var pc = -1;
var callStack = [];

document.querySelector("#file").addEventListener('change', function(event) {
  var file = this.files[0];

  file.arrayBuffer().then((ab) => {
    var dv = new DataView(ab);
    // var header = ab.slice(0, 36);
    pc = dv.getUint16(0x06, false);
    log("pc: 0x" + pc.toString(16));

    while (true) {
      executeNextInstruction(dv);
    }
  });
});

function executeNextInstruction(dv) {
  var firstByte = dv.getUint8(pc);

  log("Next instruction's first byte: " + firstByte);

  switch (firstByte) {
    case 224:
      log("CALL");
      instructions.call(dv, pc);
      break;
    default:
      throw "Unrecognized first byte: " + firstByte
  }
}

function log(s) {
  console.log(s);
}

var instructions = {
  call: function(dv, pc) {
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

    log("operand types: " + operandTypes.join(", "));
    log("operands: " + operands.map((o) => '0x' + o.toString(16)).join(", "));
    log("store var: " + storeVariable);

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
    // 2. values of locals given by routine itself
    // 3. values of first N locals replaced by ARGS
    var localVars = new Uint16Array(routineLocalVarCount);

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

    debugger;


  }


}

function assert(condition, msg) {
  if (!condition) {
    throw msg;
  }
}
