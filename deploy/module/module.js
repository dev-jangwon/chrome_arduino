(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
chrome.app.runtime.onLaunched.addListener(function() { // application started
  chrome.app.window.create('index.html', { // create index page for app
    'width': 500,
    'height': 400
  });
});

var uploader = require("./uploader.js");
var binary = require("./binary.js");

var kBitrate = 9600; // global kBitrate for arduino uno
var kUnconnected = -1;
var connectionId_ = kUnconnected; // initial connect id
var DOMBuffer, DOMBufferInterval, ClearInterval; // serial write buffer

var flushCounter;

var stringToBinary = binary.stringToBinary;
var binaryToString = binary.binaryToString;

chrome.runtime.onConnectExternal.addListener(function(port) { // chrome app listener from browser
  port.postMessage({ // ACK to browser
    op:'connect',
    msg: "connect complete"
  });

  port.onMessage.addListener(function(msg) { // msg handler
    if (msg) {
      if (msg.op === 'device') {
        detectDevices(port);
      } else if (msg.op === 'serial_connect') {
        if (msg.device) { // device: uno, nano, tcc_3730...
          connectToSelectedSerialPort(port, msg.selectedPort, msg.device);
        } else { // old version
          connectToSelectedSerialPort(port, msg.selectedPort);
        }
      } else if (msg.op === 'disconnect') {
        disconnect(port);
      } else if (msg.op === 'send_data') {
        sendDataToDevice(port, msg.data);
      } else if (msg.op === 'upload') {
        if (!msg.board_type) { // no board_type: old version
          msg.board_type = 'uno';
        }

        beginUpload(port, msg.selectedPort, msg.hex, msg.board_type, msg._protocol, msg._size);
      }
    } else {
      console.log("no msg from client");
      return;
    }
  });
});

function detectDevices(port) {
  var detected_obj = {};
  chrome.serial.getDevices(function(devices) { // get serial device list
    for (var i = 0; i < devices.length; ++i) {
      detected_obj[i] = devices[i].path;
    }
    port.postMessage({ // return device list to browser
      op: 'device',
      msg: detected_obj
    });
  });
};

function connectToSelectedSerialPort(port, selectedPort, device) {
  if (device && device === 'tcc3730') {
    kBitrate = 115200;
  } // need to implement deciding kBitrate from client. temporary method

  chrome.serial.connect(selectedPort, { // connect to port with bitrate
    bitrate: kBitrate
  }, function(connectArg) {
    console.log("ON CONNECT:" + JSON.stringify(connectArg));
    if (!connectArg || connectArg.connectionId == -1) {
      console.log("Error. Could not connect.");
      port.postMessage({
        op: 'serial_connect',
        msg: 'Error. Could not connect.'
      });
      return;
    }

    connectionId_ = connectArg.connectionId; // set global connectionid when connected

    console.log("CONNECTION ID: " + connectionId_);
    port.postMessage({
      op: 'serial_connect',
      msg: "CONNECTION ID: " + connectionId_
    });

    setTimeout(function() {
      console.log("TCC3730::TwiddlingControlLines");
      chrome.serial.setControlSignals(connectionId_, {dtr: false, rts: false}, function(ok) {
        if (!ok) {
          console.log("Couldn't set dtr/rts low!!!!");
          return;
        } else {
            console.log("TCC3730::DTR is false");
        }
        setTimeout(function() {
          chrome.serial.setControlSignals(connectionId_, {dtr: true, rts: true}, function(ok) {
            if (!ok) {
              console.log("Couldn't set dtr/rts high!!!!");
              return;
            } else {
                console.log("TCC3730::DTR is true");
                setTimeout(function() {
                  chrome.serial.onReceive.addListener(readHandler); // register read handler
                  flushCounter = 0;

                  // Set timeout to rad DOM Buffer and add to DOM
                  DOMBufferInterval = setInterval(function() {
                    console.log('writing buffer', DOMBuffer);
                    port.postMessage({
                      op: 'serial_connect',
                      msg: DOMBuffer
                    });
                    DOMBuffer = '';
                  }, 500);

                  ClearInterval = setInterval(function() {
                    chrome.serial.flush(connectionId_, onFlush);
                    console.log('clearing serial');
                  }, 10000);
                }, 250);
            }
          });
        }, 250);
      });
    }, 2000);
  });
};

function readHandler(readArg) {
  console.log("ON READ:" + binaryToString(readArg.data));
  var str = binaryToString(readArg.data);

  str = str.replace("\n", "<br/>"); // format for output
  DOMBuffer += str; // add to buffer
  flushCounter++;

  if (flushCounter >= 100) { // flush buffer every 100 lines received
    chrome.serial.flush(connectionId_, onFlush);
    flushCounter = 0;
  }
};

function onFlush(result) {
  console.log("I flushed!", result);
};

function disconnect(port) { // serial disconnect
  if (connectionId_ == kUnconnected) {
    console.log("Can't disconnect: Already disconnected!");
    port.postMessage({
      op: 'disconnect',
      msg: "Can't disconnect: Already disconnected!"
    });
    return;
  }

  chrome.serial.disconnect(connectionId_, function(disconnectArg) {
    connectionId_ = kUnconnected;

    console.log("disconnectArg: " + JSON.stringify(disconnectArg));
    port.postMessage({
      op: 'disconnect',
      msg: "disconnectArg: " + JSON.stringify(disconnectArg)
    });

    chrome.serial.onReceive.removeListener(readHandler); // clear handlers
    flushCounter = 0;
    clearInterval(DOMBufferInterval);
    clearInterval(ClearInterval);
  });
};

function sendDataToDevice(port, data, callback) { // direct send message to serial
  if (connectionId_ == kUnconnected) {
    console.log("ERROR: Not connected");
    port.postMessage({
      op: 'send_data',
      msg: "ERROR: Not connected"
    });
  } else {
    doSend(port, data);
  }
};

function doSend(port, data) {
  console.log("SENDING " + data + " ON CONNECTION: " + connectionId_);
  port.postMessage({
    op: 'send_data',
    msg: "SENDING " + data + " ON CONNECTION: " + connectionId_
  });

  chrome.serial.send(connectionId_, stringToBinary(data), function(sendArg) {
    console.log("ON SEND:" + JSON.stringify(sendArg));
    port.postMessage({
      op: 'send_data',
      msg: "ON SEND:" + JSON.stringify(sendArg)
    });

    console.log("SENT " + sendArg.bytesSent + " BYTES ON CONN: " + connectionId_);
    port.postMessage({
      op: 'send_data',
      msg: "SENT " + sendArg.bytesSent + " BYTES ON CONN: " + connectionId_
    });
  });
};

function beginUpload(port, selectedPort, hex, board_type, _protocol, _size) {
  disconnect(port); //disconnect from serial

  if (_protocol) {
    if (_protocol === "stk500") {
      uploader.uploadSketch(port, selectedPort, _protocol, hex, board_type);
    } else if (_protocol == "tcc_3730") {
      // hex is image firmware
      uploader.upload_tcc(port, selectedPort, _protocol, hex, board_type, _size);
    }
  } else { // old version
    var protocol = "stk500"; //forcing stk500 protocol
    uploader.uploadSketch(port, selectedPort, protocol, hex, board_type);
  }
};

},{"./binary.js":2,"./uploader.js":9}],2:[function(require,module,exports){
function decTohex(dec) {
  return parseInt(dec, 10).toString(16);
}

function binToHex(bin) {
  var bufferView = new Uint8Array(bin);
  var hexes = [];
  for (var i = 0; i < bufferView.length; ++i) {
    hexes.push(bufferView[i]);
  }
  return hexes;
}

function hexToBin(hex) {
  var buffer = new ArrayBuffer(hex.length);
  var bufferView = new Uint8Array(buffer);
  for (var i = 0; i < hex.length; i++) {
    bufferView[i] = hex[i];
  }
  return buffer;
}

function TCChexToBin(str) {
  // var buffer = new ArrayBuffer(str_arr.length * 4);
  // var bufferView = new Uint8Array(buffer);
  // var j=0, cnt = 0;
  // for (var i = 0; i < str_arr.length * 4; i++) {
  //   // for (var j = 0; j < str_arr[i].length; j++) {
  //       bufferView[i] = str_arr[cnt].charCodeAt(j);
  //       j++;
  //       if (i % 4 == 0) {
  //         cnt++;
  //         j=0;
  //       }
  //   // }
  // }
  // console.log('#@!$@!#@', bufferView);
  // return buffer;

  var buf=new ArrayBuffer(str.length);
  var bufView=new Uint8Array(buf);
  for (var i=0; i<str.length; i++) {
    bufView[i]=str.charCodeAt(i);
  }
  return buf;
}


function hexRep(intArray) {
  var buf = "[";
  var sep = "";
  for (var i = 0; i < intArray.length; ++i) {
    var h = intArray[i].toString(16);
    if (h.length == 1) { h = "0" + h; }
    buf += (sep + "0x" + h);
    sep = ",";
  }
  buf += "]";
  return buf;
}

function storeAsTwoBytes(n) {
  var lo = (n & 0x00FF);
  var hi = (n & 0xFF00) >> 8;
  return [hi, lo];
}

function makeFlashAddress(string) {
  var length = string.length;
  var ret = string;

  for (var i = 0;i < 8 - length; i++) {
      ret = "0" + ret;
  }

  return ret;
}

function stringToBinary(str) {
  var buffer = new ArrayBuffer(str.length);
  var bufferView = new Uint8Array(buffer);
  for (var i = 0; i < str.length; i++) {
    bufferView[i] = str.charCodeAt(i);
  }

  return bufferView;
}

function binaryToString(buffer) {
  var bufferView = new Uint8Array(buffer);
  var chars = [];
  for (var i = 0; i < bufferView.length; ++i) {
    chars.push(bufferView[i]);
  }

  return String.fromCharCode.apply(null, chars);
}

function uint8ArrayToArray(uint8Array) {
    var array = [];

    for (var i = 0; i < uint8Array.byteLength; i++) {
        array[i] = uint8Array[i];
    }

    return array;
}

function binToHex(bin) {
  var bufferView = new Uint8Array(bin);
  var hexes = [];
  for (var i = 0; i < bufferView.length; ++i) {
    hexes.push(bufferView[i]);
  }
  return hexes;
}

function tccStringToBinary(str) {
  var hexes = [];

  for (var i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) < 127) {
      hexes[i] = str[i];
    } else {
      // console.log(ord(str[i]));
      // console.log(binaryToString(str[i]));
      // console.log(stringToBinary(str[i].toString('utf8'))[0]);
      // console.log(bufferToHex(str[i]));
      hexes[i] = stringToBinary(str[i].toString('utf8'))[0];
    }
  }

  return hexes;
}

