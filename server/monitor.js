require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Discord 봇 설정
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_LOGGING_ENABLED = process.env.DISCORD_LOGGING_ENABLED === 'true';

// 모니터링 설정
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';
const CHECK_INTERVAL = process.env.CHECK_INTERVAL ? parseInt(process.env.CHECK_INTERVAL) : 60000; // 기본 1분마다 체크
const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 3; // 기본 3번 재시도

// 상태 파일 경로
const STATUS_FILE = path.join(__dirname, 'server_status.json');

// 초기 상태
let lastStatus = {
  online: false,
  lastChecked: null,
  lastOnline: null,
  lastOffline: null,
  retryCount: 0,
  notified: false
};

// 상태 파일 로드
function loadStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const data = fs.readFileSync(STATUS_FILE, 'utf8');
      lastStatus = JSON.parse(data);
      console.log('이전 상태 로드됨:', lastStatus);
    } else {
      console.log('상태 파일이, 새로운 파일을 생성합니다.');
      saveStatus();
    }
  } catch (error) {
    console.error('상태 파일 로드 실패:', error);
  }
}

// 상태 저장
function saveStatus() {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(lastStatus, null, 2), 'utf8');
  } catch (error) {
    console.error('상태 파일 저장 실패:', error);
  }
}

// Discord 봇 초기화
let discordBot = null;
if (DISCORD_LOGGING_ENABLED && DISCORD_BOT_TOKEN) {
  discordBot = new Client({ 
    intents: [
      GatewayIntentBits.Guilds, 
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });
  
  discordBot.once('ready', () => {
    console.log(`모니터링 봇이 준비되었습니다: ${discordBot.user.tag}`);
  });
  
  discordBot.login(DISCORD_BOT_TOKEN)
    .then(() => console.log('Discord 봇 로그인 성공'))
    .catch(error => console.error('Discord 봇 로그인 실패:', error));
}

// Discord 알림 전송
async function sendDiscordAlert(online) {
  if (!DISCORD_LOGGING_ENABLED || !discordBot || !discordBot.isReady()) {
    console.log('Discord 봇이 준비되지 않았거나 로깅이 비활성화되었습니다.');
    return;
  }
  
  try {
    const channel = await discordBot.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) {
      console.error(`채널을 찾을 수 없습니다: ${DISCORD_CHANNEL_ID}`);
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle(online ? '✅ 서버 복구 알림' : '🚨 서버 다운 알림')
      .setColor(online ? 5763719 : 15548997) // 초록색 또는 빨간색
      .setDescription(online 
        ? '@everyone\n서버가 복구되었습니다. 서비스를 이용할 수 있습니다.'
        : '@everyone\n서버가 다운되었습니다. 서비스 이용이 불가능합니다.')
      .setTimestamp()
      .addFields({
        name: '마지막 체크 시간',
        value: new Date().toLocaleString()
      })
      .setFooter({ text: 'VIP+ 서버 모니터링' });
    
    await channel.send({ content: '@everyone', embeds: [embed] });
    console.log(`Discord 알림 전송 성공: 서버 ${online ? '복구' : '다운'}`);
    
    // 알림 전송 상태 업데이트
    lastStatus.notified = true;
    saveStatus();
  } catch (error) {
    console.error('Discord 알림 전송 실패:', error);
  }
}

// 서버 상태 확인
async function checkServerStatus() {
  console.log(`서버 상태 확인 중... (${new Date().toLocaleString()})`);
  lastStatus.lastChecked = new Date().toISOString();
  
  try {
    const response = await fetch(SERVER_URL, { timeout: 10000 });
    if (response.ok) {
      console.log('서버 온라인 확인됨');
      
      // 서버가 다시 온라인 상태가 되었을 때
      if (!lastStatus.online && lastStatus.lastOffline) {
        console.log('서버가 다시 온라인 상태가 되었습니다.');
        await sendDiscordAlert(true);
      }
      
      lastStatus.online = true;
      lastStatus.lastOnline = new Date().toISOString();
      lastStatus.retryCount = 0;
      lastStatus.notified = false;
    } else {
      handleServerDown('응답 코드 오류');
    }
  } catch (error) {
    handleServerDown(`연결 오류: ${error.message}`);
  }
  
  saveStatus();
}

// 서버 다운 처리
async function handleServerDown(reason) {
  console.log(`서버 다운 감지: ${reason}`);
  
  lastStatus.retryCount++;
  console.log(`재시도 횟수: ${lastStatus.retryCount}/${MAX_RETRIES}`);
  
  if (lastStatus.retryCount >= MAX_RETRIES) {
    if (lastStatus.online || !lastStatus.notified) {
      // 서버가 이전에 온라인이었거나 아직 알림을 보내지 않았을 때
      lastStatus.online = false;
      lastStatus.lastOffline = new Date().toISOString();
      await sendDiscordAlert(false);
    }
  }
}

// 모니터링 시작
function startMonitoring() {
  console.log(`서버 모니터링 시작 - 간격: ${CHECK_INTERVAL}ms`);
  loadStatus();
  
  // 첫 번째 검사 즉시 실행
  checkServerStatus();
  
  // 정기적으로 검사
  setInterval(checkServerStatus, CHECK_INTERVAL);
}

// 메인 실행
startMonitoring(); 