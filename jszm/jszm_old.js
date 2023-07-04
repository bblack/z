/*
  JSZM - JavaScript implementation of Z-machine
  This program is in public domain.

  Construct by:  new JSZM(x)
    where x is the buffer or typed array to load

  Now define functions of the object:

  - highlight: Called when change between fix/variable pitch text. The
    argument is true for fix pitch and false for variable pitch. It is
    legal to use fix pitch all the time if necessary.

  - isTandy: A boolean variable, false by default. If set to true, tells
    the game that it is running on a Tandy computer, which causes some
    parts of some games to become censored.

  - print: Called when text must be displayed. First argument is the text
    and second argument is true if scripting or false otherwise. If it
    returns true then the generator is paused; can be use in case it needs
    to pause the screen before continuing to display more text.

  - restarted: Called when restarted game.

  - restore: No argument. It should return a copy of the Uint8Array given
    to the save method for the corresponding save file, or null if the
    restore failed.

  - save: Given a Uint8Array, it should save the file and return true. If
    it cannot save, it returns false.

  - screen: Optional. If defined, takes one argument and implement the
    SCREEN instruction of Z-machine.

  - split: Optional. If defined, takes one argument and implements the
    SPLIT instruction of Z-machine.

  - updateStatusLine: Optional. Takes three arguments, being the location
    title, the second is hours or score, the third is minutes or moves.
    The property called statusType will be true if it should be displayed
    as a time, or false otherwise.

  Lastly call the run function, which returns a Generator object.

  There are also properties and methods you might read:

  - run: Call to execute the program.

  - serial: The serial number, as a string.

  - statusType: True for hours/minutes, false for score/moves.

  - zorkid: The ZORKID of the story file; this is what is usually printed
    as the "release number" of the game.
*/

"use strict";

const JSZM_Version={major:1,minor:0,subminor:0,timestamp:1454204531315};

const JSZM_Error={};
const JSZM_MorePrompt={};
const JSZM_RestorePrompt={};
const JSZM_SavePrompt={};
const JSZM_Terminated={};

function JSZM(arr) {
  var mem;
  mem=this.memInit=new Uint8Array(arr);
  if(mem[0]!=3) throw new Error("Unsupported Z-code version.");
  this.byteSwapped=!!(mem[1]&1);
  this.statusType=!!(mem[1]&2);
  this.serial=String.fromCharCode(...mem.slice(18,24));
  this.zorkid=(mem[2]<<(this.byteSwapped?0:8))|(mem[3]<<(this.byteSwapped?8:0));
}

