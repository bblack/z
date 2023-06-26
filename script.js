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
  new Array(6).fill(undefined).concat(' \n0123456789.,!?_#\'"/\\-:()'.split('')),
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
  var addr = objectTableAddress();
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

function readString(addr, onAddrAdvanced) {
  var s = "";
  var alphabet = 0;
  var abbrevPage = 0;

  while (true) {
    var word = dv.getUint16(addr);
    addr += 2;
    if (onAddrAdvanced) {
      onAddrAdvanced.call(this, addr);
    }
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
      break; // terminator reached
    }
  }

  return s;
}

function executeNextInstruction(dv) {
  log(`Reading next instruction, at address 0x${pc.toString(16)}`);

  // https://www.inform-fiction.org/zmachine/standards/z1point1/sect04.html
  var firstByte = readPC();
  log(`  Found firstByte 0x${firstByte.toString(16).padStart(2, '0')} / 0b${firstByte.toString(2).padStart(8, '0')}`);

  var form;
  var canonicalOpcode;
  var opcode = firstByte;
  var operands;

  switch ((opcode & 0b1100_0000) >> 6) { // form=?
    case 0b11: // variable
      form = 'var';
      canonicalOpcode = firstByte & 0b1_1111;
      operands = readOperandsVAR();
      break;
    case 0b10: // short
      form = 'short';
      canonicalOpcode = firstByte & 0b1111;
      operands = readOperandsShort(firstByte);
      break;
    default: // long
      form = 'long';
      canonicalOpcode = firstByte & 0b1_1111;
      operands = readOperandsLong(firstByte);
      break;
  }

  log(`  form=${form}; canonicalOpcode=${canonicalOpcode}`);

  // opcodes by name: https://inform-fiction.org/zmachine/standards/z1point1/sect15.html
  // opcodes by number: https://inform-fiction.org/zmachine/standards/z1point1/sect14.html
  switch (opcode) {
    // case 1:
    case 65:
    case 97:
    case 193: // var form
      ops.je(operands);
      break;
    // case 2:
    case 66:
      ops.jl(operands);
      break;
    case 5:
      ops.inc_chk(operands);
      break;
    // case 6:
    case 70:
      ops.jin(operands);
      break;
    // case 9:
    case 73:
      ops.and(operands);
      break;
    // case 10:
    case 74:
      ops.test_attr(operands);
      break;
    // case 11:
    case 75:
      ops.set_attr(operands);
      break;
    case 13:
    case 45:
      ops.store(operands);
      break;
    // case 14:
    case 110:
      ops.insert_obj(operands);
      break;
    case 15:
    case 79:
      ops.loadw(operands);
      break;
    case 16:
    case 48:
      ops.loadb(operands);
      break;
    // case 17:
    case 81:
      ops.get_prop(operands);
      break;
    case 84:
      // add a b -> (result); a is a 'var', b is a 'small constant'
      ops.add(operands);
      break;
    case 85:
      ops.sub(operands);
      break;
    case 116:
      ops.add(operands);
      break;
    // case 129:
    case 161:
      ops.get_sibling(operands);
      break;
    // case 130:
    case 162:
      ops.get_child(operands);
      break;
    // case 133:
    case 149:
      ops.inc(operands);
      break;
    // case 138:
    case 170:
      ops.print_object(operands);
      break;
    case 140:
      ops.jump(operands);
      break;
    // case 141:
    case 173:
      break;
      ops.print_paddr(operands);
      break;
    case 160:
      ops.jz(operands);
      break;
    case 163:
      ops.get_parent(operands);
      break;
    case 171:
      ops.ret(operands);
      break;
    case 176:
      ops.rtrue(operands);
      break;
    case 177:
      ops.rfalse(operands);
      break;
    case 178:
      ops.print(operands);
      break;
    case 184:
      ops.ret_popped(operands);
      break;
    case 187:
      ops.new_line();
      break;
    case 201:
      // top 2 bits are 11, so form=VAR
      // form=VAR and next topmost bit is 0, so opcount=2OP.
      // bottom 5 bits are 9, so...? 2OP:9, bitwise and?
      ops.and(operands);
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
    case 229:
      ops.print_char(operands);
      break;
    case 230:
      ops.print_num(operands);
      break;
    case 232:
      ops.push(operands);
      break;
    case 233:
      ops.pull(operands);
      break;
    default:
      throw `unsupported opcode ${opcode}`;
  }
}