function bufferToHex(bin) {
  var buffer = new ArrayBuffer(bin.length);
  var bufferView = new Uint8Array(buffer);
  var hexes = [];
  for (var i = 0; i < bufferView.length; ++i) {
    hexes.push(bufferView[i]);
  }

  var result = parseInt(hexes.join(''), 2).toString(16);

  return result;
}

function ord (string) {
  //  discuss at: http://locutus.io/php/ord/
  // original by: Kevin van Zonneveld (http://kvz.io)
  // bugfixed by: Onno Marsman (https://twitter.com/onnomarsman)
  // improved by: Brett Zamir (http://brett-zamir.me)
  //    input by: incidence
  //   example 1: ord('K')
  //   returns 1: 75
  //   example 2: ord('\uD800\uDC00'); // surrogate pair to create a single Unicode character
  //   returns 2: 65536

  var str = string + ''
  var code = str.charCodeAt(0)

  if (code >= 0xD800 && code <= 0xDBFF) {
    // High surrogate (could change last hex to 0xDB7F to treat
    // high private surrogates as single characters)
    var hi = code
    if (str.length === 1) {
      // This is just a high surrogate with no following low surrogate,
      // so we return its value;
      return code
      // we could also throw an error as it is not a complete character,
      // but someone may want to know
    }
    var low = str.charCodeAt(1)
    return ((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000
  }
  if (code >= 0xDC00 && code <= 0xDFFF) {
    // Low surrogate
    // This is just a low surrogate with no preceding high surrogate,
    // so we return its value;
    return code
    // we could also throw an error as it is not a complete character,
    // but someone may want to know
  }

  return code
}

exports.decTohex = decTohex;
exports.binToHex = binToHex;
exports.hexToBin = hexToBin;
exports.hexRep = hexRep;
exports.storeAsTwoBytes = storeAsTwoBytes;
exports.makeFlashAddress = makeFlashAddress;
exports.stringToBinary = stringToBinary;
exports.binaryToString = binaryToString;
exports.uint8ArrayToArray = uint8ArrayToArray;
exports.tccStringToBinary = tccStringToBinary;
exports.TCChexToBin = TCChexToBin;

},{}],3:[function(require,module,exports){
// Parse an Intel hex file (http://en.wikipedia.org/wiki/Intel_HEX).
//
// For simplicity: Requires that the hex file specifies a single, contiguous
// block of data, starting at address 0.
//
// input: A string (separated by '\n' newlines) representing the file.
//
// returns: an array of integers (necessarily in the range [0,255]) where the n-th
//   array entry represents the byte at address 'n'.
//
// TODOs:
// - Validate checksum
// - Handle other record types
function ParseHexFile(input) {
  var kStartcodeBytes = 1;
  var kSizeBytes = 2;
  var kAddressBytes = 4;
  var kRecordTypeBytes = 2;
  var kChecksumBytes = 2;

  var inputLines = input.split("\n");

  var out = [];

  var nextAddress = 0;

  for (var i = 0; i < inputLines.length; ++i) {
    var line = inputLines[i];

    //
    // Startcode
    //
    if (line[0] != ":") {
      console.log("Bad line [" + i + "]. Missing startcode: " + line);
      return "FAIL";
    }

    //
    // Data Size
    //
    var ptr = kStartcodeBytes;
    if (line.length < kStartcodeBytes + kSizeBytes) {
      console.log("Bad line [" + i + "]. Missing length bytes: " + line);
      return "FAIL";
    }
    var dataSizeHex = line.substring(ptr, ptr + kSizeBytes);
    ptr += kSizeBytes;
    var dataSize = hexToDecimal(dataSizeHex);

    //
    // Address
    //
    if (line.length < ptr + kAddressBytes) {
      console.log("Bad line [" + i + "]. Missing address bytes: " + line);
      return "FAIL";
    }
    var addressHex = line.substring(ptr, ptr + kAddressBytes);
    ptr += kAddressBytes;
    var address = hexToDecimal(addressHex);

    //
    // Record Type
    //
    if (line.length < ptr + kRecordTypeBytes) {
      console.log("Bad line [" + i + "]. Missing record type bytes: " + line);
      return "FAIL";
    }
    var recordTypeHex = line.substring(ptr, ptr + kRecordTypeBytes);
    ptr += kRecordTypeBytes;

    //
    // Data
    //
    var dataChars = 2 * dataSize;  // Each byte is two chars
    if (line.length < (ptr + dataChars)) {
      console.log("Bad line [" + i + "]. Too short for data: " + line);
      return "FAIL";
    }
    var dataHex = line.substring(ptr, ptr + dataChars);
    ptr += dataChars;

    //
    // Checksum
    //
    if (line.length < (ptr + kChecksumBytes)) {
      console.log("Bad line [" + i + "]. Missing checksum: " + line);
      return "FAIL";
    }
    var checksumHex = line.substring(ptr, ptr + kChecksumBytes);

    //
    // Permit trailing whitespace
    //
    if (line.length > ptr + kChecksumBytes + 1) {
      var leftover = line.substring(ptr, line.length);
      if (!leftover.match("$\w+^")) {
          console.log("Bad line [" + i + "]. leftover data: " + line);
          return "FAIL";
      }
    }

    var kDataRecord = "00";
    var kEndOfFileRecord = "01";

    if (recordTypeHex == kEndOfFileRecord) {
      return out;
    } else if (recordTypeHex == kDataRecord) {
      if (address != nextAddress) {
        console.log("I need contiguous addresses");
        return "FAIL";
      }
      nextAddress = address + dataSize;

      var bytes = hexCharsToByteArray(dataHex);
      if (bytes == -1) {
        console.log("Couldn't parse hex data: " + dataHex);
        return "FAIL";
      }
      out = out.concat(bytes);
    } else {
      console.log("I can't handle records of type: " + recordTypeHex);
      return "FAIL";
    }
  }

  console.log("Never found EOF!");
  return "FAIL";
}

function hexToDecimal(h) {
  if (!h.match("^[0-9A-Fa-f]*$")) {
    console.log("Invalid hex chars: " + h);
    return -1;
  }
  return parseInt(h, 16);
}

function hexCharsToByteArray(hc) {
  if (hc.length % 2 != 0) {
    console.log("Need 2-char hex bytes");
    return -1; // :(
  }

  var bytes = [];
  for (var i = 0; i < hc.length / 2; ++i) {
    var hexChars = hc.substring(i * 2, (i * 2) + 2);
    var byte = hexToDecimal(hexChars);
    if (byte == -1) {
      return -1;
    }
    bytes.push(byte);
  }
  return bytes;
}

exports.ParseHexFile = ParseHexFile;

},{}],4:[function(require,module,exports){
var kDebugError = 0;
var kDebugNormal = 1;
var kDebugFine = 2;
var kDebugVeryFine = 3;

var visibleLevel = kDebugNormal;
var consoleLevel = kDebugVeryFine;

var visibleLoggingDiv_ = "";

function configureVisibleLogging(divName) {
  visibleLoggingDiv_ = divName;
}

function timestampString() {
  var now = new Date();
  var pad = function(n) {
    if (n < 10) {
      return "0"+ n;
    }else{
      return n;
    }
  }
  return pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
}

function visibleLog(message) {
  if (visibleLoggingDiv_ != "") {
    document.getElementById(visibleLoggingDiv_).innerHTML =
      "[" + timestampString() + "] " + message + 
      "<br/>" + document.getElementById(visibleLoggingDiv_).innerHTML;
  }
}

function consoleLog(message) {
  console.log(message);
  if (chrome.extension.getBackgroundPage()) {
    chrome.extension.getBackgroundPage().log(message);
  }
}

function setConsoleLogLevel(level) {
  consoleLevel = level;
}

function setVisibleLogLevel(level) {
  visibleLevel = level;
}

function log(level, message) {
  if (level <= consoleLevel) {
    console.log(message);
  }
  if (level <= visibleLevel) {
    visibleLog(message);
  }
}

exports.log = log;
exports.kDebugError = kDebugError;
exports.kDebugNormal = kDebugNormal;
exports.kDebugFine = kDebugFine;
exports.kDebugVeryFine = kDebugVeryFine;
exports.setVisibleLogLevel = setVisibleLogLevel;
exports.setConsoleLogLevel = setConsoleLogLevel;
exports.configureVisibleLogging = configureVisibleLogging;

},{}],5:[function(require,module,exports){
var logging = require("./logging.js");

var log = logging.log;
var kDebugError = logging.kDebugError;
var kDebugNormal = logging.kDebugNormal;
var kDebugFine = logging.kDebugFine;
var kDebugVeryFine = logging.kDebugVeryFine;

function SerialDispatcher() {
  this.listeners_ = [];
};

SerialDispatcher.prototype.listeners_ = [];

SerialDispatcher.prototype.dispatch = function(readArg) {
  for (var i = 0; i < this.listeners_.length; ++i) {
    this.listeners_[i].listener(readArg);
  }
}

SerialDispatcher.prototype.addListener = function(id, listener) {
  log(kDebugFine, "SerialDispatcher::AddListener " + id);
  for (var i = 0; i < this.listeners_.length; ++i) {
    if (this.listeners_[i].id == id) {
      log(kDebugError, "Already has a listener with id '" + id + "'");
      return;
    }
  }
  this.listeners_.push({
    id: id,
    listener: listener
  });
}

SerialDispatcher.prototype.removeListener = function(id) {
  for (var i = 0; i < this.listeners_.length; ++i) {
    if (this.listeners_[i].id == id) {
      this.listeners_.splice(i, 1);
    }
  }
}

exports.SerialDispatcher = SerialDispatcher;

},{"./logging.js":4}],6:[function(require,module,exports){
function Status(ok, errorMessage) {
  this.ok_ = ok;
  this.errorMessage_ = errorMessage;
};

Status.prototype.ok = function() { return this.ok_; }
Status.prototype.errorMessage = function() { return this.errorMessage_; }

Status.prototype.toString = function() {
  if (this.ok_) {
    return "OK";
  } else {
    return "ERROR: '" + this.errorMessage_ + "'";
  }
}

Status.OK = new Status(true, null);

Status.Error = function(message) {
  return new Status(false, message);
}

exports.Status = Status;

},{}],7:[function(require,module,exports){
var Status = require("./status.js").Status;
var logging = require("./logging.js");
var binary = require("./binary.js");

var hexToBin = binary.hexToBin;
var hexRep = binary.hexRep;
var binToHex = binary.binToHex;
var log = logging.log;
var kDebugError = logging.kDebugError;
var kDebugNormal = logging.kDebugNormal;
var kDebugFine = logging.kDebugFine;
var kDebugVeryFine = logging.kDebugVeryFine;

function NewStk500Board(serial, pageSize, opt_options) {
  if (typeof(serial) === "undefined") {
    return { status: Status.Error("serial is undefined") }
  }

  if (typeof(pageSize) === "undefined") {
    return { status: Status.Error("pageSize is undefined") }
  }

  return { status: Status.OK, board: new Stk500Board(serial, pageSize, opt_options) }
}

Stk500Board.prototype.connect = function(deviceName, board_type, doneCb) {
  this.connectImpl_(deviceName, board_type, doneCb);
};

Stk500Board.prototype.writeFlash = function(boardAddress, data, doneCb) {
  this.writeFlashImpl_(boardAddress, data, doneCb);
};

Stk500Board.prototype.readFlash = function(boardAddress, length, doneCb) {
  this.readFlashImpl_(boardAddress, length, doneCb);
};

var STK = {
  OK: 0x10,
  IN_SYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  GET_PARAMETER: 0x41,
  FLASH_MEMORY: 0x46,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROGRAM_PAGE: 0x64,
  READ_PAGE: 0x74,
  HW_VER: 0x80,
  SW_VER_MAJOR: 0x81,
  SW_VER_MINOR: 0x82,

  BYTES_PER_WORD: 2,
};

Stk500Board.State = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected"
};

Stk500Board.prototype.init_ = function() {
  this.connectionId_ = -1;
  this.pageSize_ = -1;
  this.readHandler_ = null;
  this.serial_ = null;
  this.serialListener_ = null;
  this.state_ = Stk500Board.State.DISCONNECTED;
  this.connectionDelayMs_ = 2000;
}

function Stk500Board(serial, pageSize, opt_options) {
  this.init_();
  this.serial_ = serial;
  this.pageSize_ = pageSize;
  this.readHandler_ = this.discardData_;

  if (typeof(opt_options) != "undefined") {
    if (typeof(opt_options) != "undefined") {
      this.connectDelayMs_ = opt_options.connectDelayMs;
    }
  }
};

Stk500Board.prototype.writeAndGetFixedSizeReply_ = function(writePayload, replyBytes, readHandler) {
  this.setReadHandler_(this.waitForNBytes_(replyBytes, readHandler));
  this.write_(writePayload);
};

Stk500Board.prototype.setReadHandler_ = function(handler) {
  this.readHandler_ = handler;
};

Stk500Board.prototype.handleRead_ = function(readArg) {
  log(kDebugFine, "STK500::HandleRead: " + hexRep(binToHex(readArg.data).slice(0,10)));
  if (this.readHandler_ != null) {
    this.readHandler_(readArg);
    return;
  }

  log(kDebugError, "No read handler for: " + JSON.stringify(readArg));
}

Stk500Board.prototype.write_ = function(payload) {
  log(kDebugFine, "STK500::Writing " + hexRep(payload.slice(0,10)) + " -> " + this.connectionId_);
  this.serial_.send(
    this.connectionId_, hexToBin(payload), function(writeArg) {
      console.log('write!!');
      // log(kDebugVeryFine, "WRITE: " + JSON.stringify(writeArg));
      // TODO: veridy writeArg
    });
}

// TODO(mrjones): set a watchdog timeout, so that we can return
// something, rather than hanging forever if we don't get n bytes.
Stk500Board.prototype.waitForNBytes_ = function(n, onFull) {
  var buffer = [];

  return function(readArg) {
    var d = binToHex(readArg.data);
    buffer = buffer.concat(d);

    log(kDebugVeryFine, "Buffered " + d.length + " new bytes. Total is now " +
        buffer.length + ", and waiting for " + n);
    if (buffer.length >= n) {
      // If any data comes in while we're not expecting it, just drop
      // it on the floor.
      this.readHandler_ = this.discardData_;
      onFull({data: buffer});
    }
  }
}

Stk500Board.prototype.discardData_ = function(readArg) {
  log(kDebugError, "STK500::Got data from board when none was expected: " +
      binToHex(readArg));
}

//
// CONNECTION ESTABLISHMENT
//
Stk500Board.prototype.connectImpl_ = function(deviceName, board_type, doneCb) {
  // TODO: Validate doneCb
  // TODO: Validate deviceName?
  if (this.state_ != Stk500Board.State.DISCONNECTED) {
    doneCb(Status.Error("Can't connect. Current state: " + this.state_));
    return;
  }

  log(kDebugFine, "STK500::Connecting");
  this.state_ = Stk500Board.State.CONNECTING;

  var board = this;

  var bitrate = 115200;
  if (board_type.indexOf('nano') > -1) {
    bitrate = 57600;
  }

  this.serial_.connect(deviceName, { bitrate: bitrate }, function(connectArg) {
    board.serialConnected_(connectArg, doneCb);
  });
}

Stk500Board.prototype.serialConnected_ = function(connectArg, doneCb) {
  if (typeof(connectArg) == "undefined" ||
      typeof(connectArg.connectionId) == "undefined" ||
      connectArg.connectionId == -1) {
    doneCb(Status.Error("Unable to connect to device!"));
    return;
  }

  log(kDebugVeryFine, "STK500::SerialConnected " + connectArg.connectionId);

  this.connectionId_ = connectArg.connectionId;

  // TODO: be more careful about removing this listener
  this.serialListener_ = this.handleRead_.bind(this);
  this.serial_.onReceive.addListener(this.serialListener_);

  this.twiddleControlLines_(doneCb);
}

Stk500Board.prototype.twiddleControlLines_ = function(doneCb) {
  var cid = this.connectionId_;
  var serial = this.serial_;
  var board = this;
  log(kDebugNormal, "STK500::WaitingToTwiddleControlLines (2 seconds)");
  setTimeout(function() {
    log(kDebugFine, "STK500::TwiddlingControlLines");
    serial.setControlSignals(cid, {dtr: false, rts: false}, function(ok) {
      if (!ok) {
        board.disconnectAndReturn_(doneCb, Status.Error("Couldn't set dtr/rts low"));
        return;
      }
      log(kDebugVeryFine, "STK500::DTR is false");
      setTimeout(function() {
        serial.setControlSignals(cid, {dtr: true, rts: true}, function(ok) {
          if (!ok) {
            board.disconnectAndReturn_(doneCb, Status.Error("Couldn't set dtr/rts high"));
            return;
          }
          log(kDebugVeryFine, "STK500::DTR is true");
          setTimeout(function() { board.getSync_(doneCb, 0); }, 250);
        });
      }, 250);
    });
  }, this.connectDelayMs_);
}

Stk500Board.prototype.getSync_ = function(doneCb, attempts) {
  log(kDebugVeryFine, "STK500::GetSync #" + attempts);
  var board = this;
  this.writeAndGetFixedSizeReply_(
    [ STK.GET_SYNC, STK.CRC_EOP ],
    2,
    function(readArg) {
      var data = binToHex(readArg.data);
      if (data.length == 2 &&
          data[0] == STK.IN_SYNC && data[1] == STK.OK) {
        log(kDebugNormal, "In Sync.");
        board.validateVersion_(doneCb);
      } else {
        if (attempts < 10) {
          setTimeout(function() {
            board.getSync_(doneCb, attempts + 1);
          }, 50);
        } else {
          board.disconnectAndReturn(doneCb, Status.Error("Couldn't get sync"));
        }
      }
    });
}

Stk500Board.prototype.validateVersion_ = function(doneCb) {
  var board = this;

  // TODO(mrjones): Think about what to do here ... do we actually care
  // about HW/SW versions?
  this.writeAndGetFixedSizeReply_(
    [STK.GET_PARAMETER, STK.HW_VER, STK.CRC_EOP],
    3,
    function(readArg) {
      log(kDebugNormal, "Hardware version: " + binToHex(readArg.data));
      board.state_ = Stk500Board.State.CONNECTED;
      doneCb(Status.OK);
    });
}

//
// WRITE FLASH
//
Stk500Board.prototype.writeFlashImpl_ = function(boardAddress, data, doneCb) {
  if (this.state_ != Stk500Board.State.CONNECTED) {
    doneCb(Status.Error("Not connected to board: " + this.state_));
    return;
  }

  if (boardAddress % this.pageSize_ != 0) {
    doneCb(Status.Error(
      "boardAddress must be aligned to page size of " + this.pageSize_
        + " (" + boardAddress + " % " + this.pageSize_ + " == "
        + (boardAddress % this.pageSize_) + ")"));
    return;
  }

  if (data.length % this.pageSize_ != 0) {
    return doneCb(Status.Error(
      "data size must be aligned to page size of " + this.pageSize_
        + " (" + data.length + " % " + this.pageSize_ + " == "
        + (data.length % this.pageSize_) + ")"));
  }

  log(kDebugFine, "STK500::WriteFlash (" + data.length + " bytes)");

  var board = this;
  this.writeAndGetFixedSizeReply_(
    [STK.ENTER_PROGMODE, STK.CRC_EOP],
    2,
    function(readArg) {
      var d = binToHex(readArg.data);
      if (d.length == 2 && d[0] == STK.IN_SYNC && d[1] == STK.OK) {
        board.writePage_(boardAddress, data, 0, doneCb)
      } else {
        return doneCb(Status.Error(
          "Error entering program mode: " + hexRep(response)));
      }
    });
}

Stk500Board.prototype.writePage_ = function(dataStart, data, pageNo, doneCb) {
  log(kDebugNormal, "STK500::WritePage: " + pageNo);
  this.writePageAddress_(dataStart, data, pageNo, doneCb);
}

Stk500Board.prototype.writePageAddress_ = function(dataStart, data, pageNo, doneCb) {
  log(kDebugFine, "STK500::LoadAddress " + pageNo);
  var byteAddress = dataStart + (this.pageSize_ * pageNo);

  var wordAddress = byteAddress / STK.BYTES_PER_WORD;
  var addressLo = wordAddress & 0x00FF;
  var addressHi = (wordAddress & 0xFF00) >> 8;

  var board = this;
  this.writeAndGetFixedSizeReply_(
    [STK.LOAD_ADDRESS, addressLo, addressHi, STK.CRC_EOP],
    2,
    function(readArg) {
      var d = binToHex(readArg.data);
      if (d.length == 2 && d[0] == STK.IN_SYNC && d[1] == STK.OK) {
        board.writePageData_(dataStart, data, pageNo, doneCb);
      } else {
        doneCb(Status.Error(
          "Error loading address for page #" + pageNo + ": " + data));
      }
    });
}

Stk500Board.prototype.writePageData_ = function(dataStart, data, pageNo, doneCb) {
  log(kDebugFine, "STK500::WritePageData");
  var relativeOffset = this.pageSize_ * pageNo;
  var payload = data.slice(relativeOffset, relativeOffset + this.pageSize_);

  var sizeLo = (this.pageSize_ & 0x00FF);
  var sizeHi = (this.pageSize_ & 0xFF00) >> 8;

  var message = [ STK.PROGRAM_PAGE, sizeHi, sizeLo, STK.FLASH_MEMORY ];
  message = message.concat(payload);
  message.push(STK.CRC_EOP);

  var board = this;
  this.writeAndGetFixedSizeReply_(
    message,
    2,
    function(readArg) {
      var d = binToHex(readArg.data);
      if (d.length == 2 && d[0] == STK.IN_SYNC && d[1] == STK.OK) {
        if (relativeOffset + board.pageSize_ >= data.length) {
          return board.doneWriting_(doneCb);
        } else {
          return board.writePage_(dataStart, data, pageNo + 1, doneCb);
        }
      } else {
        doneCb(Status.Error(
          "Error flashing page #" + pageNo + ": " + data));
        return;
      }
    });
}

Stk500Board.prototype.doneWriting_ = function(doneCb) {
  var board = this;
  log(kDebugFine, "STK500::Leaving progmode")
  this.writeAndGetFixedSizeReply_(
    [ STK.LEAVE_PROGMODE, STK.CRC_EOP ],
    2,
    function(readArg) {
      board.disconnectAndReturn_(doneCb, Status.OK);
    });
}

Stk500Board.prototype.disconnectAndReturn_ = function(doneCb, status) {
  var board = this;
  log(kDebugFine, "STK500::Disconnecting")
  this.serial_.disconnect(this.connectionId_, function(disconnectArg) {
    log(kDebugFine, "STK500::Disconnected: " + JSON.stringify(disconnectArg));

    board.connectionId_ = -1;
    board.state_ = Stk500Board.State.DISCONNECTED;
    board.readHandler_ = null
    board.serial_.onReceive.removeListener(board.serialListener_);
    board.SerialListener_ = null;

    doneCb(status);
  });
}

//
// READ FLASH
//
Stk500Board.prototype.readFlashImpl_ = function(boardAddress, length, doneCb) {
  log(kDebugNormal, "STK500::ReadFlash @" + boardAddress + "+" + length);
  if (this.state_ != Stk500Board.State.CONNECTED) {
    return {status: Status.Error("Not connected to board: " + this.state_), data: []}
  }

  var data = new Array(length);
  this.readChunkSetAddress_(data, boardAddress, length, 0, doneCb);
};

Stk500Board.prototype.readChunkSetAddress_ = function(data, boardAddress, length, currentOffset, doneCb) {
  log(kDebugNormal, "STK500::ReadChunkSetAddress @" + boardAddress + "+" + length + " ... " + currentOffset);
  var board = this;
  var currentByteAddress = boardAddress + currentOffset;
  var currentWordAddress = currentByteAddress / STK.BYTES_PER_WORD
  var addressHi = (currentWordAddress & 0xFF00) >> 8;
  var addressLo = currentWordAddress & 0x00FF;
  this.writeAndGetFixedSizeReply_(
    [ STK.LOAD_ADDRESS, addressLo, addressHi, STK.CRC_EOP ],
    2,
    function(readArg) {
      var d = binToHex(readArg.data);
      if (d.length == 2 && d[0] == STK.IN_SYNC && d[1] == STK.OK) {
        board.readChunkReadData_(data, boardAddress, length, currentOffset, doneCb);
      } else {
        doneCb({status: Status.Error("Error loading address @" + address), data: []});
        return;
      }
    });
}

Stk500Board.prototype.readChunkReadData_ = function(data, address, length, currentOffset, doneCb) {
  var kChunkSize = 128;
  var readSize = Math.min(kChunkSize, (length - currentOffset));

  var sizeHi = (readSize & 0xFF00) >> 8;
  var sizeLo = readSize & 0x00FF;

  var board = this;
  this.writeAndGetFixedSizeReply_(
    [ STK.READ_PAGE, sizeHi, sizeLo, STK.FLASH_MEMORY, STK.CRC_EOP ],
    readSize + 2,
    function(readArg) {
      var d = binToHex(readArg.data);
      if (d[0] == STK.IN_SYNC && d[readSize + 1] == STK.OK) {
        for (var i = 0; i < readSize; i++) {
          data[currentOffset++] = d[i + 1];
        }

        if (currentOffset >= length) {
          doneCb({status: Status.OK, data: data});
        } else {
          board.readChunkSetAddress_(data, address, length, currentOffset, doneCb);
        }
      } else {

        doneCb({status: Status.Error(
          "Error reading data at [" + address + ", " + (address + readSize) + ")"), data: []});
        return;
      }
    });

}

exports.NewStk500Board = NewStk500Board;
exports.STK = STK;

},{"./binary.js":2,"./logging.js":4,"./status.js":6}],8:[function(require,module,exports){
var Status = require("./status.js").Status;
var binary = require("./binary.js");

var decTohex = binary.decTohex;
var hexToBin = binary.hexToBin;
var hexRep = binary.hexRep;
var binToHex = binary.binToHex;
var stringToBinary = binary.stringToBinary;
var makeFlashAddress = binary.makeFlashAddress;
var uint8ArrayToArray = binary.uint8ArrayToArray;
var tccStringToBinary = binary.tccStringToBinary;
var TCChexToBin = binary.TCChexToBin;

function NewTCC3730Board(serial, pageSize, opt_options) {
  if (typeof(serial) === "undefined") {
    return {
      status: Status.Error("serial is undefined")
    }
  }

  if (typeof(pageSize) === "undefined") {
    return {
      status: Status.Error("pageSize is undefined")
    }
  }

  return {
    status: Status.OK,
    board: new TCC3730Board(serial, pageSize, opt_options)
  }
}

TCC3730Board.State = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected"
}

// constants
var TCC3730 = {
  CMD_READ_BROM_ID: 0x03,
  CMD_BULK_ERASE: 0xE0,
  CMD_SECTOR_ERASE: 0xE1,
  CMD_GET_FLASH_INFO: 0xE2,
  CMD_SET_FLASH_INFO: 0xE3,
  CMD_GET_FLASH_ID: 0xE4,
  CMD_READ_FLASH_STATUS: 0xE5,
  CMD_WRITE_FLASH_STATUS: 0xE6,
  CMD_READ_DATA: 0xD0,
  CMD_WRITE_DATA: 0xD1,
  CMD_RAM_RUN: 0xA0,
  OPTION_NO: 0x00,
  OPTION_M3: 0x00,
  OPTION_DSP: 0x01,
  OPTION_NO: 0x00,
  MAX_PAYLOAD_SIZE: 1024,
  PREAMBLE: 0,
  COMMAND: 1,
  OPTION_RESULT: 2,
  PAYLOAD_SIZE: 3,
  PAYLOAD: 5,
  END_MARK: 5,
  CRC: 6,
  CRC_END: 7,
  PAYLOAD_ADDRESS: 4,
  PREAMBLE_DATA: 0xBB,
  END_MARK_DATA: 0x7E,
  RES_STATUS_START: 0,    // Initial
  RES_STATUS_PREAMBLE: 1,    // Found preamble byte
  RES_STATUS_PAYLOADLENGTH: 2,    // Calculate payload length
  RES_STATUS_ENDMARK: 3,    // Find end mark
  RES_STATUS_CRC: 4,    // Calculate CRC
  RESULT_ACK: 0x06,
  RESULT_NAK: 0x15,
  Flash_Chip_Size: 0x1000000,
  Flash_Sector_Size: 0x1000,
  Flash_Page_Size: 0x100,
  Flash_Type: 0x00,
  Flash_Bulk_Erase_Command: 0xC7,
  Flash_Sector_Erase_Command: 0x20,
  Flash_Reset_Contiuous_Read_Mode_Command_Bytes: 0x00,
  Flash_Status_Read1_Command: 0x05,
  Flash_Status_Read2_Command: 0x15,
  Flash_Status_Read3_Command: 0x00,
  Flash_Status_Write1_Command: 0x01,
  Flash_Status_Write2_Command: 0x00,
  Flash_Status_Write3_Command: 0x00,
  Flash_Quad_Enable_Bit_Nubmer: 0x06
}

TCC3730Board.prototype.init_ = function() {
  this.connectionId_ = -1;
  this.readHandler_ = null;
  this.serial_ = null;
  this.serialListener_ = null;
  this.state_ = TCC3730Board.State.DISCONNECTED;
  this.connectionDelayMs_ = 2000;
}

function TCC3730Board(serial, opt_options) {
  this.init_();
  this.serial_ = serial;
  this.readHandler_ = this.discardData_;

  if (typeof(opt_options) != "undefined") {
    this.connectDelayMs_ = opt_options.connectDelayMs;
  }
}

TCC3730Board.prototype.writeAndGetFixedSizeReply_ = function(writePayload, replyBytes, readHandler) {
  this.setReadHandler_(this.waitForNBytes_(replyBytes, readHandler));
  this.write_(writePayload);
};

TCC3730Board.prototype.setReadHandler_ = function(handler) {
  this.readHandler_ = handler;
};

TCC3730Board.prototype.handleRead_ = function(readArg) {
  console.log("TCC3730::HandleRead: " + hexRep(binToHex(readArg.data).slice(0,10)));
  if (this.readHandler_ != null) {
    this.readHandler_(readArg);
    return;
  }

  console.log("No read handler for: " + JSON.stringify(readArg));
}

// TODO(mrjones): set a watchdog timeout, so that we can return
// something, rather than hanging forever if we don't get n bytes.
TCC3730Board.prototype.waitForNBytes_ = function(n, onFull) {
  var buffer = [];

  return function(readArg) {
    var d = binToHex(readArg.data);
    buffer = buffer.concat(d);

    // console.log("Buffered " + d.length + " new bytes. Total is now " + buffer.length + ", and waiting for " + n);
    if (buffer.length >= n) {
      // If any data comes in while we're not expecting it, just drop
      // it on the floor.
      this.readHandler_ = this.discardData_;
      onFull({data: buffer});
    }
  }
}

TCC3730Board.prototype.discardData_ = function(readArg) {
  console.log("TCC3730Board::Got data from board when none was expected: " +
      binToHex(readArg));
}


TCC3730Board.prototype.connect = function(deviceName, board_type, doneCb) {
  this.connectImpl_(deviceName, board_type, doneCb);
}

TCC3730Board.prototype.connectImpl_ = function(deviceName, board_type, doneCb) {
  if (this.state_ != TCC3730Board.State.DISCONNECTED) {
    doneCb(Status.Error("Can`t connect. Current state: " + this.state_));
    return;
  }

  console.log("TCC3730::Connecting");
  this.state_ = TCC3730Board.State.CONNECTING;

  var board = this;
  var bitrate = 115200;

  this.serial_.connect(deviceName, {bitrate: bitrate}, function(connectArg) {
    board.serialConnected_(connectArg, doneCb);
    // doneCb(Status.OK);
  });
}

TCC3730Board.prototype.serialConnected_ = function(connectArg, doneCb) {
  var board = this;
  if (typeof(connectArg) == "undefined" ||
      typeof(connectArg.connectionId) == "undefined" ||
      connectArg.connectionId == -1) {
    doneCb(Status.Error("Unable to connect to device!"));
    return;
  }

  //console.log(kDebugVeryFine, "TCC3730::SerialConnected " + connectArg.connectionId);

  this.connectionId_ = connectArg.connectionId;

  // TODO: be more careful about removing this listener
  this.serialListener_ = this.handleRead_.bind(this);
  this.serial_.onReceive.addListener(this.serialListener_);

  this.twiddleControlLines_(doneCb);
  // board.BROM_ReadFlashID(doneCb);
}

TCC3730Board.prototype.twiddleControlLines_ = function(doneCb) {
  var cid = this.connectionId_;
  var serial = this.serial_;
  var board = this;
  console.log("TCC3730::WaitingToTwiddleControlLines (2 seconds)");
  setTimeout(function() {
    console.log("TCC3730::TwiddlingControlLines");
    serial.setControlSignals(cid, {dtr: false, rts: false}, function(ok) {
      if (!ok) {
        board.disconnectAndReturn_(doneCb, Status.Error("Couldn't set dtr/rts low"));
        return;
      }
      console.log("TCC3730::DTR is false");
      setTimeout(function() {
        serial.setControlSignals(cid, {dtr: true, rts: true}, function(ok) {
          if (!ok) {
            board.disconnectAndReturn_(doneCb, Status.Error("Couldn't set dtr/rts high"));
            return;
          }
          console.log("TCC3730::DTR is true");
          setTimeout(function() { board.BROM_ReadFlashID(doneCb); }, 250);
        });
      }, 250);
    });
  }, this.connectDelayMs_);
}

TCC3730Board.prototype.BROM_ReadFlashID = function(doneCb) {
  var board = this;
  var ucResPayLoad = [];
  var uiReturn = 0;
  var byte_length = 19;

  board.make_command(TCC3730.CMD_READ_BROM_ID, TCC3730.OPTION_NO, 0, 0, byte_length, function(option) {
    // board.state_ = TCC3730Board.State.CONNECTED;
    if (option) {
        doneCb(Status.OK);
    } else {
        doneCb(Status.Error("received NAK"));
    }
  });
}

TCC3730Board.prototype.make_command = function(ucCmdID, ucResultOption, usPayLoadLength, ucPayload, byte_length, callback) {
  var board = this;
  var ucCmdBuf = new Array(TCC3730.MAX_PAYLOAD_SIZE + TCC3730.CRC_END + TCC3730.PAYLOAD_ADDRESS + 1).fill(0);
  var ucStrBuf = new Array(TCC3730.MAX_PAYLOAD_SIZE + TCC3730.CRC_END + TCC3730.PAYLOAD_ADDRESS + 1).fill(0);

  ucCmdBuf[TCC3730.PREAMBLE] = TCC3730.PREAMBLE_DATA;
  ucCmdBuf[TCC3730.COMMAND] = ucCmdID;
  ucCmdBuf[TCC3730.OPTION_RESULT] = ucResultOption;
  ucCmdBuf[TCC3730.PAYLOAD_SIZE] = usPayLoadLength & 0x00FF;
  ucCmdBuf[TCC3730.PAYLOAD_SIZE + 1] = (usPayLoadLength >> 8) & 0x00FF;

  // console.log('!!#@!$!@#!@', usPayLoadLength);
  if (usPayLoadLength !== 0) {
    for (var i = 0; i <= usPayLoadLength; i++) {
      if (typeof(ucPayload[i]) == 'string') {
        ucCmdBuf[TCC3730.PAYLOAD + i] = ucPayload[i].charCodeAt();
      } else {
        // if (ucPayload[i] > 32 && ucPayload[i] < 127) {
        //   ucCmdBuf[TCC3730.PAYLOAD + i] = String.fromCharCode(ucPayload[i]);
        // } else {
        //     ucCmdBuf[TCC3730.PAYLOAD + i] = "\x" + ucPayload[i].toString(16);
        // }
        ucCmdBuf[TCC3730.PAYLOAD + i] = ucPayload[i];
      }
    }
  }

  ucCmdBuf[TCC3730.END_MARK + usPayLoadLength] =TCC3730.END_MARK_DATA;

  var crc = board.cal_crc16(ucCmdBuf, usPayLoadLength + TCC3730.END_MARK);

  ucCmdBuf[TCC3730.CRC + usPayLoadLength] = (crc & 0x00FF);
  ucCmdBuf[TCC3730.CRC + usPayLoadLength + 1] = (crc >> 8) & 0x00FF;

  for (var i = 0; i <= usPayLoadLength + TCC3730.CRC_END; i++) {
      ucStrBuf[i] = ucCmdBuf[i]
      // ucStrBuf[i] = "\\x" + ucCmdBuf[i].toString(16);
  }

  board.writeAndGetFixedSizeReply_(ucStrBuf, byte_length, function(readArg) {
      var data = readArg.data;
      if (data[TCC3730.PREAMBLE] != TCC3730.PREAMBLE_DATA && data[TCC3730.COMMAND] != ucCmdID) {
        callback(false);
      } else {
        if (data[TCC3730.OPTION_RESULT] == TCC3730.RESULT_NAK) {
          callback(false);
        }
        board.state_ = TCC3730Board.State.CONNECTED;
        callback(true);
      }
  });
}

TCC3730Board.prototype.cal_crc16 = function(data, length) {
  var crc = 0xffff;

  for (var i = TCC3730.COMMAND; i < length + 1; i++) {
    if (typeof(data[i]) === 'string') {
      crc = ((crc << 8) | (crc >> 8) & 0xff) ^ data[i].charCodeAt();
    } else {
      crc = ((crc << 8) | (crc >> 8) & 0xff) ^ data[i];
    }

    crc ^= (crc & 0xff) >> 4;
    crc ^= (crc << 8) << 4;
    crc ^= ((crc & 0xff) << 4) << 1;
    crc = crc & 0xFFFF;
  }

  return crc;
}

TCC3730Board.prototype.write_ = function(payload) {
  var board = this;
  console.log("TCC3730::Writing " + hexRep(payload.slice(0,100)) + " -> " + this.connectionId_);
  // payload = payload.concat(47);
  console.log('serial send!!', payload);
  var length = payload.length;
  var first_arr = payload.splice(0, length / 2);

  board.serial_.send(board.connectionId_, hexToBin(first_arr), function(sendInfo) {
      console.log('sendInfo', sendInfo);
      // console.log("WRITE: " + JSON.stringify(writeArg));
      // TODO: veridy writeArg
      board.serial_.send(board.connectionId_, hexToBin(payload), function(sendInfo) {
          console.log('sendInfo', sendInfo);
          // console.log("WRITE: " + JSON.stringify(writeArg));
          // TODO: veridy writeArg
      });
  });
}

TCC3730Board.prototype.disconnectAndReturn_ = function(doneCb, status) {
  var board = this;
  console.log("TCC3730Board::Disconnecting")
  this.serial_.disconnect(this.connectionId_, function(disconnectArg) {
    console.log("TCC3730Board::Disconnected: " + JSON.stringify(disconnectArg));

    board.connectionId_ = -1;
    board.state_ = TCC3730Board.State.DISCONNECTED;
    board.readHandler_ = null
    board.serial_.onReceive.removeListener(board.serialListener_);
    // board.serialListener_ = null;

    doneCb(status);
  });
}

TCC3730Board.prototype.BROM_WriteBinaryData = function(port, firmware, uiInitialAddress, uiFileSize, callback) {
  var board = this;
  // var firmware = uint8ArrayToArray(stringToBinary(firmware));
  // console.log(firmware);
  // var firmware = tccStringToBinary(firmware);
  firmware = firmware.match(/.{1,2}/g);
  var ucResPayLoad = [];
  var uiReturn = 0;
  var ucCmdPayLoad = new Array(TCC3730.MAX_PAYLOAD_SIZE + 4).fill(0);
  var uiSectorSize = 0x1000;

  if (uiFileSize <= 0) {
    callback(false);
    return;
  }

  var uiSizeRemind = uiFileSize;
  var uiFlashAddress = uiInitialAddress;
  var sFlashAddress;
  var uiWriteSize;
  var usPayLoadLength;

  // Erase Serial Flash
  var ErasePageData = function(erase_done_callback) {
    usPayLoadLength = 4;
    // uiFlashAddress = decTohex(uiFlashAddress);
    sFlashAddress = makeFlashAddress(decTohex(uiFlashAddress));
    var msg = "Erasing Serial Flash >> " + sFlashAddress + "...";
    port.postMessage({
      op: 'upload',
      msg: msg
    });

    ucCmdPayLoad[0] = parseInt(sFlashAddress.substring(6,8), 16);
    ucCmdPayLoad[1] = parseInt(sFlashAddress.substring(4,6), 16);
    ucCmdPayLoad[2] = parseInt(sFlashAddress.substring(2,4), 16);
    ucCmdPayLoad[3] = parseInt(sFlashAddress.substring(0,2), 16);

    setTimeout(function() {
      board.make_command(TCC3730.CMD_SECTOR_ERASE, TCC3730.OPTION_NO, usPayLoadLength, ucCmdPayLoad, 9, function(option) {
        if (option) {
          if (uiSizeRemind > uiSectorSize) {
            uiSizeRemind = uiSizeRemind - uiSectorSize;
            uiFlashAddress = uiFlashAddress + uiSectorSize;
            ErasePageData(erase_done_callback);
          } else {
            erase_done_callback();
          }
        } else {
          callback(false);
          return;
        }
      });
    }, 300);
  }

  var WritePageData = function(write_done_callback) {
    var usPayloadLength = 4 + uiWriteSize;
    // uiFlashAddress = decTohex(uiFlashAddress);
    sFlashAddress = makeFlashAddress(decTohex(uiFlashAddress));

    var msg = "Writing Firmware >> " + sFlashAddress + "...";
    port.postMessage({
      op: 'upload',
      msg: msg
    });
    var write_UcCmdPayLoad = [];

    write_UcCmdPayLoad[0] = parseInt(sFlashAddress.substring(6,8), 16);
    write_UcCmdPayLoad[1] = parseInt(sFlashAddress.substring(4,6), 16);
    write_UcCmdPayLoad[2] = parseInt(sFlashAddress.substring(2,4), 16);
    write_UcCmdPayLoad[3] = parseInt(sFlashAddress.substring(0,2), 16);

    var splice_arr = firmware.slice(parseInt(sFlashAddress, 16), parseInt(sFlashAddress, 16) + uiWriteSize);
    for (var i = 0; i < splice_arr.length; i++) {
      splice_arr[i] = parseInt(splice_arr[i], 16);
    }
    write_UcCmdPayLoad = write_UcCmdPayLoad.concat(splice_arr);

    for (var i = write_UcCmdPayLoad.length; i < TCC3730.MAX_PAYLOAD_SIZE + 4; i++) {
      write_UcCmdPayLoad[i] = 0;
    }

    setTimeout(function() {
      board.make_command(TCC3730.CMD_WRITE_DATA, 0x00, usPayloadLength, write_UcCmdPayLoad, 9, function(option) {
        if (option) {
          uiFlashAddress = uiFlashAddress + TCC3730.MAX_PAYLOAD_SIZE;

          if (uiSizeRemind > TCC3730.MAX_PAYLOAD_SIZE) {
            uiWriteSize = TCC3730.MAX_PAYLOAD_SIZE;
            uiSizeRemind = uiSizeRemind - TCC3730.MAX_PAYLOAD_SIZE;
            WritePageData(write_done_callback);
          } else if (uiSizeRemind) {
            uiWriteSize = uiSizeRemind;
            uiSizeRemind = 0;
            WritePageData(write_done_callback);
          } else {
            write_done_callback();
          }
        } else {
          callback(false);
          return;
        }
      });
    }, 300);
  }

  port.postMessage({
    op: 'upload',
    msg: "TCC3730: Erase Serial Flash Start."
  });

  ErasePageData(function() {
    uiSizeRemind = uiFileSize;
    uiFlashAddress = uiInitialAddress;
    sFlashAddress = makeFlashAddress(uiFlashAddress);

    port.postMessage({
      op: 'upload',
      msg: "TCC3730: Erase Serial Flash Complete."
    });

    if (uiSizeRemind > TCC3730.MAX_PAYLOAD_SIZE) {
      uiWriteSize = TCC3730.MAX_PAYLOAD_SIZE;
      uiSizeRemind = uiSizeRemind - TCC3730.MAX_PAYLOAD_SIZE;
    } else {
      uiWriteSize = uiSizeRemind;
      uiSizeRemind = 0;
    }

    WritePageData(function() {
      board.connectionId_ = -1;
      board.state_ = TCC3730Board.State.DISCONNECTED;
      board.readHandler_ = null
      board.serial_.onReceive.removeListener(board.serialListener_);
      // board.serialListener_ = null;
      callback(true);
    });
  });
}

TCC3730Board.prototype.BROM_SetCheckFlashInfo = function(callback) {
  var board = this;
  var ucResPayLoad = [];
	var uiReturn = 0;
	var usPayLoadLength = 32;
  var ucCmdPayLoad = new Array(32).fill(0);

	// D0~D3: Serial Flash Chip Size
	ucCmdPayLoad[0] = (TCC3730.Flash_Chip_Size & 0x000000FF)
	ucCmdPayLoad[1] = (TCC3730.Flash_Chip_Size & 0x0000FF00) >> 8
	ucCmdPayLoad[2] = (TCC3730.Flash_Chip_Size & 0x00FF0000) >> 16
	ucCmdPayLoad[3] = (TCC3730.Flash_Chip_Size & 0xFF000000) >> 24

	// D4~D7: Serial Flash Sector Size
	ucCmdPayLoad[4] = (TCC3730.Flash_Sector_Size & 0x000000FF)
	ucCmdPayLoad[5] = (TCC3730.Flash_Sector_Size & 0x0000FF00) >> 8
	ucCmdPayLoad[6] = (TCC3730.Flash_Sector_Size & 0x00FF0000) >> 16
	ucCmdPayLoad[7] = (TCC3730.Flash_Sector_Size & 0xFF000000) >> 24

	// D8~D11: Serial Flash Page Size
	ucCmdPayLoad[8]  = (TCC3730.Flash_Page_Size & 0x000000FF)
	ucCmdPayLoad[9]  = (TCC3730.Flash_Page_Size & 0x0000FF00) >> 8
	ucCmdPayLoad[10] = (TCC3730.Flash_Page_Size & 0x00FF0000) >> 16
	ucCmdPayLoad[11] = (TCC3730.Flash_Page_Size & 0xFF000000) >> 24

	// D12~D15: Serial Flash Bulk(Chip) Erase Command ( 0x00 = ( not support)
	ucCmdPayLoad[12] = (TCC3730.Flash_Bulk_Erase_Command & 0x000000FF)
	ucCmdPayLoad[13] = (TCC3730.Flash_Bulk_Erase_Command & 0x0000FF00) >> 8
	ucCmdPayLoad[14] = (TCC3730.Flash_Bulk_Erase_Command & 0x00FF0000) >> 16
	ucCmdPayLoad[15] = (TCC3730.Flash_Bulk_Erase_Command & 0xFF000000) >> 24

	// D16~D19: Serial Flash Sector Erase Command (0x00 = ( not support)
	ucCmdPayLoad[16] = (TCC3730.Flash_Sector_Erase_Command & 0x000000FF)
	ucCmdPayLoad[17] = (TCC3730.Flash_Sector_Erase_Command & 0x0000FF00) >> 8
	ucCmdPayLoad[18] = (TCC3730.Flash_Sector_Erase_Command & 0x00FF0000) >> 16
	ucCmdPayLoad[19] = (TCC3730.Flash_Sector_Erase_Command & 0xFF000000) >> 24

	// D20: Reset Continuous Read Mode Command (Performance Enhance Mode Reset Command) bytes
	ucCmdPayLoad[20] = TCC3730.Flash_Reset_Contiuous_Read_Mode_Command_Bytes

	// D21: Advance serial Flash Type
	ucCmdPayLoad[21] = TCC3730.Flash_Type

	// D22, D23 : Reserved
	ucCmdPayLoad[22] = 0
	ucCmdPayLoad[23] = 0

	// D24, D25, D26 : serial flash status register 1, 2, 3 read command (0x00 = ( not support)
	ucCmdPayLoad[24] = TCC3730.Flash_Status_Read1_Command
	ucCmdPayLoad[25] = TCC3730.Flash_Status_Read2_Command
	ucCmdPayLoad[26] = TCC3730.Flash_Status_Read3_Command

	// D27 : Reserved
	ucCmdPayLoad[27] = 0

	// D28, D29, D30 : serial flash status register 1, 2, 3 write command (0x00 = ( not support)
	ucCmdPayLoad[28] = TCC3730.Flash_Status_Write1_Command
	ucCmdPayLoad[29] = TCC3730.Flash_Status_Write2_Command
	ucCmdPayLoad[30] = TCC3730.Flash_Status_Write3_Command

	// D31 : Reserved
	ucCmdPayLoad[31] = 0

	this.make_command(TCC3730.CMD_SET_FLASH_INFO, TCC3730.OPTION_NO, usPayLoadLength, ucCmdPayLoad, 8, function(option) {
    if (option) {
      console.log('check_flash_info success');
      callback(true);
    } else {
      console.log('check_flash_info fail');
      callback(false);
      return;
    }
  })
}

exports.NewTCC3730Board = NewTCC3730Board;
exports.TCC3730 = TCC3730;

},{"./binary.js":2,"./status.js":6}],9:[function(require,module,exports){
var SerialDispatcher = require("./serialdispatcher.js").SerialDispatcher;
var ParseHexFile = require("./hexparser.js").ParseHexFile;
var logging = require("./logging.js");
var stk500 = require("./stk500.js");
var tcc3730 = require("./tcc3730.js");
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
    // var boardObj = tcc3730.NewTCC3730Board(chrome.serial, 128);
    // if (!boardObj.status.ok()) {
    //   console.log("Couldn't create STK500 Board: " + boardObj.status.toString());
    //   port.postMessage({
    //     op: 'upload',
    //     msg: "Couldn't create TCC3730 Board: " + boardObj.status.toString()
    //   });
    //   return;
    // }
    //
    // var board = boardObj.board;
    // board.connect(deviceName, board_type, function(status) { // upload after connect
    //   if (status.ok()) {
    //     console.log("TCC3730: connected.", status);
    //   } else {
    //     console.log("TCC3730: connection error: " + status.toString());
    //     port.postMessage({
    //       op: 'upload',
    //       msg: "TCC3730: connection error: " + status.toString()
    //     });
    //   }
    // });
  } else {
    log(kDebugError, "Unknown protocol: "  + protocol);
    port.postMessage({
      op: 'upload',
      msg: "Unknown protocol: "  + protocol
    });
  }
}