JSZM.prototype={
  byteSwapped: false,
  constructor: JSZM,
  deserialize: function(ar) {
    var e,i,j,ds,cs,pc,vi,purbot;
    var g8,g16s,g16,g24,g32;
    g8=()=>ar[e++];
    g16s=()=>(e+=2,vi.getInt16(e-2));
    g16=()=>(e+=2,vi.getUint16(e-2));
    g24=()=>(e+=3,vi.getUint32(e-4)&0xFFFFFF);
    g32=()=>(e+=4,vi.getUint32(e-4));
    try {
      e=purbot=this.getu(14);
      vi=new DataView(ar.buffer);
      if(ar[2]!=this.mem[2] || ar[3]!=this.mem[3]) return null; // ZORKID does not match
      pc=g32();
      cs=new Array(g16());
      ds=Array.from({length:g16()},g16s);
      for(i=0;i<cs.length;i++) {
        cs[i]={};
        cs[i].local=new Int16Array(g8());
        cs[i].pc=g24();
        cs[i].ds=Array.from({length:g16()},g16s);
        cs[i].local.set(new Int16Array(ar.buffer,e,cs[i].local.length));
        e+=cs[i].local.length*2;
      }
      this.mem.set(new Uint8Array(ar.buffer,0,purbot));
      return [ds,cs,pc];
    } catch(e) {
      return null;
    }
  },
  endText: 0,
  fwords: null,
  genPrint: function*(text) {
    var x=this.get(16);
    if(x!=this.savedFlags) {
      this.savedFlags=x;
      this.highlight(!!(x&2));
    }
    while(this.print(text,!!(x&1)) && (text=yield JSZM_MorePrompt));
  },
  get: function(x) { return this.view.getInt16(x,this.byteSwapped); },
  getText: function(addr) {
    var d; // function to parse each Z-character
    var o=""; // output
    var ps=0; // permanent shift
    var ts=0; // temporary shift
    var w; // read each 16-bits data
    var y; // auxiliary data for parsing state
    d=v => {
      if(ts==3) {
        y=v<<5;
        ts=4;
      } else if(ts==4) {
        y+=v;
        if(y==13) o+="\n";
        else if(y) o+=String.fromCharCode(y);
        ts=ps;
      } else if(ts==5) {
        o+=this.getText(this.getu(this.fwords+(y+v)*2)*2);
        ts=ps;
      } else if(v==0) {
        o+=" ";
      } else if(v<4) {
        ts=5;
        y=(v-1)*32;
      } else if(v<6) {
        if(!ts) ts=v-3;
        else if(ts==v-3) ps=ts;
        else ps=ts=0;
      } else if(v==6 && ts==2) {
        ts=3;
      } else {
        o+="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ*\n0123456789.,!?_#'\"/\\-:()"[ts*26+v-6];
        ts=ps;
      }
    };
    for(;;) {
      w=this.getu(addr);
      addr+=2;
      d((w>>10)&31);
      d((w>>5)&31);
      d(w&31);
      if(w&32768) break;
    }
    this.endText=addr;
    return o;
  },
  getu: function(x) { return this.view.getUint16(x,this.byteSwapped); },
  handleInput: function(str,t1,t2) {
    var i,br,w;
    // Put text
    str=str.toLowerCase().slice(0,this.mem[t1]-1);
    for(i=0;i<str.length;i++) this.mem[t1+i+1]=str.charCodeAt(i);
    this.mem[t1+str.length+1]=0;
    // Lex text
    w=x=>(i=0,x.split("").filter(y => (i+=/[a-z]/.test(y)?1:/[0-9.,!?_#'"\/\\:\-()]/.test(y)?2:4)<7).join(""));
    br=JSON.parse("["+str.replace(this.regBreak,(m,o)=>",["+(m.length)+","+(this.vocabulary.get(w(m))||0)+","+(o+1)+"]").slice(1)+"]");
    i=this.mem[t2+1]=br.length;
    while(i--) {
      this.putu(t2+i*4+2,br[i][1]);
      this.mem[t2+i*4+4]=br[i][0];
      this.mem[t2+i*4+5]=br[i][2];
    }
  },
  highlight: fixed => false,
  isTandy: false,
  mem: null,
  memInit: null,
  parseVocab: function(s) {
    var e;
    var n;
    n=this.mem[s++];
    e=this.selfInsertingBreaks=String.fromCharCode(...this.mem.slice(s,s+n));
    e=e.split("").map(x=>(x.toUpperCase()==x.toLowerCase()?"":"\\")+x).join("")+"]";
    this.regBreak=new RegExp("["+e+"|[^ \\n\\t"+e+"+","g");
    s+=n;
    e=this.mem[s++];
    n=this.get(s);
    s+=2;
    this.vocabulary=new Map();
    while(n--) {
      this.vocabulary.set(this.getText(s),s);
      s+=e;
    }
    return s;
  },
  print: (text,scripted) => false,
  put: function(x,y) { return this.view.setInt16(x,y,this.byteSwapped); },
  putu: function(x,y) { return this.view.setUint16(x,y&65535,this.byteSwapped); },
  regBreak: null,
  restarted: () => true,
  restore: () => null,
  run: function*() {
    var mem,pc,cs,ds,op0,op1,op2,op3,opc,inst,x,y,z;
    var globals,objects,fwords,defprop;
    var addr,fetch,flagset,init,move,opfetch,pcfetch,pcget,pcgetb,pcgetu,predicate,propfind,ret,store,usl,xfetch,xstore;

    // Functions
    addr=(x) => (x&65535)<<1;
    fetch=(x) => {
      if(x==0) return ds.pop();
      if(x<16) return cs[0].local[x-1];
      return this.get(globals+2*x);
    };
    flagset=() => {
      op3=1<<(15&~op1);
      op2=objects+op0*9+(op1&16?2:0);
      opc=this.get(op2);
    };
    init=() => {
      mem=this.mem=new Uint8Array(this.memInit);
      this.view=new DataView(mem.buffer);
      mem[1]&=3;
      if(this.isTandy) mem[1]|=8;
      if(!this.updateStatusLine) mem[1]|=16;
      if(this.screen && this.split) mem[1]|=32;
      this.put(16,this.savedFlags);
      if(!this.vocabulary) this.parseVocab(this.getu(8));
      defprop=this.getu(10)-2;
      globals=this.getu(12)-32;
      this.fwords=fwords=this.getu(24);
      cs=[];
      ds=[];
      pc=this.getu(6);
      objects=defprop+55;
      this.restarted();
    };
    move=(x,y) => {
      var w,z;
      // Remove from old FIRST-NEXT chain
      if(z=mem[objects+x*9+4]) {
        if(mem[objects+z*9+6]==x) { // is x.loc.first=x?
          mem[objects+z*9+6]=mem[objects+x*9+5]; // x.loc.first=x.next
        } else {
          z=mem[objects+z*9+6]; // z=x.loc.first
          while(z!=x) {
            w=z;
            z=mem[objects+z*9+5]; // z=z.next
          }
          mem[objects+w*9+5]=mem[objects+x*9+5]; // w.next=x.next
        }
      }
      // Insert at beginning of new FIRST-NEXT chain
      if(mem[objects+x*9+4]=y) { // x.loc=y
        mem[objects+x*9+5]=mem[objects+y*9+6]; // x.next=y.first
        mem[objects+y*9+6]=x; // y.first=x
      } else {
        this.put(objects+x*9+5,0); // x.first=x.next=0
      }
    };
    opfetch=(x,y) => {
      if((x&=3)==3) return;
      opc=y;
      return [pcget,pcgetb,pcfetch][x]();
    };
    pcfetch=(x) => fetch(mem[pc++]);
    pcget=() => {
      pc+=2;
      return this.get(pc-2);
    };
    pcgetb=() => mem[pc++];
    pcgetu=() => {
      pc+=2;
      return this.getu(pc-2);
    };
    predicate=(p) => {
      var x=pcgetb();
      if(x&128) p=!p;
      if(x&64) x&=63; else x=((x&63)<<8)|pcgetb();
      if(p) return;
      if(x==0 || x==1) return ret(x);
      if(x&0x2000) x-=0x4000;
      pc+=x-2;
    };
    propfind=() => {
      var z=this.getu(objects+op0*9+7);
      z+=mem[z]*2+1;
      while(mem[z]) {
        if((mem[z]&31)==op1) {
          op3=z+1;
          return true;
        } else {
          z+=(mem[z]>>5)+2;
        }
      }
      op3=0;
      return false;
    };
    ret=(x) => {
      ds=cs[0].ds;
      pc=cs[0].pc;
      cs.shift();
      store(x);
    };
    store=(y) => {
      var x=pcgetb();
      if(x==0) ds.push(y);
      else if(x<16) cs[0].local[x-1]=y;
      else this.put(globals+2*x,y);
    };
    usl=() => {
      if(this.updateStatusLine) this.updateStatusLine(this.getText(this.getu(objects+xfetch(16)*9+7)+1),xfetch(18),xfetch(17));
    };
    xfetch=(x) => {
      if(x==0) return ds[ds.length-1];
      if(x<16) return cs[0].local[x-1];
      return this.get(globals+2*x);
    };
    xstore=(x,y) => {
      if(x==0) ds[ds.length-1]=y;
      else if(x<16) cs[0].local[x-1]=y;
      else this.put(globals+2*x,y);
    };

    // Initializations
    init();
    this.highlight(!!(this.savedFlags&2));

    // Main loop
    main: for(;;) {
      inst=pcgetb();
      if(inst<128) {
        // 2OP
        if(inst&64) op0=pcfetch(); else op0=pcgetb();
        if(inst&32) op1=pcfetch(); else op1=pcgetb();
        inst&=31;
        opc=2;
      } else if(inst<176) {
        // 1OP
        x=(inst>>4)&3;
        inst&=143;
        if(x==0) op0=pcget();
        else if(x==1) op0=pcgetb();
        else if(x==2) op0=pcfetch();
      } else if(inst>=192) {
        // EXT
        x=pcgetb();
        op0=opfetch(x>>6,1);
        op1=opfetch(x>>4,2);
        op2=opfetch(x>>2,3);
        op3=opfetch(x>>0,4);
        if(inst<224) inst&=31;
      }
      switch(inst) {
        case 1: // EQUAL?
          predicate(op0==op1 || (opc>2 && op0==op2) || (opc==4 && op0==op3));
          break;
        case 2: // LESS?
          predicate(op0<op1);
          break;
        case 3: // GRTR?
          predicate(op0>op1);
          break;
        case 4: // DLESS?
          xstore(op0,x=xfetch(op0)-1);
          predicate(x<op1);
          break;
        case 5: // IGRTR?
          xstore(op0,x=xfetch(op0)+1);
          predicate(x>op1);
          break;
        case 6: // IN?
          predicate(mem[objects+op0*9+4]==op1);
          break;
        case 7: // BTST
          predicate((op0&op1)==op1);
          break;
        case 8: // BOR
          store(op0|op1);
          break;
        case 9: // BAND
          store(op0&op1);
          break;
        case 10: // FSET?
          flagset();
          predicate(opc&op3);
          break;
        case 11: // FSET
          flagset();
          this.put(op2,opc|op3);
          break;
        case 12: // FCLEAR
          flagset();
          this.put(op2,opc&~op3);
          break;
        case 13: // SET
          xstore(op0,op1);
          break;
        case 14: // MOVE
          move(op0,op1);
          break;
        case 15: // GET
          store(this.get((op0+op1*2)&65535));
          break;
        case 16: // GETB
          store(mem[(op0+op1)&65535]);
          break;
        case 17: // GETP
          if(propfind()) store(mem[op3-1]&32?this.get(op3):mem[op3]);
          else store(this.get(defprop+2*op1));
          break;
        case 18: // GETPT
          propfind();
          store(op3);
          break;
        case 19: // NEXTP
          if(op1) {
            // Return next property
            propfind();
            store(mem[op3+(mem[op3-1]>>5)+1]&31);
          } else {
            // Return first property
            x=this.getu(objects+op0*9+7);
            store(mem[x+mem[x]*2+1]&31);
          }
          break;
        case 20: // ADD
          store(op0+op1);
          break;
        case 21: // SUB
          store(op0-op1);
          break;
        case 22: // MUL
          store(Math.imul(op0,op1));
          break;
        case 23: // DIV
          store(Math.trunc(op0/op1));
          break;
        case 24: // MOD
          store(op0%op1);
          break;
        case 128: // ZERO?
          predicate(!op0);
          break;
        case 129: // NEXT?
          store(x=mem[objects+op0*9+5]);
          predicate(x);
          break;
        case 130: // FIRST?
          store(x=mem[objects+op0*9+6]);
          predicate(x);
          break;
        case 131: // LOC
          store(mem[objects+op0*9+4]);
          break;
        case 132: // PTSIZE
          store((mem[(op0-1)&65535]>>5)+1);
          break;
        case 133: // INC
          x=xfetch(op0);
          xstore(op0,x+1);
          break;
        case 134: // DEC
          x=xfetch(op0);
          xstore(op0,x-1);
          break;
        case 135: // PRINTB
          yield*this.genPrint(this.getText(op0&65535));
          break;
        case 137: // REMOVE
          move(op0,0);
          break;
        case 138: // PRINTD
          yield*this.genPrint(this.getText(this.getu(objects+op0*9+7)+1));
          break;
        case 139: // RETURN
          ret(op0);
          break;
        case 140: // JUMP
          pc+=op0-2;
          break;
        case 141: // PRINT
          yield*this.genPrint(this.getText(addr(op0)));
          break;
        case 142: // VALUE
          store(xfetch(op0));
          break;
        case 143: // BCOM
          store(~op0);
          break;
        case 176: // RTRUE
          ret(1);
          break;
        case 177: // RFALSE
          ret(0);
          break;
        case 178: // PRINTI
          yield*this.genPrint(this.getText(pc));
          pc=this.endText;
          break;
        case 179: // PRINTR
          yield*this.genPrint(this.getText(pc)+"\n");
          ret(1);
          break;
        case 180: // NOOP
          break;
        case 181: // SAVE
          this.savedFlags=this.get(16);
          yield JSZM_SavePrompt;
          predicate(this.save(this.serialize(ds,cs,pc)));
          break;
        case 182: // RESTORE
          this.savedFlags=this.get(16);
          yield JSZM_RestorePrompt;
          if(z=this.restore()) z=this.deserialize(z);
          this.put(16,this.savedFlags);
          if(z) ds=z[0],cs=z[1],pc=z[2];
          predicate(z);
          break;
        case 183: // RESTART
          init();
          break;
        case 184: // RSTACK
          ret(ds[ds.length-1]);
          break;
        case 185: // FSTACK
          ds.pop();
          break;
        case 186: // QUIT
          return JSZM_Terminated;
        case 187: // CRLF
          yield*this.genPrint("\n");
          break;
        case 188: // USL
          usl();
          break;
        case 189: // VERIFY
          predicate(this.verify());
          break;
        case 224: // CALL
          if(op0) {
            x=mem[op0=addr(op0)];
            cs.unshift({ds:ds,pc:pc,local:new Int16Array(x)});
            ds=[];
            pc=op0+1;
            for(x=0;x<mem[op0];x++) cs[0].local[x]=pcget();
            if(opc>1 && mem[op0]>0) cs[0].local[0]=op1;
            if(opc>2 && mem[op0]>1) cs[0].local[1]=op2;
            if(opc>3 && mem[op0]>2) cs[0].local[2]=op3;
          } else {
            store(0);
          }
          break;
        case 225: // PUT
          this.put((op0+op1*2)&65535,op2);
          break;
        case 226: // PUTB
          mem[(op0+op1)&65535]=op2;
          break;
        case 227: // PUTP
          propfind();
          if(mem[op3-1]&32) this.put(op3,op2);
          else mem[op3]=op2;
          break;
        case 228: // READ
          yield*this.genPrint("");
          usl();
          this.handleInput((yield mem[op0&65535]),op0&65535,op1&65535);
          break;
        case 229: // PRINTC
          yield*this.genPrint(op0==13?"\n":op0?String.fromCharCode(op0):0);
          break;
        case 230: // PRINTN
          yield*this.genPrint(String(op0));
          break;
        case 231: // RANDOM
          store(op0>0?Math.floor(Math.random()*op0)+1:0);
          break;
        case 232: // PUSH
          ds.push(op0);
          break;
        case 233: // POP
          xstore(op0,ds.pop());
          break;
        case 234: // SPLIT
          if(this.split) this.split(op0);
          break;
        case 235: // SCREEN
          if(this.screen) this.screen(op0);
          break;
        default:
          return JSZM_Error;
      }
    }

  },
  save: memory => false,
  savedFlags: 0,
  selfInsertingBreaks: null,
  serial: null,
  serialize: function(ds,cs,pc) {
    var i,j,e,ar,vi;
    e=this.getu(14); // PURBOT
    i=e+cs.reduce((p,c)=>p+2*(c.ds.length+c.local.length)+6,0)+2*ds.length+8;
    ar=new Uint8Array(i);
    ar.set(this.mem);
    vi=new DataView(ar.buffer);
    vi.setUint32(e,pc);
    vi.setUint16(e+4,cs.length);
    vi.setUint16(e+6,ds.length);
    for(i=0;i<ds.length;i++) vi.setInt16(e+i*2+8,ds[i]);
    e+=ds.length*2+8;
    for(i=0;i<cs.length;i++) {
      vi.setUint32(e,cs[i].pc);
      vi.setUint8(e,cs[i].local.length);
      vi.setUint16(e+4,cs[i].ds.length);
      for(j=0;j<cs[i].ds.length;i++) vi.setInt16(e+j*2+6,cs[i].ds[j]);
      for(j=0;j<cs[i].local.length;i++) vi.setInt16(e+cs[i].ds.length*2+j*2+6,cs[i].local[j]);
      e+=(cs[i].ds.length+cs[i].local.length)*2+6;
    }
    return ar;
  },
  screen: null,
  split: null,
  statusType: null,
  updateStatusLine: null,
  verify: function() {
    var plenth=this.getu(26);
    var pchksm=this.getu(28);
    var i=64;
    while(i<plenth*2) pchksm=(pchksm-this.memInit[i++])&65535;
    return !pchksm;
  },
  view: null,
  vocabulary: null,
  zorkid: null,
};
