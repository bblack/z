function Z(opts) {
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
  var textBufferAddr;
  var parseBufferAddr;

  const alphabets = [
    new Array(6).fill(undefined).concat('abcdefghijklmnopqrstuvwxyz'.split('')),
    new Array(6).fill(undefined).concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    new Array(6).fill(undefined).concat(' \n0123456789.,!?_#\'"/\\-:()'.split('')),
  ];
  const printOutput = opts.onOutput;
  const log = opts.onLog;
  // inputs: a list of commands given before running the game. for testing.
  const inputs = opts.inputs || [];
  const onStatusLineUpdated = opts.onStatusLineUpdated || function(){};

  var AWAITING_INPUT = false;

  this.dv = () => dv;
  this.pc = () => pc;
  this.loadGame = loadGame;
  this.objectTableAddress = objectTableAddress;
  this.readString = readString;
  this.provideInput = provideInput;

  function loadGame(ab) {
    log(`Read ${ab.byteLength} bytes`);

    dv = new DataView(ab);

    // doc says "byte address" - but relative to what?
    // start of all mem? dynamic? static? high?
    pc = dv.getUint16(0x06, false);

    // defer it to give clients an opportunity to do something before the game
    // runs:
    setTimeout(() => readInstructionLoop());
  }

  function zsciiCodeFromAsciiCode(n) {
    if (n >= 32 && n <= 126) {
      return n;
    }

    throw "mapping from ascii " + n + " to zscii not implemented (yet)";
  }

  function provideInput(s) {

    // TODO: read esc, del, etc and convert all this to zscii chars
    // s = stringToZsciiBuffer(s);

    // docs don't say this explicitly, but i'm ASSUMING that the "text-buffer"
    // is to be filled at this point.
    // TODO: if so, it may be important to store them as ZSCII rather than ASCII.

    // In Versions 1 to 4, byte 0 of the text-buffer should initially contain the maximum number of letters which can be typed, minus 1
    var maxLetters = dv.getUint8(textBufferAddr, false) - 1;

    // The text typed is reduced to lower case (so that it can tidily be printed back by the program if need be) and stored in bytes 1 onward
    s = s.slice(0, maxLetters - 1).toLowerCase();

    // 7.1.1.1
    // In Versions 1 to 5, the player's input to the read opcode should be echoed to output streams 1 and 2 (if stream 2 is active), so that text typed in appears in any transcript.
    printOutput(s);

    for (var i = 0; i < maxLetters; i++) {
      var z = (i < s.length) ?
        zsciiCodeFromAsciiCode(s.charCodeAt(i)) :
        0;
      dv.setUint8(textBufferAddr + i + 1, z, false);
    }

    // Initially, byte 0 of the parse-buffer should hold the maximum number of textual words which can be parsed.
    // (If this is n, the buffer must be at least 2 + 4*n bytes long to hold the results of the analysis.)
    const maxWords = dv.getUint8(parseBufferAddr);

    // The interpreter divides the text into words
    var words = splitCommand(s).slice(0, maxWords);

    // and looks them up in the dictionary table
    var wordEntries = lookupWords(words);

    // If input was terminated in the usual way, by the player typing a carriage return, then a carriage return is printed
    printOutput("\n");

    // TODO: If it was interrupted, the cursor is left at the rightmost end of the text typed in so far.

    // Next, lexical analysis is performed on the text
    // The number of words is written in byte 1
    dv.setUint8(parseBufferAddr + 1, wordEntries.length, false);
    // and one 4-byte block is written for each word, from byte 2 onwards (except that it should stop before going beyond the maximum number of words specified).
    wordEntries.forEach((we, i) => {
      // Each block consists of the byte address of the word in the dictionary,
      dv.setUint16(parseBufferAddr + 2 + 4*i, we);
      // followed by a byte giving the number of letters in the word;
      // TODO: is this the word IN THE DICTIONARY, capped at 6 chars?
      // or the word RECEIVED from the player? guessing it's what's typed by the
      // user, and that that's used in the response
      // e.g. "I don't know the word 'superduperlongword'".
      dv.setUint8(parseBufferAddr + 2 + 4*i + 2, words[i].length);
      // and finally a byte giving the position in the text-buffer of the first letter of the word.
      // TODO this is a real shitty hack - we should be getting this as we
      // scan the zscii-text buffer - the same word appearing a 2nd time should
      // return a later number.
      var textBufferIndex = s.indexOf(words[i]) + 1;

      dv.setUint8(parseBufferAddr + 2 + 4*i + 3, textBufferIndex);
    })


    AWAITING_INPUT = false;
    setTimeout(readInstructionLoop);
  }

  function lookupWords(words) {
    return words.map((w) => lookupWord(w));
  }

  function lookupWord(word) {
    // TODO: zscii not ascii
    var addr = dictionaryTableAddress();
    var separatorsCount = dv.getUint8(addr, false);
    addr += (1 + separatorsCount)
    var entryLength = dv.getUint8(addr, false);
    addr += 1;
    var entryCount = dv.getUint16(addr, false);
    addr += 2;
    // now we're at the first entry

    for (var i = 0; i < entryCount; i++) {
      var text = readString(addr);

      if (text == word.slice(0, 6)) {
        return addr;
      }

      addr += entryLength;
    }

    return 0;
  }

  function splitCommand(s) {
    var dictionaryTableAddr = dictionaryTableAddress();
    var separators = [];
    var separatorCount = dv.getUint8(dictionaryTableAddr, false);

    for (var i=0; i < separatorCount; i++) {
      separators.push(dv.getUint8(dictionaryTableAddr + 1 + i, false));
    }

    separators = separators.map((n) => String.fromCharCode(n)).join('');
    // TODO: zscii, although separators are typically chars w/ equivalent ascii codes

    // TODO: the separator char thing (13.6.1)
    return s.split(' ');
  }

  function dictionaryTableAddress() {
    return dv.getUint16(0x08, false);
  }

  function readInstructionLoop() {
    while (!AWAITING_INPUT) {
      executeNextInstruction(dv);
    }
  }

  function readString(addr, onAddrAdvanced) {
    var s = "";
    var alphabet = 0;
    var abbrevPage = 0;
    var zsciiDirect = 0;
    var zsciiBits = 0;

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
        if (zsciiDirect > 0) {
          zsciiBits = (zsciiBits << 5) | c;
          zsciiDirect -= 1;
          if (zsciiDirect == 0) {
            s += charFromZsciiCode(zsciiBits);
            zsciiBits = 0;
          }
          return;
        }

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
              zsciiDirect = 2;
            } else {
              s += alphabets[alphabet][c];
            }

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

  function executeNextInstruction() {
    var instAddr = pc;

    // https://www.inform-fiction.org/zmachine/standards/z1point1/sect04.html
    var firstByte = readPC();
    this.icount = (this.icount || 0) + 1;
    log(`icount: ` + icount);

    log(`0x${(pc-1).toString(16).padStart(4, '0')}: ${firstByte}`);

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

    log(`  form=${form}; canonicalOpcode=0x${canonicalOpcode.toString(16)}`);


    // TODO: STOP ENUMERATING EVERY ALIAS - THIS IS ERROR PRONE AND SLOWS
    // DEVELOPMENT

    // opcodes by name: https://inform-fiction.org/zmachine/standards/z1point1/sect15.html
    // opcodes by number: https://inform-fiction.org/zmachine/standards/z1point1/sect14.html
    switch (opcode) {
      // case 1:
      case 33:
      case 65:
      case 97:
      case 193: // var form
        ops.je(operands);
        break;
      // case 2:
      case 66:
      case 98:
        ops.jl(operands);
        break;
      // case 3:
      case 35:
      case 67:
      case 99:
        ops.jg(operands);
        break;
      case 4:
        ops.dec_chk(operands);
        break;
      case 5:
      case 37:
      case 197:
        ops.inc_chk(operands);
        break;
      case 6:
      case 38:
      case 70:
      case 102:
        ops.jin(operands);
        break;
      // case 7:
      case 71:
      case 103:
        ops.test(operands);
        break;
      // case 9:
      case 73:
        ops.and(operands);
        break;
      case 10:
      case 74:
      case 106:
        ops.test_attr(operands);
        break;
      case 11:
      case 75:
        ops.set_attr(operands);
        break;
      case 12:
      case 76:
        ops.clear_attr(operands);
        break;
      case 13:
      case 45:
      case 205:
        ops.store(operands);
        break;
      // case 14:
      case 46:
      case 110:
        ops.insert_obj(operands);
        break;
      case 15:
      case 79:
      case 111:
        ops.loadw(operands);
        break;
      case 16:
      case 48:
      case 80:
      case 112:
        ops.loadb(operands);
        break;
      case 17:
      case 81:
        ops.get_prop(operands);
        break;
      case 18:
      case 82:
      case 114:
        ops.get_prop_addr(operands);
        break;
      // case 19:
      case 115:
        ops.get_next_prop(operands)
        break;
      case 52:
      case 84:
      case 116:
        // add a b -> (result); a is a 'var', b is a 'small constant'
        ops.add(operands);
        break;
      case 53:
      case 85:
      case 117:
        ops.sub(operands);
        break;
      // case 22:
      case 86:
        ops.mul(operands);
        break;
      // case 23:
      case 87:
        ops.div(operands);
        break;
      // case 129:
      case 161:
        ops.get_sibling(operands);
        break;
      // case 130:
      case 146:
      case 162:
        ops.get_child(operands);
        break;
      // case 131:
      case 147:
      case 163:
        ops.get_parent(operands);
        break;
      // case 132:
      case 164:
        ops.get_prop_len(operands);
        break;
      // case 133:
      case 149:
        ops.inc(operands);
        break;
      case 134:
      case 150:
        ops.dec(operands);
        break;
      // case 135:
      case 167:
        ops.print_addr(operands);
        break;
      // case 138:
      case 170:
        ops.print_object(operands);
        break;
      case 139:
      case 155:
      case 171:
        ops.ret(operands);
        break;
      case 140:
        ops.jump(operands);
        break;
      // case 141:
      case 173:
        ops.print_paddr(operands);
        break;
      // case 142:
      case 174:
        ops.load(operands);
        break;
      case 160:
        ops.jz(operands);
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
      case 179:
        ops.print_ret(operands);
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
      case 226:
        ops.storeb(operands);
        break;
      case 227:
        ops.put_prop(operands);
        break;
      case 228:
        ops.read(operands);
        break;
      case 229:
        ops.print_char(operands);
        break;
      case 230:
        ops.print_num(operands);
        break;
      case 231:
        ops.random(operands);
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
    dec_chk: function(operands) {
      var varName = operands[0];
      var threshold = toSigned16Bit(operands[1]);

      var oldVal = toSigned16Bit(readVar(varName));
      var newVal = oldVal - 1;
      writeVar(varName, newVal);

      followJumpIf(newVal < threshold);
    },
    inc_chk: function(operands) {
      var varName = operands[0];
      var threshold = toSigned16Bit(operands[1]);

      var oldVal = toSigned16Bit(readVar(varName));
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
    test: function(operands) {
      var bitmap = operands[0];
      var flags = operands[1];

      followJumpIf((bitmap & flags) == flags);
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
    clear_attr(operands) {
      var objectId = operands[0];
      var attrId = operands[1];

      var objectAddr = objectAddress(objectId);
      var attrFlags = dv.getUint32(objectAddr, false);
      var newAttrFlags = attrFlags & ~(1 << (31 - attrId));

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

      var propValue = getPropertyValue(objectId, propertyId);

      writeVar(resultVar, propValue); // i guess?
    },
    get_prop_addr: function(operands) {
      var objectId = operands[0];
      var propertyId = operands[1];
      var resultVar = readPC();

      var propAddr = propertyAddress(objectId, propertyId);

      // skip 1 for the size byte. apparently get_prop_addr is supposed to give
      // the address of the data itself, idk.
      var propDataAddr = propAddr == 0 ? 0 : propAddr + 1;

      writeVar(resultVar, propDataAddr);
    },
    get_next_prop: function(operands) {
      var objectId = operands[0];
      var propertyId = operands[1];
      var resultVar = readPC();

      // if called with zero, it gives the first property number present
      if (propertyId == 0) {
        var propAddressPtr = objectAddress(objectId) + 7;
        var propAddr = dv.getUint16(propAddressPtr, false);
        // skip short name length byte and short name:
        propAddr += (1 + (2 * dv.getUint8(propAddr, false)));
        var propSizeByte = dv.getUint8(propAddr, false);
        var nextPropertyId = propSizeByte & 0b0001_1111;
      } else {
        var propAddr = propertyAddress(objectId, propertyId);

        // It is illegal to try to find the next property of a property which does not exist
        if (propAddr == 0) {
          throw `object ${objectId} doesn't have property ${propertyId}`;
        }

        var propSizeByte = dv.getUint8(propAddr, false);
        var currentPropertySize = ((propSizeByte & 0b1110_0000) >> 5) + 1;

        propAddr += (1 + currentPropertySize);
        propSizeByte = dv.getUint8(propAddr, false);
        var nextPropertyId = propSizeByte & 0b0001_1111;
      }

      writeVar(resultVar, nextPropertyId);
    },
    insert_obj: function(operands) {
      var targetId = operands[0];
      var newParentId = operands[1];

      // TODO: validate ids are in proper range
      if (targetId == 0) { throw 'nyi'; }
      if (targetId > 255) { throw 'invalid'; }
      if (newParentId > 255) { throw 'invalid'; }

      // TODO:
      // var zobj_t = new Struct([definition])
      // var destObj = zobj_t.at(dv, address)'
      // TODO: dry up with logObjectTable e.g.
      var targetAddr = objectAddress(targetId);

      // TODO: properly handle "old parent = null"
      var oldParentId = dv.getUint8(targetAddr + 4, false);
      var oldParentAddr = objectAddress(oldParentId);
      var oldParentFirstChildId = dv.getUint8(oldParentAddr + 6, false);
      var oldParentFirstChildAddr = objectAddress(oldParentFirstChildId);
      var oldParentSecondChildId = dv.getUint8(oldParentFirstChildAddr + 5, false);

      // change target's parent:
      dv.setUint8(targetAddr + 4, newParentId, false);

      // point old parent's first child to old parent's first child's
      // next sibling, if it was pointing to target; else poinnt its prev sibling to
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
            // if the next sibling is "target", point this to the one after:
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

      if (newParentId == 0) {
        // change target's next sibling to 0:
        dv.setUint8(targetAddr + 5, 0, false);
      } else {
        var newParentAddr = objectAddress(newParentId);

        // change target's next sibling to new parent's first child:
        dv.setUint8(targetAddr + 5, dv.getUint8(newParentAddr + 6), false);

        // change new parent's first child:
        dv.setUint8(newParentAddr + 6, targetId, false);
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
      var a = toSigned16Bit(operands[0]);
      var b = toSigned16Bit(operands[1]);
      var resultVar = readPC();

      writeVar(resultVar, a + b);
    },
    mul: function(operands) {
      var a = toSigned16Bit(operands[0]);
      var b = toSigned16Bit(operands[1]);
      var resultVar = readPC();

      // Signed 16-bit multiplication.
      writeVar(resultVar, a * b);
    },
    div: function(operands) {
      var a = toSigned16Bit(operands[0]);
      var b = toSigned16Bit(operands[1]);
      var resultVar = readPC();

      // js doesn't have integer division, but this is easy:
      var q = Math.trunc(a / b);
      // and let's check our work:
      var r = a % b;
      if (q * b + r != a) {
        debugger;
        console.warn(`verification of division failed. we found that ${a} / ${a} = ${q}`)
      }

      writeVar(resultVar, q);
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
    get_prop_len: function(operands) {
      var propDataAddr = operands[0];
      var resultVar = readPC();

      // TODO @get_prop_len 0 must return 0
      if (propDataAddr == 0) {
        throw 'nyi';
      }

      // TODO: dry w/ propertyAddress
      // this seems kinda stupid but op0 is the address of the property DATA.
      // we have to backtrack one byte to get the size.
      var propSizeByte = dv.getUint8(propDataAddr - 1, false);
      var propSize = ((propSizeByte & 0b1110_0000) >> 5) + 1;

      writeVar(resultVar, propSize);
    },
    inc: function(operands) {
      var varName = operands[0];
      var value = toSigned16Bit(readVar(varName));

      writeVar(varName, value + 1);
    },
    dec: function(operands) {
      var varName = operands[0];
      var value = toSigned16Bit(readVar(varName));

      writeVar(varName, value - 1);
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
      var a = toSigned16Bit(operands[0]);
      var b = toSigned16Bit(operands[1]);

      followJumpIf(a < b);
    },
    jg: function(operands) {
      // Jump if a > b (using a signed 16-bit comparison).
      var a = toSigned16Bit(operands[0]);
      var b = toSigned16Bit(operands[1]);

      followJumpIf(a > b);
    },
    print_paddr(operands) {
      var packedAddr = operands[0];
      var addr = packedAddr * 2;
      var s = readString(addr);
      printOutput(s);
    },
    load(operands) {
      var x = readVar(operands[0]);
      var resultVar = readPC();

      writeVar(resultVar, x);
    },
    jz: function(operands) {
      // jump if a == 0.
      var a = operands[0];

      followJumpIf(a == 0);
    },
    sub: function(operands) {
      var a = toSigned16Bit(operands[0]);
      var b = toSigned16Bit(operands[1]);
      var resultVar = readPC();

      // SIGNED 16-bit subtraction, idk.
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
    storeb: function(operands) {
      var arrayAddress = operands[0];
      var elementIndex = operands[1];
      var value = operands[2];
      var elementAddress = arrayAddress + elementIndex;

      dv.setUint8(elementAddress, value, false);
    },
    put_prop: function(operands) {
      var objectId = operands[0];
      var propertyId = operands[1];
      var value = operands[2];

      setPropertyValue(objectId, propertyId, value);
    },
    read: function(operands) {
      // https://www.inform-fiction.org/zmachine/standards/z1point1/sect15.html#read

      // In Versions 1 to 3, the status line is automatically redisplayed first.
      redisplayStatusLine();

      textBufferAddr = operands[0];
      parseBufferAddr = operands[1];

      AWAITING_INPUT = true;

      var s = inputs.shift();
      if (s) {
        setTimeout(() => provideInput(s));
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
        a = a - 0x100;
      }

      printOutput(a.toString());
    },
    random: function(operands) {
      var range = operands[0];
      var resultVar = readPC();

      if (range > 0) {
        var x = Math.floor(range * Math.random()) + 1;
        writeVar(resultVar, x);
      } else {
        console.warn("rand reseeding is not implemented");
      }
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
    print_ret: function(operands) {
      // Print the quoted (literal) Z-encoded string,
      var s = readString(pc, (addr) => pc = addr);
      printOutput(s);
      // then print a new-line
      printOutput("\n");
      // and then return true (i.e., 1).
      // ... is this "return" like "store in var" or "return" like "from the current routine"?
      // zzo says the latter.
      returnWithValue(1);
    },
    ret_popped: function(operands) {
      returnWithValue(readVar(0));
    },
    new_line: function(operands) {
      printOutput("\n");
    },
    print_addr: function(operands) {
      // Print (Z-encoded) string at given byte address, in dynamic or static memory.
      var addr = operands[0];
      var s = readString(addr);
      printOutput(s);
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
      offset = toSigned16Bit(offset);
      pc += (offset - 2);
    }
  };

  function redisplayStatusLine() {
    var s = '';
    var flags = dv.getUint16(0x01, false);
    var statusLineType = flags & 0x01;

    // 8.2.2
    // The short name of the object whose number is in the first global variable should be printed on the left hand side of the line.
    var objectId = readVar(0x10);
    var propAddressPtr = objectAddress(objectId) + 7;
    var propAddr = dv.getUint16(propAddressPtr, false);
    propAddr += 1; // skip short name "length" byte
    s += readString(propAddr);

    var right;
    if (statusLineType == 0) {
      // score
      var score = toSigned16Bit(readVar(0x11));
      var turns = readVar(0x12);
      right = `Score: ${score}  Turns: ${turns}`;
    } else if (statusLineType == 1) {
      // time
      var hours = readVar(0x11);
      var minutes = readVar(0x12);
      right = `${hours}:${minutes.padStart(2, '0')}`
    }

    onStatusLineUpdated(s, right);
  }

  function readPC() {
    // We will always return unsigned values, because it's simple.
    // It is the responsibility of each opcode handler to decide if it needs to
    // interpret this value as signed, e.g. to do arithmetic or comparison.
    var out = dv.getUint8(pc, false);
    pc += 1;
    return out;
  }

  function readPC16() {
    // We will always return unsigned values, because it's simple.
    // It is the responsibility of each opcode handler to decide if it needs to
    // interpret this value as signed, e.g. to do arithmetic or comparison.
    var out = dv.getUint16(pc, false);
    pc += 2;
    return out;
  }

  function readOperandsShort(firstByte) {
    var operandType = (firstByte & 0b0011_0000) >> 4;
    var operands;

    switch (operandType) {
      case 0b11: // none; 0OP
        operands = [];
        break;
      default: // 1OP
        operands = [readNextOperand(operandType)];
    }

    logOperands([operandType], operands);

    return operands;
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

    logOperands(operandTypes, operands)

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

    logOperands(operandTypes, operands);

    return operands;
  }

  function logOperands(operandTypes, operands) {
    log("  operand types: " + operandTypes.join(", "));
    log("  operands: " + operands.map((o) => '0x' + o.toString(16)).join(", "));
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
    log(`readVar ${n}`)

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
    log(`writeVar ${n}, ${x}`)

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

  function getPropertyValue(objectId, propertyId) {
    // Read property from object (resulting in the default value if it had no such declared property).
    // It is illegal for the opcode to be used if the property has length greater than 2, and the result is unspecified.
    var propValue;
    var propAddr = propertyAddress(objectId, propertyId);

    if (propAddr == 0) {
      // end of object's property list; take the default:
      propValue = defaultPropertyValue(propertyId);
    } else {
      // we found it
      // If the property has length 1, the value is only that byte. If it has length 2, the first two bytes of the property are taken as a word value.
      // It is illegal for the opcode to be used if the property has length greater than 2, and the result is unspecified.
      var propSizeByte = dv.getUint8(propAddr, false);
      var propSize = ((propSizeByte & 0b1110_0000) >> 5) + 1;

      if (propSize == 1) {
        propValue = dv.getUint8(propAddr + 1, false);
      } else if (propSize == 2) {
        propValue = dv.getUint16(propAddr + 1, false);
      } else {
        throw `unsupported property value size: ${propSize}`;
      }
    }

    return propValue;
  }

  function setPropertyValue(objectId, propertyId, value) {
    var propAddr = propertyAddress(objectId, propertyId);

    if (propAddr == 0) {
      throw `object ${objectId} does not have property ${propertyId}`;
    }

    var propSizeByte = dv.getUint8(propAddr, false);
    var propSize = ((propSizeByte & 0b1110_0000) >> 5) + 1;

    if (propSize == 1) {
      // "If the property length is 1, then the interpreter should store only the least significant byte of the value."
      dv.setUint8(propAddr + 1, value & 0xff, false);
    } else if (propSize == 2) {
      dv.setUint16(propAddr + 1, value, false);
    } else {
      // "As with get_prop the property length must not be more than 2: if it is, the behaviour of the opcode is undefined."
      throw `unsupported property value size: ${propSize}`;
    }
  }

  function propertyAddress(objectId, propertyId) {
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
        return propAddr;
      }

      if (currentPropertyId == 0) {
        // object has no such property
        return 0;
      }

      propAddr += (1 + currentPropertySize);
    }
  }

  function objectAddress(objectId) {
    // TODO validate objectId in range
    // remember, objects start from 1, not 0
    return objectTableAddress()
      + 31 * 2             // skip past property defaults table
      + (objectId - 1) * 9; // skip to the right object
  }

  function defaultPropertyValue(propertyId) {
    if (propertyId > 31) {
      throw "cannot get default value for property " + propertyId;
    }
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
        // offset = -offset + 1;
        offset -= 0b0100_0000_0000_0000;
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

  function toSigned16Bit(n) {
    if (n & 0x8000) {
      // debugger;
      n = n - 0x1_0000;
    }

    return n;
  }

}

if (typeof module != 'undefined') {
  module.exports = Z;
}
