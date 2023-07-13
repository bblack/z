log("Ready.");

window.addEventListener('unhandledrejection', (e) => log(event.reason, 'red'));

var inputs =
[
  'open mailbox',
  'read leaflet',
  'e',
  'n',
  'e',
  'open',
  'open window',
  'enter',
  'take bottle',
  'w',
  'take lantern',
  'e',
  'w',
  'take sword',
  'eat'
];



// TODO: pry the z-machine apart from the html/dom stuff
var input = document.querySelector("input#file");

function focusInput() {
  document.querySelector("#stdin").focus();
}

window.addEventListener('focus', () => focusInput());
document.querySelector('#stdout').addEventListener('click', () => focusInput());

input.addEventListener("change", function() {
  var file = this.files[0];
  log(`received file ${file.name} of size ${file.size} bytes`);

  focusInput();

  file.arrayBuffer().then((ab) => {
    loadGame(ab);
  });
});

// document.querySelector("#stdin").addEventListener('change', function(event) {
document.querySelector("#stdin").addEventListener('keypress', function(event) {
  if (event.charCode != 13) return; // "Enter"

  // A sequence of characters is read in from the current input stream until a carriage return (or, in Versions 5 and later, any terminating character) is found.
  var inputEl = event.currentTarget;
  var s = inputEl.textContent;
  inputEl.textContent = '';

  provideInput(s);

  // default would add \n to textContent
  event.preventDefault();
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

// -- Below here: stuff that's NOT part of the z-machine --

function printOutput(s) {
  var outputEl = document.querySelector('#stdout');
  var inputEl = document.querySelector('#stdin');
  var span = document.createElement('span');

  span.textContent = s;
  outputEl.insertBefore(span, inputEl);
  // outputEl.scrollTo(outputEl.scrollHeight);
  span.scrollIntoView({block: 'start', behavior: 'smooth'})
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

function toSigned16Bit(n) {
  if (n & 0x8000) {
    // debugger;
    n = n - 0x1_0000;
  }

  return n;
}
