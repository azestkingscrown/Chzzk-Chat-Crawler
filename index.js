import axios from 'axios';
import WebSocket from 'ws';
import { createInterface } from 'readline';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ===== 설정 =====
const LOG_DIR = join(process.cwd(), 'logs');
const POLL_INTERVAL = 30_000;   // 방송 상태 체크 간격 (30초)
const PING_INTERVAL = 20_000;   // WebSocket 핑 간격 (20초)
const RECONNECT_DELAY = 5_000;  // WebSocket 재연결 대기 (5초)
const FLUSH_INTERVAL = 3_000;   // 로그 파일 flush 간격 (3초)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const API = {
    search:     (keyword) => `https://api.chzzk.naver.com/service/v1/search/channels?keyword=${encodeURIComponent(keyword)}&size=5`,
    liveDetail: (id)      => `https://api.chzzk.naver.com/service/v2/channels/${id}/live-detail`,
    liveStatus: (id)      => `https://api.chzzk.naver.com/polling/v2/channels/${id}/live-status`,
    chatToken:  (chatId)  => `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${chatId}&chatType=STREAMING`,
};

// ===== ANSI 컬러 =====
const C = {
    reset: '\x1b[0m',  bold: '\x1b[1m',   dim: '\x1b[2m',
    red: '\x1b[31m',   green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m',  magenta: '\x1b[35m', gray: '\x1b[90m',
};

// ===== 유틸리티 =====
function now() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getUptime(openDateStr) {
    if (!openDateStr) return '00시간 00분 00초';
    // KST 기준으로 파싱
    const startMs = new Date(openDateStr.replace(' ', 'T') + '+09:00').getTime();
    const diff = Math.max(0, Date.now() - startMs);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}시간 ${p(m)}분 ${p(s)}초`;
}

function log(tag, color, msg) {
    console.log(`${C.gray}[${now()}]${C.reset} ${color}[${tag}]${C.reset} ${msg}`);
}

function datestamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function ask(rl, question) {
    return new Promise((resolve, reject) => {
        rl.question(question, resolve);
        rl.once('close', () => reject(new Error('입력이 종료되었습니다.')));
    });
}

// ===== HTTP 클라이언트 =====
const http = axios.create({
    timeout: 8000,
    headers: { 'User-Agent': USER_AGENT },
});

// ===== API 함수 =====

/** 스트리머 이름으로 검색 */
async function searchStreamer(keyword) {
    const { data } = await http.get(API.search(keyword));
    if (data.code === 200 && data.content?.data?.length > 0) {
        const ch = data.content.data[0].channel;
        return {
            channelId: ch.channelId,
            channelName: ch.channelName,
            followerCount: ch.followerCount,
            verifiedMark: ch.verifiedMark,
        };
    }
    return null;
}

/** 채널 ID로 직접 정보 조회 (live-detail 이용) */
async function getChannelByID(channelId) {
    const { data } = await http.get(API.liveDetail(channelId));
    if (data.code === 200 && data.content?.channel) {
        const ch = data.content.channel;
        return {
            channelId: ch.channelId || channelId,
            channelName: ch.channelName,
            followerCount: ch.channelFollowerCount,
        };
    }
    return null;
}

/** 방송 상태 확인 (OPEN / CLOSE) */
async function getLiveStatus(channelId) {
    const { data } = await http.get(API.liveStatus(channelId));
    if (data.code === 200 && data.content) {
        return {
            status: data.content.status,
            liveTitle: data.content.liveTitle,
            chatChannelId: data.content.chatChannelId,
            openDate: data.content.openDate,
        };
    }
    return null;
}

/** 채팅 액세스 토큰 발급 (비로그인) */
async function getChatToken(chatChannelId) {
    const { data } = await http.get(API.chatToken(chatChannelId));
    if (data.code === 200 && data.content) {
        return {
            accessToken: data.content.accessToken,
            extraToken: data.content.extraToken,
        };
    }
    return null;
}

// ===== WebSocket 채팅 =====

/** 채팅 서버 번호 계산 */
function serverNumber(chatChannelId) {
    let sum = 0;
    for (const ch of chatChannelId) sum += ch.charCodeAt(0);
    return (sum % 9) + 1;
}

/**
 * 채팅 WebSocket 연결
 * @returns {{ disconnect: Function, isConnected: boolean }}
 */
function connectChat(chatChannelId, accessToken, callbacks) {
    const num = serverNumber(chatChannelId);
    const url = `wss://kr-ss${num}.chat.naver.com/chat`;
    const ws = new WebSocket(url);
    let pingTimer = null;
    let tid = 1;
    let closed = false;

    function clearPing() {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    }

    ws.on('open', () => {
        // 채팅방 입장 등록 (cmd 100)
        ws.send(JSON.stringify({
            ver: '2', cmd: 100, svcid: 'game', cid: chatChannelId,
            bdy: { uid: null, devType: 2001, accTkn: accessToken, auth: 'READ' },
            tid: tid++,
        }));

        clearPing(); // 중복 타이머 방지
        pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ ver: '2', cmd: 10000 }));
            }
        }, PING_INTERVAL);

        callbacks.onConnect?.();
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());

            // 서버 핑(cmd 0)에 대한 퐁(cmd 10000) 응답
            if (data.cmd === 0) {
                ws.send(JSON.stringify({ ver: '2', cmd: 10000 }));
                return;
            }

            // 일반 채팅 메시지 (cmd 93101)
            if (data.cmd === 93101 && Array.isArray(data.bdy)) {
                for (const m of data.bdy) {
                    try {
                        const profile = JSON.parse(m.profile || '{}');
                        let msg = m.msg || '';
                        if (!msg && m.msgTypeCode) msg = '[이모티콘]';
                        callbacks.onChat?.({
                            nickname: profile.nickname || '알 수 없음',
                            message: msg.replace(/\{:[^}]+:\}/g, '[이모티콘]'),
                        });
                    } catch { /* 파싱 실패 건 스킵 */ }
                }
            }

            // 후원 메시지 (cmd 93102)
            if (data.cmd === 93102 && Array.isArray(data.bdy)) {
                for (const m of data.bdy) {
                    try {
                        const profile = JSON.parse(m.profile || '{}');
                        const extras = m.extras ? JSON.parse(m.extras) : {};
                        callbacks.onDonation?.({
                            nickname: profile.nickname || '익명의 후원자',
                            message: (m.msg || '').replace(/\{:[^}]+:\}/g, '[이모티콘]'),
                            amount: extras.payAmount || 0,
                        });
                    } catch { /* 파싱 실패 건 스킵 */ }
                }
            }
        } catch { /* JSON 파싱 오류 무시 */ }
    });

    ws.on('close', (code) => {
        clearPing();
        if (!closed) callbacks.onDisconnect?.(code);
    });

    ws.on('error', (err) => {
        callbacks.onError?.(err);
    });

    return {
        disconnect() {
            closed = true;
            clearPing();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        },
        get isConnected() { return ws.readyState === WebSocket.OPEN; },
    };
}