function upload_tcc(port, deviceName, protocol, firmware, board_type, _size) {
  var boardObj = tcc3730.NewTCC3730Board(chrome.serial, 128);
  if (!boardObj.status.ok()) {
    console.log("Couldn't create STK500 Board: " + boardObj.status.toString());
    port.postMessage({
      op: 'upload',
      msg: "Couldn't create TCC3730 Board: " + boardObj.status.toString()
    });
    return;
  }

  var board = boardObj.board;
  board.connect(deviceName, board_type, function(status) {
    if (status.ok()) {
      console.log("TCC3730: connected.", status);
      port.postMessage({
        op: 'upload',
        msg: "TCC3730: connected."
      });

      board.BROM_SetCheckFlashInfo(function(success) {
        setTimeout(function() {
          if (success) {
            board.BROM_WriteBinaryData(port, firmware, 0x00000000, _size, function(success) { // port, image, startAddress, size
              if (success) {
                port.postMessage({
                  op: 'upload',
                  msg: "TCC3730: Upload Complete."
                });
              } else {
                console.trace('upload error');
                // console.log('upload error');
                // port.postMessage({
                //   op: 'upload',
                //   msg: "TCC3730: Upload Error."
                // });
              }
            });
          } else {
            console.log("TCC3730: connection error: " + status.toString());
            port.postMessage({
              op: 'upload',
              msg: "TCC3730: connection error: " + status.toString()
            });
          }
        }, 500);
      });
    } else {
      console.log("TCC3730: connection error: " + status.toString());
      port.postMessage({
        op: 'upload',
        msg: "TCC3730: connection error: " + status.toString()
      });
    }
  });
}

exports.pad = pad;
exports.uploadSketch = uploadSketch;
exports.upload_tcc = upload_tcc;

},{"./binary.js":2,"./hexparser.js":3,"./logging.js":4,"./serialdispatcher.js":5,"./stk500.js":7,"./tcc3730.js":8}]},{},[1,2,3,4,5,6,7,8,9]);
