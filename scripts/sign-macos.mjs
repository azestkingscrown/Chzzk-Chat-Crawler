/**
 * macOS 바이너리 자동 서명 스크립트
 *
 * Mac 없이 Linux에서 rcodesign(apple-platform-rs)을 사용해
 * dist/의 macOS 바이너리에 ad-hoc 서명을 적용합니다.
 *
 * rcodesign이 없으면 자동으로 다운로드합니다.
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const TOOLS_DIR = join(ROOT, '.tools');

const RCODESIGN_VERSION = '0.29.0';
const RCODESIGN_RELEASES = {
    'linux-arm64':  `https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    'linux-x64':    `https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    'darwin-arm64': null, // Mac에서는 codesign 사용
    'darwin-x64':   null,
    'win32-x64':    null,
};

const MAC_BINARIES = [
    join(DIST, 'chzzk-chat-collector-macos-x64'),
    join(DIST, 'chzzk-chat-collector-macos-arm64'),
];

function log(msg) { console.log(`  \x1b[36m[서명]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m[경고]\x1b[0m ${msg}`); }
function ok(msg)   { console.log(`  \x1b[32m[✓]\x1b[0m ${msg}`); }

// ── Mac인 경우: 기본 codesign 사용 ──
function signWithCodesign(bin) {
    log(`codesign 서명 중: ${bin}`);
    const r = spawnSync('codesign', ['--sign', '-', bin], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`codesign 실패: ${bin}`);
    ok(`서명 완료: ${bin}`);
}

// ── Linux/Windows: rcodesign 다운로드 후 사용 ──
function getRcodesignPath() {
    const platform = `${os.platform()}-${os.arch() === 'arm64' ? 'arm64' : 'x64'}`;
    const toolBin = join(TOOLS_DIR, 'rcodesign');
    if (existsSync(toolBin)) return toolBin;

    const url = RCODESIGN_RELEASES[platform];
    if (!url) throw new Error(`이 플랫폼(${platform})에서는 rcodesign 자동 설치가 지원되지 않습니다.`);

    log(`rcodesign v${RCODESIGN_VERSION} 다운로드 중...`);
    mkdirSync(TOOLS_DIR, { recursive: true });

    const tmpTar = join(os.tmpdir(), 'rcodesign.tar.gz');
    execSync(`curl -sL "${url}" -o "${tmpTar}"`);
    execSync(`tar -xzf "${tmpTar}" -C "${TOOLS_DIR}" --strip-components=1 --wildcards "*/rcodesign"`);

    if (!existsSync(toolBin)) throw new Error('rcodesign 압축 해제 실패');
    chmodSync(toolBin, 0o755);
    ok('rcodesign 준비 완료');
    return toolBin;
}

function signWithRcodesign(rcodesign, bin) {
    log(`rcodesign 서명 중: ${bin}`);
    const r = spawnSync(rcodesign, ['sign', bin], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`rcodesign 서명 실패: ${bin}`);
    ok(`서명 완료: ${bin}`);
}

// ── 메인 ──
const platform = os.platform();
const missing = MAC_BINARIES.filter(b => !existsSync(b));

if (missing.length === MAC_BINARIES.length) {
    warn('macOS 바이너리를 찾을 수 없습니다. 서명 단계를 건너뜁니다.');
    process.exit(0);
}

const targets = MAC_BINARIES.filter(b => existsSync(b));
console.log(`\n  macOS 바이너리 서명 (${targets.length}개)\n`);

try {
    if (platform === 'darwin') {
        for (const bin of targets) signWithCodesign(bin);
    } else {
        const rcodesign = getRcodesignPath();
        for (const bin of targets) signWithRcodesign(rcodesign, bin);
    }
    console.log('');
} catch (err) {
    warn(`서명 실패: ${err.message}`);
    warn('macOS 바이너리는 Apple Silicon(M1/M2/M3)에서 실행되지 않을 수 있습니다.');
    warn('Intel Mac에서는 터미널 실행 시 quarantine 해제 후 사용 가능합니다.');
    process.exit(0); // 빌드 전체를 실패시키지는 않음
}
