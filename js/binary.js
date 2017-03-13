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
