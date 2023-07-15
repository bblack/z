const assert = require('assert');
const fs = require('fs/promises');
const sinon = require('sinon');
const Z = require('../z');

describe('Z', () => {
  context('when running zork', () => {
    it('produces the first few lines of output upon load', () => {
      var collectedOutput = '';

      return fs.readFile('test/zork1.z5')
        .then((buf) => {
          var ab = buf.buffer;
          var z = new Z({
            onLog: () => {},
            onOutput: (s) => collectedOutput += s
          });

          z.loadGame(ab);

          // TODO: do this the right way instead of waiting 1 sec
          return new Promise((resolve) => { setTimeout(resolve, 1_000); });
        })
        .then(() => {
          assert.equal(collectedOutput,
            "ZORK I: The Great Underground Empire\n" +
            "Copyright (c) 1981, 1982, 1983 Infocom, Inc. All rights reserved.\n" +
            "ZORK is a registered trademark of Infocom, Inc.\n" +
            "Revision 88 / Serial number 840726\n" +
            "\n" +
            "West of House\n" +
            "You are standing in an open field west of a white house, with a boarded front door.\n" +
            "There is a small mailbox here.\n" +
            "\n" +
            ">"
          )
        })
    })
  })
})
