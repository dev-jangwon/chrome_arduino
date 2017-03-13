## arduino chrome uploader?

크롬 브라우저에서 아두이노로 바로 업로드, 시리얼 통신할 수 있게 만든 오픈소스 크롬 앱입니다.

## 사용된 오픈 소스 / 크롬 API

[DecodedCo / ArduinoInTheBrowser](https://github.com/DecodedCo/ArduinoInTheBrowser)

아두이노 업로딩 프로토콜인 STK500 프로토콜의 Javascript 구현을 오픈소스를 참고했습니다.

[크롬 Serial API](https://developer.chrome.com/apps/serial)

크롬 Serial API를 사용해서 브라우저에서 직접 아두이노와 통신했습니다.

## 설치법
컴퓨터에 Node, npm이 사전 설치되어 있어야 합니다.

> npm install grunt

> npm install browserify

> npm install grunt-browserify

> grunt

위 명령어를 통해 크롬앱을 빌드합니다.

## 크롬 앱 스토어
https://chrome.google.com/webstore/detail/%EA%B5%AC%EB%A6%84%EB%91%90%EC%9D%B4%EB%85%B8/jcmgepajkglnookmnfhjfjfmpodiihkn
