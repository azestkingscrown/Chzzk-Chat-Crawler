# 치지직 실시간 채팅 수집기 (Chzzk Chat Collector)

이 프로그램은 네이버 치지직(Chzzk) 스트리머의 실시간 방송 상태를 모니터링하고, 방송이 시작되면 실시간 채팅 및 후원 메시지를 수집하여 로컬 텍스트 파일로 저장하는 경량 CLI(명령줄 인터페이스) 도구입니다.

Node.js 환경을 기반으로 개발되었지만, **모든 운영체제(Windows, Linux, macOS)에서 추가 설치 없이 즉시 실행 가능한 독립형 실행 파일(.exe 등) 형태로 패키징**되어 있어 누구나 쉽게 사용할 수 있습니다.

## 실행 화면 (Android Termux 환경)

![Chzzk Chat Crawler 실행 화면](https://azestkingscrown.com/uploads/1785671016469-1000126199.jpg)

## ✨ 주요 기능

- **스트리머 자동 검색**: 스트리머의 닉네임 또는 채널 ID를 입력하여 정확한 대상을 검색하고 확인할 수 있습니다.
- **방종/뱅온 감지**: 스트리머가 오프라인일 때는 주기적으로 방송 상태를 확인(모니터링)하고, 방송이 시작되면 자동으로 채팅 수집을 시작합니다.
- **안정적인 실시간 수집**: 네이버 치지직 공식 웹소켓(WebSocket) 규격(Ping/Pong)을 완벽히 구현하여, 장시간 수집 시에도 끊김이나 메시지 누락 없이 안정적으로 작동합니다.
- **사용자 고유 ID(UID) 수집**: 닉네임이 변경되어도 동일한 사용자를 식별할 수 있는 해시 기반 고유 ID를 수집합니다. 시작 시 로그 파일에 기록할지 여부를 선택할 수 있습니다.
- **가독성을 높인 로깅**:
  - `익명의 후원자` 처리 및 후원 금액 명시
  - 이모티콘 단독 전송 및 텍스트 내 이모티콘을 `[이모티콘]`으로 깔끔하게 정규화
  - 메시지 앞 타임스탬프를 **방송 진행 시간**(예: `02시간 15분 30초`) 기준으로 정확히 계산하여 표시
- **단일 실행 파일 제공**: 윈도우 사용자는 GUI 프로그램처럼 더블클릭만 하면 자동으로 터미널(CMD) 창이 열리며 실행됩니다.

> [!WARNING]
> **Windows 방화벽 / SmartScreen 경고 안내**
> 본 프로그램은 1인/오픈소스 개발로 제작되어 고가의 '디지털 서명 인증서'가 포함되어 있지 않습니다.
> 이로 인해 Windows 환경에서 실행 시 **"PC 보호"** 또는 **"안전하지 않은 앱"** 경고 창이 나타날 수 있습니다.
> 이는 윈도우의 기본 보안 정책일 뿐 바이러스가 아니니 안심하셔도 됩니다.
>
> **해결 방법**: 경고 창이 뜨면 **[추가 정보]**를 클릭한 후 **[실행]** 버튼을 누르시면 정상적으로 프로그램이 켜집니다. 소스 코드는 이 저장소에 모두 투명하게 공개되어 있습니다.

## 🚀 사용 방법

### 1. 프로그램 실행

운영체제와 CPU 아키텍처(x64 / ARM64)에 맞는 버전을 다운로드하여 실행합니다.

| 운영체제 | 아키텍처 | 파일명 | 실행 방법 |
|---------|---------|--------|---------|
| Windows | x64 (일반 PC) | `chzzk-chat-collector-win-x64.exe` | 더블클릭 |
| Windows | ARM64 | `chzzk-chat-collector-win-arm64.exe` | 더블클릭 |
| Linux | x64 | `chzzk-chat-collector-linux-x64` | `./chzzk-chat-collector-linux-x64` |
| Linux | ARM64 | `chzzk-chat-collector-linux-arm64` | `./chzzk-chat-collector-linux-arm64` |
| macOS | Intel | `chzzk-chat-collector-macos-x64` | `./chzzk-chat-collector-macos-x64` |
| macOS | Apple Silicon | `chzzk-chat-collector-macos-arm64` | `./chzzk-chat-collector-macos-arm64` |

> [!NOTE]
> **Linux / macOS 권한 설정**: 처음 실행 시 권한 오류가 발생하면 아래 명령어로 실행 권한을 부여하세요.
> ```bash
> chmod +x ./chzzk-chat-collector-linux-x64
> ```

### 2. Android (Termux) 환경 특수 구동

일반적인 ARM 리눅스는 위에서 제공하는 `linux-arm64` 파일을 그대로 사용하시면 됩니다.
하지만 **안드로이드 스마트폰(Termux)** 환경은 리눅스와 내부 구조(라이브러리)가 달라 배포된 실행 파일을 사용할 수 없습니다. 이 경우 아래와 같이 소스 코드를 직접 구동해 주세요.

```bash
# 1. Node.js 및 Git 설치 (Termux)
pkg update && pkg upgrade
pkg install nodejs git

# 2. 소스 코드 다운로드 및 의존성 설치
git clone https://github.com/azestkingscrown/Chzzk-Chat-Crawler.git
cd Chzzk-Chat-Crawler
npm install

# 3. 프로그램 실행
node index.js
```

### 3. 스트리머 선택

프로그램이 켜지면 스트리머의 닉네임(예: `강소연`)을 입력합니다.
검색 결과가 맞는지 확인(Y/n)하면 다음 단계로 넘어갑니다.

### 4. UID 기록 설정 (선택)

스트리머 확인 후 사용자 고유 ID(UID) 기록 여부를 묻습니다.

```
┌─ UID 기록 설정 ─────────────────────────────┐
  사용자 고유 ID(UID)를 로그 파일에 기록할지
  선택하세요. UID는 닉네임 변경 시에도 동일한
  사용자를 식별할 수 있는 해시값입니다.
└───────────────────────────────────────┘
UID를 로그에 기록하시겠습니까? (y/N):
```

- **`N` (기본값)**: 닉네임만 기록합니다.
  ```
  [00시간 01분 23초] 닉네임: 메시지 내용
  ```
- **`y`**: UID를 닉네임 앞에 함께 기록합니다.
  ```
  [00시간 01분 23초] [a1b2c3d4...] 닉네임: 메시지 내용
  ```

### 5. 로그 확인

실행 중인 파일과 같은 위치에 `logs` 폴더가 자동으로 생성되며,
`스트리머명_YYYYMMDD_HHMMSS.txt` 형식으로 채팅 내역이 실시간으로 저장됩니다.
수집을 종료하고 싶다면 터미널에서 `Ctrl + C`를 누르시면 됩니다.

## 💻 시스템 요구 사양

이 프로그램은 불필요한 GUI를 제거하고 최적화된 CLI(명령줄) 기반으로 동작하므로 극도로 가볍습니다. 저사양 미니 PC나 가상 머신(Tiny10 등)에서도 원활하게 24시간 구동이 가능합니다.

- **OS**: Windows 10/11 (64bit), Linux, macOS, Android (Termux)
- **CPU**: 1 Core, 1.0 GHz 이상 (채팅량이 매우 많은 대형 방송이라도 CPU 점유율은 1% 미만입니다.)
- **RAM**: 남은 용량 512 MB 이상 (버퍼링 최적화가 되어 있어 보통 50~100MB 내외의 메모리만 사용합니다.)
- **저장장치 (디스크)**:
  - 프로그램 파일 자체는 약 50MB 내외입니다.
  - 로그 파일 저장을 위해 여유 공간 **1GB 이상** 권장 (수만 줄의 텍스트가 쌓여도 몇 MB 수준이지만, 장기간 매일 수집할 경우를 대비)
- **네트워크**: 대형 스트리머의 폭발적인 채팅을 누락 없이 수신하기 위해 **안정적인 유선(LAN) 인터넷 환경**을 강력히 권장합니다.

## 🛠 빌드 방법 (고급 사용자용)

직접 소스 코드를 수정하고 실행 파일을 다시 빌드하고 싶은 경우 아래 명령어를 사용합니다.

```bash
# 의존성 설치
npm install

# 전체 플랫폼 빌드 (dist 폴더에 생성됨)
# macOS 바이너리는 자동으로 ad-hoc 서명이 적용됩니다.
npm run build

# 특정 플랫폼만 빌드
npm run build:win-x64
npm run build:win-arm64
npm run build:mac-x64
npm run build:mac-arm64
npm run build:linux-x64
npm run build:linux-arm64
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.

| 명령어 | 생성 파일 |
|--------|---------|
| `build:win-x64` | `dist/chzzk-chat-collector-win-x64.exe` |
| `build:win-arm64` | `dist/chzzk-chat-collector-win-arm64.exe` |
| `build:mac-x64` | `dist/chzzk-chat-collector-macos-x64` |
| `build:mac-arm64` | `dist/chzzk-chat-collector-macos-arm64` |
| `build:linux-x64` | `dist/chzzk-chat-collector-linux-x64` |
| `build:linux-arm64` | `dist/chzzk-chat-collector-linux-arm64` |

> [!NOTE]
> **macOS 서명 자동화**: `npm run build` 실행 시 Mac 없이도 `rcodesign` 도구를 자동으로 다운로드하여
> macOS 바이너리에 ad-hoc 서명을 적용합니다. Apple Silicon에서 실행하려면 반드시 서명이 필요합니다.

## 자주 묻는 질문 (FAQ)

**Q: 채팅 수집이 안 돼요!**

- **A1**: 스트리머가 해외 시청 차단을 설정한 경우, 한국 IP를 이용하시면 해결됩니다. 해외 IP를 사용하시는 경우 스트리머가 제한을 풀지 않는 한 수집이 불가능합니다.
- **A2**: 스트리머가 설정한 카테고리에 `[같이보기]`가 있다면 저작권 상 수집이 불가능합니다.
- **A3**: 미성년자 시청 제한 방송은 수집이 안 됩니다.

**Q: 닉네임으로 검색했는데 다른 사람이 나와요.**

- **A**: 검색 결과 중 인지도가 가장 높은 채널을 우선적으로 가져옵니다. 만약 결과가 다르다면 스트리머의 32자리 고유 채널 ID를 직접 입력해 주세요.

**Q: UID가 뭔가요?**

- **A**: UID(User ID Hash)는 치지직이 각 사용자에게 부여하는 고유 해시값입니다. 닉네임은 사용자가 변경할 수 있지만, UID는 변하지 않기 때문에 동일 사용자를 추적하거나 데이터 분석 시 유용합니다.

## 📝 라이선스

이 프로젝트는 자유롭게 수정 및 배포할 수 있습니다.
