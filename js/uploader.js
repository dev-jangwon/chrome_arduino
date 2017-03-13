var SerialDispatcher = require("./serialdispatcher.js").SerialDispatcher;
var ParseHexFile = require("./hexparser.js").ParseHexFile;
var logging = require("./logging.js");
var stk500 = require("./stk500.js");
var binary = require("./binary.js");

var hexToBin = binary.hexToBin;
var binToHex = binary.binToHex;
var log = logging.log;
var kDebugError = logging.kDebugError;
var kDebugNormal = logging.kDebugNormal;
var kDebugFine = logging.kDebugFine;
var kDebugVeryFine = logging.kDebugVeryFine;

var databuffer = {};

var globalDispatcher = new SerialDispatcher(); // global serial dispatcher for chrome serial onreceive listener

if (typeof(chrome) != "undefined" && typeof(chrome.serial) != "undefined") {
  log(kDebugNormal, "Initting global dispatcher");
  chrome.serial.onReceive.addListener(globalDispatcher.dispatch.bind(globalDispatcher));

  chrome.serial.onReceiveError.addListener(function(errorInfo) {
    console.log("ERROR: " + JSON.stringify(errorInfo));
  });

  chrome.serial.onReceive.addListener(function(errorInfo) {
    if(errorInfo.data.length > 0){
      console.log("READ: " + JSON.stringify(errorInfo));
    }
  });
};

function readToBuffer(readArg) {
  log(kDebugFine, "READ TO BUFFER:" + JSON.stringify(readArg));
  if (typeof(databuffer[readArg.connectionId]) == "undefined") {
    log(kDebugFine, "Constructed buffer for: " + readArg.connectionId);
    databuffer[readArg.connectionId] = [];
  }

  var hexData = binToHex(readArg.data);

  log(kDebugFine, "Pushing " + hexData.length + " bytes onto buffer for: " + readArg.connectionId + " " + hexData);
  for (var i = 0; i < hexData.length; ++i) {
    databuffer[readArg.connectionId].push(hexData[i]);
  }
  log(kDebugFine, "Buffer for " + readArg.connectionId + " now of size " + databuffer[readArg.connectionId].length);
}

function readFromBuffer(connectionId, maxBytes, callback) {
  if (typeof(databuffer[connectionId]) == "undefined") {
    log(kDebugFine, "No buffer for: " + connectionId);
    callback({bytesRead: 0, data: []});
    return;
  }

  var bytes = Math.min(maxBytes, databuffer[connectionId].length);
  log(kDebugFine, "Reading " + bytes + " from buffer for " + connectionId);

  var accum = [];
  for (var i = 0; i < bytes; ++i) {
    accum.push(databuffer[connectionId].shift());
  }

  log(kDebugFine, "readFromBuffer -> " + binToHex(accum));

  callback({bytesRead: bytes, data: accum});
}

function uploadSketch(port, deviceName, protocol, hex, board_type) { // upload arduino
  fetchProgram(hex, function(programBytes) {
     log(kDebugFine, "Fetched program. Uploading to: " + deviceName);
     log(kDebugFine, "Protocol: " + protocol);
     uploadCompiledSketch(port, programBytes, deviceName, protocol, board_type);
  });
};

function fetchProgram(hex, handler) {
  var programBytes = ParseHexFile(hex);
  console.log('programBytes', programBytes);
  handler(programBytes);
}

function pad(data, pageSize) { // add padding
  while (data.length % pageSize != 0) {
    data.push(0);
  }
  return data;
}

function uploadCompiledSketch(port, hexData, deviceName, protocol, board_type) {
  if (protocol == "stk500") { // arduino upload
    var boardObj = stk500.NewStk500Board(chrome.serial, 128); // init STK500 Board
    if (!boardObj.status.ok()) {
      log(kDebugError, "Couldn't create STK500 Board: " + boardObj.status.toString());
      port.postMessage({
        op: 'upload',
        msg: "Couldn't create STK500 Board: " + boardObj.status.toString()
      });
      return;
    }
    var board = boardObj.board;

    board.connect(deviceName, board_type, function(status) { // upload after connect(after receiving ACK)
      if (status.ok()) {
        log(kDebugNormal, "STK500: connected.");
        port.postMessage({
          op: 'upload',
          msg: "STK500: connected."
        });
        board.writeFlash(0, pad(hexData, 128), function(status) { // writeFlash
          log(kDebugNormal, "STK programming status: " + status.toString());
          port.postMessage({
            op: 'upload',
            msg: "STK programming status: " + status.toString()
          });
        });
      } else {
        log(kDebugNormal, "STK: connection error: " + status.toString());
        port.postMessage({
          op: 'upload',
          msg: "STK: connection error: " + status.toString()
        });
      }
    });
  } else if (protocol == "tcc3730") { // TCC3730 board -> direct upload from background.js
  } else {
    log(kDebugError, "Unknown protocol: "  + protocol);
    port.postMessage({
      op: 'upload',
      msg: "Unknown protocol: "  + protocol
    });
  }
}

exports.pad = pad;
exports.uploadSketch = uploadSketch;