const ops = {
  inc_chk: function(operands) {
    var varName = operands[0];
    var threshold = operands[1];

    var oldVal = readVar(varName);
    var newVal = oldVal + 1;
    writeVar(varName, newVal);

    followJumpIf(newVal > threshold);
  },
  jin: function(operands) {
    var obj1Id = operands[0];
    var obj2Id = operands[1];

    var obj1Addr = objectAddress(obj1Id);
    var objectIsChildOfObject = dv.getUint8(obj1Addr + 4, false) == obj2Id;

    followJumpIf(objectIsChildOfObject);
  },
  and: function(operands) {
    var a = operands[0];
    var b = operands[1];
    var resultVar = readPC();

    // bitwise and
    writeVar(resultVar, a & b);
  },
  test_attr: function(operands) {
    var objectId = operands[0];
    var attrId = operands[1];

    var objectAddr = objectAddress(objectId);
    // each entry in object table is 9 bytes; first 4 bytes are 32 attr flags:
    var attrFlags = dv.getUint32(objectAddr, false);
    // this is basically right-shifting "attrId" places from the left, but
    // that would bring in 1s instead of 0s, so:
    var attrIsSet = attrFlags & (1 << (31 - attrId));

    // NOTE: zzo calls this opcode "FSET". it calls an argless fn,
    // flagset(), which does this odd thing: even though there are 32 attr
    // flags, flagset() sticks makes a 16-bit mask and puts it in "op3", then
    // records to op2 either the first 16 attr flags, or last 16, depending
    // on which one contains the target attr. no idea why (yet).

    followJumpIf(attrIsSet);
  },
  set_attr(operands) {
    var objectId = operands[0];
    var attrId = operands[1];

    var objectAddr = objectAddress(objectId);
    var attrFlags = dv.getUint32(objectAddr, false);
    var newAttrFlags = attrFlags | (1 << (31 - attrId));

    dv.setUint32(objectAddr, newAttrFlags, false);
  },
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
  loadb: function(operands) {
    var arrayAddress = operands[0];
    var byteOffset = operands[1];
    var resultVar = readPC();
    var elementAddress = arrayAddress + byteOffset;
    var byte = dv.getUint8(elementAddress, false);

    writeVar(resultVar, byte);
  },
  get_prop: function(operands) {
    var objectId = operands[0];
    var propertyId = operands[1];
    var resultVar = readPC();

    // Read property from object (resulting in the default value if it had no such declared property). If the property has length 1, the value is only that byte. If it has length 2, the first two bytes of the property are taken as a word value. It is illegal for the opcode to be used if the property has length greater than 2, and the result is unspecified.
    var propValue;

    // TODO: dry with put_prop
    // object's properties table addr given in byte 7
    var propAddressPtr = objectAddress(objectId) + 7;
    var propTableAddr = dv.getUint16(propAddressPtr, false);
    var propAddr = propTableAddr; // we'll be incrementing this
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
        // If the property has length 1, the value is only that byte. If it has length 2, the first two bytes of the property are taken as a word value.
        // It is illegal for the opcode to be used if the property has length greater than 2, and the result is unspecified.
        if (currentPropertySize == 1) {
          propValue = dv.getUint8(propAddr + 1, false);
        } else if (currentPropertySize == 2) {
          propValue = dv.getUint16(propAddr + 1, false);
        } else {
          throw `unsupported property value size: ${currentPropertySize}`;
        }

        break;
      }

      if (currentPropertyId == 0) {
        // end of object's property list; take the default:
        if (propertyId > 31) {
          throw "obj lacked property " + propertyId + "but you can't have a default value for a property with that id";
        }
        propValue = defaultPropertyValue(propertyId);
        break;
      }

      propAddr += (1 + currentPropertySize);
    }

    writeVar(resultVar, propValue); // i guess?
  },
  insert_obj: function(operands) {
    var targetId = operands[0];
    var newParentId = operands[1];

    // TODO: validate ids are in proper range
    if (targetId == 0) { throw 'nyi'; }
    if (newParentId == 0) { throw 'nyi'; }
    if (targetId > 255) { throw 'invalid'; }
    if (newParentId > 255) { throw 'invalid'; }


    // TODO:
    // var zobj_t = new Struct([definition])
    // var destObj = zobj_t.at(dv, address)'
    // TODO: dry up with logObjectTable e.g.
    var targetAddr = objectAddress(targetId);
    var newParentAddr = objectAddress(newParentId);

    // TODO: properly handle "old parent = null"
    var oldParentId = dv.getUint8(targetAddr + 4, false);
    var oldParentAddr = objectAddress(oldParentId);
    var oldParentFirstChildId = dv.getUint8(oldParentAddr + 6, false);
    var oldParentFirstChildAddr = objectAddress(oldParentFirstChildId);
    var oldParentSecondChildId = dv.getUint8(oldParentFirstChildAddr + 5, false);

    // change src's parent:
    dv.setUint8(targetAddr + 4, newParentId, false);
    // change src's next sibling to new parent's first child:
    dv.setUint8(targetAddr + 5, dv.getUint8(newParentAddr + 6), false);

    // change new parent's first child:
    dv.setUint8(newParentAddr + 6, targetId, false);
    // point old parent's first child to old parent's first child's
    // next sibling, if it was pointing to src; else poinnt its prev sibling to
    // its next
    if (oldParentFirstChildId == targetId) {
      dv.setUint8(oldParentAddr + 6, oldParentSecondChildId, false);
    } else {
      var currentSiblingId = oldParentFirstChildId;
      var currentSiblingAddr;
      var nextSiblingId;
      var nextSiblingAddr;
      var childAfterNextId;

      while (true) {
        currentSiblingAddr = objectAddress(currentSiblingId);
        nextSiblingId = dv.getUint8(currentSiblingAddr + 5, false);

        if (nextSiblingId == targetId) {
          // if the next sibling is "src", point this to the one after:
          nextSiblingAddr = objectAddress(nextSiblingId);
          childAfterNextId = dv.getUint8(nextSiblingAddr + 5, false);
          dv.setUint8(currentSiblingAddr + 5, childAfterNextId, false);
          break;
        } else if (nextSiblingId == 0) {
          // if the next sibling is null, we're at the end.
          break;
        } else {
          currentSiblingId = nextSiblingId;
        }
      }
    }
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
      // 6.4.3
      // A routine call to packed address 0 is legal: it does nothing and returns false (0). Otherwise it is illegal to call a packed address where no routine is present.
      // (i guess "return" above means "put into the given result var" and not
      // "pop call stack and jump to that frame's return address")
      writeVar(storeVariable, 0);
      return;
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
      localVars[i] = dv.getUint16(routineAddress + 1 + i*2, false);
    }
    // 3. values of first N locals replaced by ARGS
    var args = operands.slice(1) // skip op0, which is routine's addr
      .slice(0, routineLocalVarCount); // don't take more args than routine has local vars
    args.forEach((arg, i) => {
      localVars[i] = arg;
    });

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
  },
  add: function(operands) {
    var a = operands[0];
    var b = operands[1];
    var resultVar = readPC();

    writeVar(resultVar, a + b);
  },
  get_sibling: function(operands) {
    var objectId = operands[0];
    var resultVar = readPC();

    var objectAddr = objectAddress(objectId);
    var siblingId = dv.getUint8(objectAddr + 5, false);

    writeVar(resultVar, siblingId);
    followJumpIf(siblingId != 0);
  },
  get_child: function(operands) {
    var objectId = operands[0];
    var resultVar = readPC();

    var objectAddr = objectAddress(objectId);
    var childId = dv.getUint8(objectAddr + 6, false);

    writeVar(resultVar, childId);
    followJumpIf(childId != 0);
  },
  inc: function(operands) {
    var varName = operands[0];
    var value = readVar(varName);

    writeVar(varName, value + 1);
  },
  je: function(operands) {
    // je a b ?(label)
    // that is: check whether a == b. (that is, compare the VALUES in VARS a and b.)
    // what to do with the result depends on the byte after b:
    // (see 4.7)
    // this says it gives an OFFSET as a SIGNED 14-bit number. does that mean
    // relative to the current... instruction?
    var a = operands[0];

    // check if a == ANY other operands.
    // in var mode there can be more than just a, b
    followJumpIf(operands.slice(1).some((b) => a == b));
  },
  jl: function(operands) {
    // Jump if a < b (using a signed 16-bit comparison).
    var a = operands[0];
    var b = operands[1];

    if (a > 0x7fff) {
      debugger;
      a = 1 - (a & 0x7fff);
    }

    if (b > 0x7fff) {
      debugger;
      b = 1 - (b & 0x7fff);
    }

    followJumpIf(a < b);
  },
  print_paddr(operands) {
    var packedAddr = operands[0];
    var addr = packedAddr * 2;
    debugger;
    var s = readString(addr);
    printOutput(s);
  },
  jz: function(operands) {
    // jump if a == 0.
    var a = operands[0];

    followJumpIf(a == 0);
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
    // TODO: dry w/ get_prop
    // object's properties table addr given in byte 7
    var propAddressPtr = objectAddress(objectId) + 7;
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

      // TODO we REALLY need to dry this up so we don't keep having to fix
      // everything twice
      if (currentPropertyId == propertyId) {
        // we found it
        if (currentPropertySize == 1) {
          // "If the property length is 1, then the interpreter should store only the least significant byte of the value."
          dv.setUint8(propAddr + 1, value & 0xff, false);
          break;
        } else if (currentPropertySize == 2) {
          dv.setUint16(propAddr + 1, value, false);
          break;
        } else {
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
  print_char: function(operands) {
    var n = operands[0];
    var c = charFromZsciiCode(n);

    printOutput(c);
  },
  print_num: function(operands) {
    var a = operands[0];

    if (a > 0x7f) {
      // docs say this is signed:
      // https://www.inform-fiction.org/zmachine/standards/z1point1/sect15.html#print_num
      // so, once we get our first negative, let's double check that:
      debugger;
      a = -(~(a & 0x7f) + 1);
    }

    printOutput(a.toString());
  },
  push: function(operands) {
    var value = operands[0];
    writeVar(0, value);
  },
  pull: function(operands) {
    var value = readVar(0);
    writeVar(operands[0], value);
  },
  get_parent: function(operands) {
    var objectId = operands[0];
    var resultVar = readPC();

    var objectAddr = objectAddress(objectId);
    var parentId = dv.getUint8(objectAddr + 4, false);

    writeVar(resultVar, parentId);
  },
  ret: function(operands) {
    returnWithValue(operands[0]);
  },
  rtrue: function(operands) {
    returnWithValue(1);
  },
  rfalse: function(operands) {
    returnWithValue(0);
  },
  print: function(operands) {
    // 0-op: "Print the quoted (literal) Z-encoded string."
    // debugger;
    var s = readString(pc, (addr) => pc = addr);
    printOutput(s);
  },
  ret_popped: function(operands) {
    returnWithValue(readVar(0));
  },
  new_line: function(operands) {
    printOutput("\n");
  },
  print_object: function(operands) {
    // TODO validate obj id
    var objectId = operands[0];
    var objectAddr = objectAddress(objectId);
    // TODO: dry w/ logObjectTable via struct:
    var propertiesAddr = dv.getUint16(objectAddr + 7, false);
    var shortNameBytePtr = propertiesAddr + 1;
    var shortName = readString(shortNameBytePtr);
    printOutput(shortName);
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
    if (operandIndex >= operandTypes.length) break;

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
    var stack = topCallStackFrame().substack;
    if (stack.length == 0) { throw "illegal to pop empty stack"; }
    return stack.pop();
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

function objectAddress(objectId) {
  // remember, objects start from 1, not 0
  return objectTableAddress()
    + 31 * 2             // skip past property defaults table
    + (objectId - 1) * 9; // skip to the right object
}

function defaultPropertyValue(propertyId) {
   return dv.getUint16(objectTableAddress() + 2 * (propertyId - 1));
}

function objectTableAddress() {
  return dv.getUint16(0x0a, false);
}

function followJumpIf(predicate) {
  var branchInfo1 = readPC();
  var branchInfo2;
  var offset;
  var willJump = ((branchInfo1 & 0b1000_0000) == 0) ? !predicate : predicate;

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
    if (offset == 0 || offset == 1) {
      // 4.7.1
      // An offset of 0 means "return false from the current routine", and 1 means "return true from the current routine".
      returnWithValue(offset);
      return;
    }

    pc += (offset - 2);
  }
}

function charFromZsciiCode(n) {
  if (n == 0) return '';
  if (n >= 32 && n <= 126) return String.fromCharCode(n);

  throw 'unrecognized zscii code: ' + n;
}

function returnWithValue(returnValue) {
  var topFrame = callStack.pop();

  // this fuckin fails if "storeVariable" is 0 - which means top of stack -
  // and call stack is empty.
  // how zzo does this shit is:
  // 1.
  writeVar(topFrame.storeVariable, returnValue);
  pc = topFrame.returnAddress;
}

// -- Below here: stuff that's NOT part of the z-machine --

function printOutput(s) {
  var outputEl = document.querySelector('#stdout');
  var span = document.createElement('span');

  span.textContent = s;
  outputEl.append(span);
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