// ===== 로그 버퍼 (I/O 최적화) =====

class LogBuffer {
    constructor(filePath) {
        this.filePath = filePath;
        this.buffer = [];
        this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL);
    }
    append(line) {
        this.buffer.push(line);
    }
    flush() {
        if (this.buffer.length === 0) return;
        try {
            appendFileSync(this.filePath, this.buffer.join('\n') + '\n', 'utf8');
            this.buffer = [];
        } catch (err) {
            // 파일 쓰기 실패 시 버퍼 유지 (다음 flush에서 재시도)
        }
    }
    close() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        this.flush();
    }
}

// ===== 모니터링 & 수집 =====

async function startMonitoring(streamer) {
    const { channelId, channelName } = streamer;

    log('모니터링', C.magenta,
        `${C.bold}${channelName}${C.reset}${C.magenta}님의 방송 상태를 감시합니다 (${POLL_INTERVAL / 1000}초 간격)`);
    log('안내', C.dim, 'Ctrl+C를 누르면 수집을 종료합니다.\n');

    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

    let collecting = false;
    let chat = null;
    let logFile = null;
    let logBuffer = null;
    let msgCount = 0;
    let reconnecting = false;
    let currentLiveInfo = null;

    // ── 종료 핸들러 ──
    const cleanup = () => {
        console.log('');
        log('종료', C.yellow, '수집을 종료합니다...');
        if (chat) chat.disconnect();
        if (logBuffer) {
            if (msgCount > 0 && logFile) {
                logBuffer.append(`\n${'='.repeat(50)}\n수집 종료: ${new Date().toLocaleString('ko-KR')}\n총 수집 메시지: ${msgCount}개`);
            }
            logBuffer.close();
            log('저장', C.green, `총 ${C.bold}${msgCount}${C.reset}${C.green}개 메시지 → ${logFile}`);
        }
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // ── WebSocket 즉시 재연결 ──
    async function reconnect(liveInfo) {
        if (reconnecting) return;
        reconnecting = true;

        log('재연결', C.yellow, `${RECONNECT_DELAY / 1000}초 후 채팅 서버에 재연결을 시도합니다...`);
        await new Promise(r => setTimeout(r, RECONNECT_DELAY));

        try {
            // 방송이 아직 켜져있는지 먼저 확인
            const live = await getLiveStatus(channelId);
            if (!live || live.status !== 'OPEN' || !live.chatChannelId) {
                log('재연결', C.yellow, '방송이 종료된 것으로 확인되어 재연결을 중단합니다.');
                endCollection();
                reconnecting = false;
                return;
            }

            // 새 토큰 발급 후 재연결
            const token = await getChatToken(live.chatChannelId);
            if (!token) throw new Error('채팅 토큰 재발급 실패');

            currentLiveInfo = live;
            chat = connectChat(live.chatChannelId, token.accessToken, makeChatCallbacks(live));
            collecting = true;
        } catch (err) {
            log('에러', C.red, `재연결 실패: ${err.message} — 다음 폴링에서 재시도합니다.`);
            collecting = false;
            chat = null;
        }
        reconnecting = false;
    }

    // ── 채팅 콜백 팩토리 ──
    function makeChatCallbacks(liveInfo) {
        return {
            onConnect() {
                log('채팅', C.cyan, '채팅 서버 연결 완료 — 실시간 수집 중...\n');
            },
            onChat({ nickname, message }) {
                const t = getUptime(liveInfo.openDate);
                const line = `[${t}] ${nickname}: ${message}`;
                console.log(`  ${C.gray}${t}${C.reset}  ${C.cyan}${nickname}${C.reset}: ${message}`);
                logBuffer?.append(line);
                msgCount++;
            },
            onDonation({ nickname, message, amount }) {
                const t = getUptime(liveInfo.openDate);
                const line = `[${t}] [💰후원 ${amount.toLocaleString()}원] ${nickname}: ${message}`;
                console.log(`  ${C.yellow}${C.bold}${t}  [💰후원 ${amount.toLocaleString()}원] ${nickname}: ${message}${C.reset}`);
                logBuffer?.append(line);
                msgCount++;
            },
            onDisconnect(code) {
                if (collecting) {
                    log('연결끊김', C.yellow, `채팅 서버 연결이 해제되었습니다. (code: ${code || 'N/A'})`);
                    collecting = false;
                    chat = null;
                    // 방송 중 끊김이면 즉시 재연결 시도
                    reconnect(liveInfo);
                }
            },
            onError(err) {
                log('에러', C.red, `WebSocket 오류: ${err.message}`);
            },
        };
    }

    // ── 채팅 연결 시작 ──
    async function beginCollection(liveInfo) {
        collecting = true;
        msgCount = 0;
        currentLiveInfo = liveInfo;
        const startTime = new Date();
        logFile = join(LOG_DIR, `${channelName}_${datestamp(startTime)}.txt`);

        console.log('');
        log('🔴 뱅온', `${C.green}${C.bold}`, `${channelName}님이 방송을 시작했습니다!`);
        log('제목', C.green, liveInfo.liveTitle || 'N/A');
        log('파일', C.green, logFile);
        console.log('');

        // 파일 헤더
        const header = [
            '='.repeat(50),
            `치지직 채팅 로그`,
            `스트리머: ${channelName}`,
            `방송 제목: ${liveInfo.liveTitle || 'N/A'}`,
            `수집 시작: ${startTime.toLocaleString('ko-KR')}`,
            '='.repeat(50), '',
        ].join('\n');
        writeFileSync(logFile, header + '\n', 'utf8');
        logBuffer = new LogBuffer(logFile);

        try {
            const token = await getChatToken(liveInfo.chatChannelId);
            if (!token) throw new Error('채팅 토큰 발급 실패');

            chat = connectChat(liveInfo.chatChannelId, token.accessToken, makeChatCallbacks(liveInfo));
        } catch (err) {
            log('에러', C.red, `채팅 연결 실패: ${err.message}`);
            collecting = false;
        }
    }

    // ── 수집 종료 처리 ──
    function endCollection() {
        collecting = false;
        if (chat) { chat.disconnect(); chat = null; }

        console.log('');
        log('⚫ 방종', `${C.red}${C.bold}`, `${channelName}님의 방송이 종료되었습니다.`);

        if (logBuffer) {
            if (msgCount > 0 && logFile) {
                logBuffer.append(`\n${'='.repeat(50)}\n수집 종료: ${new Date().toLocaleString('ko-KR')}\n총 수집 메시지: ${msgCount}개`);
            }
            logBuffer.close();
            logBuffer = null;
            log('저장', C.green, `총 ${C.bold}${msgCount}${C.reset}${C.green}개 메시지 저장 완료`);
        }
        console.log('');
        log('모니터링', C.magenta, '방송 대기 상태로 전환합니다...\n');
    }

    // ── 주기적 폴링 ──
    async function poll() {
        try {
            const live = await getLiveStatus(channelId);

            if (live && live.status === 'OPEN' && live.chatChannelId) {
                // 방송 중 + 아직 수집 안 하고 있으면 시작
                if (!collecting && !reconnecting) await beginCollection(live);
            } else {
                // 방송 종료 또는 오프라인
                if (collecting) endCollection();
                else if (!reconnecting) process.stdout.write(`\r${C.gray}[${now()}] [대기중] ${channelName}님의 방송을 기다리는 중...${C.reset}  `);
            }
        } catch (err) {
            // 네트워크 오류
            if (collecting) {
                log('경고', C.yellow, `상태 확인 중 네트워크 오류: ${err.message} (수집은 계속됩니다)`);
            } else {
                process.stdout.write(`\r${C.gray}[${now()}] [대기중] 상태 확인 중... (재시도)${C.reset}         `);
            }
        }
    }

    await poll();
    setInterval(poll, POLL_INTERVAL);
}

// ===== 메인 =====

async function main() {
    console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════╗
║        치지직 실시간 채팅 수집기 v1.0        ║
╚══════════════════════════════════════════════╝${C.reset}
`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let streamer = null;

    // ── 검색 루프 (확인될 때까지 반복) ──
    while (!streamer) {
        const input = (await ask(rl, `${C.yellow}스트리머 이름 또는 채널 ID를 입력하세요:${C.reset} `)).trim();
        if (!input) { log('에러', C.red, '입력값이 비어있습니다.\n'); continue; }

        log('검색', C.cyan, `"${input}" 검색 중...`);

        try {
            const isId = /^[0-9a-f]{32}$/i.test(input);
            const result = isId ? await getChannelByID(input) : await searchStreamer(input);

            if (!result) {
                log('결과', C.red, '스트리머를 찾을 수 없습니다. 다시 입력해 주세요.\n');
                continue;
            }

            // 결과 표시
            console.log(`
${C.green}${C.bold}┌─ 검색 결과 ─────────────────────────────────┐${C.reset}
  스트리머:  ${C.bold}${C.cyan}${result.channelName}${C.reset}
  채널 ID:  ${C.dim}${result.channelId}${C.reset}${
    result.followerCount != null
        ? `\n  팔로워:   ${result.followerCount.toLocaleString()}명` : ''}
${C.green}${C.bold}└──────────────────────────────────────────────┘${C.reset}
  ${C.yellow}이 스트리머가 맞는지 해당 링크를 확인하세요:${C.reset}
  ${C.cyan}${C.bold}https://chzzk.naver.com/${result.channelId}${C.reset}
`);

            const confirm = (await ask(rl, `${C.yellow}수집을 시작하시겠습니까? (Y/n):${C.reset} `)).trim();
            if (confirm.toLowerCase() === 'n') { console.log(''); continue; }

            streamer = result;
        } catch (err) {
            log('에러', C.red, `검색 중 오류: ${err.message}\n`);
        }
    }

    rl.close();
    console.log('');

    await startMonitoring(streamer);
}

main().catch(err => {
    log('치명적 오류', C.red, err.message);
    process.exit(1);
});
