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
      chrome.serial.setControlSignals(connectionId_, {dtr: false, rts: false}, function(ok) {
        if (!ok) {
          console.log("Couldn't set dtr/rts low!!!!");
          return;
        } else {
            console.log("DTR is false");
        }
        setTimeout(function() {
          chrome.serial.setControlSignals(connectionId_, {dtr: true, rts: true}, function(ok) {
            if (!ok) {
              console.log("Couldn't set dtr/rts high!!!!");
              return;
            } else {
                console.log("DTR is true");
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
    }
  } else { // old version
    var protocol = "stk500"; //forcing stk500 protocol
    uploader.uploadSketch(port, selectedPort, protocol, hex, board_type);
  }
};
