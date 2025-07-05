require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const NodeGeocoder = require('node-geocoder');

// 기본 설정
const app = express();
const port = process.env.PORT || 4000;

// 캐싱 시스템 설정
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5분 (5 * 60 * 1000ms)
const MAX_CACHE_SIZE = 100; // 최대 캐시 항목 수

// 캐시 유틸리티 함수들
const cacheUtils = {
  // 캐시에 데이터 저장
  set: (key, data, ttl = CACHE_TTL) => {
    const now = Date.now();
    cache.set(key, {
      data,
      timestamp: now,
      ttl: now + ttl
    });
    
    // 캐시 크기 제한 확인
    if (cache.size > MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    
    console.log(`캐시 저장: ${key} (TTL: ${new Date(now + ttl).toLocaleTimeString()})`);
  },
  
  // 캐시에서 데이터 가져오기
  get: (key) => {
    const item = cache.get(key);
    if (!item) {
      console.log(`캐시 미스: ${key}`);
      return null;
    }
    
    const now = Date.now();
    if (now > item.ttl) {
      cache.delete(key);
      console.log(`캐시 만료: ${key}`);
      return null;
    }
    
    console.log(`캐시 히트: ${key}`);
    return item.data;
  },
  
  // 캐시 삭제
  delete: (key) => {
    cache.delete(key);
    console.log(`캐시 삭제: ${key}`);
  },
  
  // 캐시 전체 정리 (만료된 항목들)
  cleanup: () => {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [key, item] of cache.entries()) {
      if (now > item.ttl) {
        cache.delete(key);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`캐시 정리 완료: ${deletedCount}개 항목 삭제`);
    }
  },
  
  // 캐시 상태 확인
  status: () => {
    const now = Date.now();
    const validItems = Array.from(cache.entries()).filter(([key, item]) => now <= item.ttl);
    return {
      total: cache.size,
      valid: validItems.length,
      expired: cache.size - validItems.length
    };
  }
};

// 주기적 캐시 정리 (5분마다)
setInterval(() => {
  cacheUtils.cleanup();
}, 5 * 60 * 1000);

// Discord 봇 설정
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_AGENT_CHANNEL_ID = process.env.DISCORD_AGENT_CHANNEL_ID || DISCORD_CHANNEL_ID; // 관리자 채널 (없으면 기본 채널 사용)
const DISCORD_STORE_CHANNEL_ID = process.env.DISCORD_STORE_CHANNEL_ID || DISCORD_CHANNEL_ID; // 일반 매장 채널 (없으면 기본 채널 사용)
const DISCORD_LOGGING_ENABLED = process.env.DISCORD_LOGGING_ENABLED === 'true';

// 디스코드 봇 및 관련 라이브러리는 필요한 경우에만 초기화
let discordBot = null;
let EmbedBuilder = null;

if (DISCORD_LOGGING_ENABLED && DISCORD_BOT_TOKEN) {
  try {
    const { Client, GatewayIntentBits } = require('discord.js');
    ({ EmbedBuilder } = require('discord.js'));
    
    // 디스코드 봇 초기화
    discordBot = new Client({ 
      intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    
    // 봇 준비 이벤트
    discordBot.once('ready', () => {
      console.log(`봇이 준비되었습니다: ${discordBot.user.tag}`);
    });
    
    console.log('디스코드 봇 모듈 로딩 성공');
  } catch (error) {
    console.error('디스코드 봇 모듈 로딩 실패:', error.message);
  }
}

// 전역 오류 처리
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  
  // Discord에 오류 알림 전송
  if (DISCORD_LOGGING_ENABLED && discordBot) {
    try {
      // 봇이 준비되었는지 확인
      if (discordBot.isReady()) {
        if (DISCORD_CHANNEL_ID) {
          try {
            const channel = await discordBot.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) {
              // 에러 정보를 간결하게 정리
              const errorInfo = {
                message: error.message,
                stack: error.stack?.split('\n').slice(0, 5).join('\n') || '스택 정보 없음',
                time: new Date().toISOString()
              };
              
              const crashEmbed = new EmbedBuilder()
                .setTitle('🚨 서버 충돌 알림')
                .setColor(15548997) // 빨간색
                .setDescription('@everyone\n서버에 치명적인 오류가 발생했습니다. 서비스가 중단되었습니다.')
                .addFields({
                  name: '오류 정보',
                  value: `\`\`\`\n${errorInfo.message}\n${errorInfo.stack}\n\`\`\``
                })
                .setTimestamp()
                .setFooter({ text: 'VIP+ 서버 오류 알림' });
                
              console.log('충돌 알림 전송 시도 중...');
              await channel.send({ content: '@everyone', embeds: [crashEmbed] });
              console.log('서버 충돌 알림 메시지가 Discord로 전송되었습니다.');
            }
          } catch (discordError) {
            console.error('Discord 충돌 알림 전송 실패:', discordError);
          }
        }
      }
      
      // Discord 메시지 전송을 위한 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (discordError) {
      console.error('Discord 오류 알림 처리 중 추가 오류:', discordError);
    }
  }
  
  // 3초 후 프로세스 종료 (Discord 메시지 전송 시간 확보)
  setTimeout(() => {
    console.error('치명적인 오류로 인한 서버 종료');
    process.exit(1);
  }, 3000);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // 치명적이지 않은 경우 Discord에 경고 알림만 전송
  if (DISCORD_LOGGING_ENABLED && discordBot && discordBot.isReady()) {
    try {
      if (DISCORD_CHANNEL_ID) {
        const channel = await discordBot.channels.fetch(DISCORD_CHANNEL_ID);
        if (channel) {
          // 오류 정보 정리
          const errorInfo = {
            message: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error && reason.stack 
              ? reason.stack.split('\n').slice(0, 5).join('\n') 
              : '스택 정보 없음',
            time: new Date().toISOString()
          };
          
          const warningEmbed = new EmbedBuilder()
            .setTitle('⚠️ 서버 경고 알림')
            .setColor(16776960) // 노란색
            .setDescription('서버에서 처리되지 않은 Promise 거부가 발생했습니다.')
            .addFields({
              name: '오류 정보',
              value: `\`\`\`\n${errorInfo.message}\n${errorInfo.stack}\n\`\`\``
            })
            .setTimestamp()
            .setFooter({ text: 'VIP+ 서버 경고 알림' });
            
          await channel.send({ embeds: [warningEmbed] });
          console.log('서버 경고 알림 메시지가 Discord로 전송되었습니다.');
        }
      }
    } catch (discordError) {
      console.error('Discord 경고 알림 전송 실패:', discordError);
    }
  }
  
  // 처리되지 않은 Promise 거부를 기록하지만 프로세스는 계속 실행
});

// 모든 요청에 대한 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// CORS 설정
app.use(cors());
app.use(express.json());

// Google Sheets API configuration
const SPREADSHEET_ID = process.env.SHEET_ID;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

// 필수 환경 변수 검증
if (!SPREADSHEET_ID) {
  console.error('SHEET_ID is not defined in environment variables');
  process.exit(1);
}

if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  console.error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not defined in environment variables');
  process.exit(1);
}

if (!GOOGLE_PRIVATE_KEY) {
  console.error('GOOGLE_PRIVATE_KEY is not defined in environment variables');
  process.exit(1);
}

// 시트 이름 설정
const INVENTORY_SHEET_NAME = '폰클재고데이터';
const STORE_SHEET_NAME = '폰클출고처데이터';
const AGENT_SHEET_NAME = '대리점아이디관리';  // 대리점 아이디 관리 시트 추가

// Kakao geocoding 함수
async function geocodeAddressWithKakao(address) {
  const apiKey = process.env.KAKAO_API_KEY;
  if (!apiKey) {
    throw new Error('KAKAO_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }
  const encodedAddress = encodeURIComponent(address);
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodedAddress}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `KakaoAK ${apiKey}`
    }
  });
  if (!response.ok) {
    throw new Error(`Kakao geocoding API 오류: ${response.status}`);
  }
  const data = await response.json();
  if (data.documents && data.documents.length > 0) {
    const doc = data.documents[0];
    return {
      latitude: parseFloat(doc.y),
      longitude: parseFloat(doc.x)
    };
  }
  return null;
}

// 메인 geocoding 함수 (Kakao만 사용)
async function geocodeAddress(address) {
  return await geocodeAddressWithKakao(address);
}

// Geocoder 설정 (기존 코드와 호환성을 위해 유지)
const geocoder = {
  geocode: async (address) => {
    const result = await geocodeAddress(address);
    return result ? [result] : [];
  }
};

// Google API 인증 설정
const auth = new google.auth.JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY.includes('\\n') ? GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : GOOGLE_PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// Google Sheets API 초기화
const sheets = google.sheets({ version: 'v4', auth });

// 데이터 시트에서 값 가져오기 (캐싱 적용)
async function getSheetValues(sheetName) {
  const cacheKey = `sheet_${sheetName}`;
  
  // 캐시에서 먼저 확인
  const cachedData = cacheUtils.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }
  
  try {
    console.log(`Google Sheets API 호출: ${sheetName}`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetName
    });
    
    const data = response.data.values || [];
    
    // 캐시에 저장 (5분 TTL)
    cacheUtils.set(cacheKey, data);
    
    return data;
  } catch (error) {
    console.error(`Error fetching sheet ${sheetName}:`, error);
    throw error;
  }
}

// Discord로 로그 메시지 전송 함수
async function sendLogToDiscord(embedData) {
  // 필요한 설정이 없으면 로깅 안함
  if (!DISCORD_LOGGING_ENABLED) {
    console.log('Discord 로깅이 비활성화되었습니다.');
    return;
  }

  // 봇 객체가 초기화되지 않은 경우
  if (!discordBot || !EmbedBuilder) {
    console.log('Discord 봇이 초기화되지 않았습니다. 로그를 전송할 수 없습니다.');
    return;
  }

  try {
    // 봇이 연결되었는지 확인
    if (!discordBot.isReady()) {
      console.log('Discord 봇이 아직 준비되지 않았습니다. 메시지를 보낼 수 없습니다.');
      return;
    }

    // 사용자 유형에 따라 채널 ID 결정
    const userType = embedData.userType || 'store'; // 기본값은 일반 매장
    let channelId = DISCORD_CHANNEL_ID; // 기본 채널
    
    if (userType === 'agent') {
      channelId = DISCORD_AGENT_CHANNEL_ID;
      console.log('관리자 로그 전송 - 채널 ID:', channelId);
    } else {
      channelId = DISCORD_STORE_CHANNEL_ID;
      console.log('일반 매장 로그 전송 - 채널 ID:', channelId);
    }
    
    // 채널 ID가 없으면 로깅 중단
    if (!channelId) {
      console.log(`${userType} 유형의 Discord 채널 ID가 설정되지 않았습니다.`);
      return;
    }

    console.log('Discord 채널에 메시지 전송 시도...');
    console.log('Discord 채널 ID:', channelId);
    
    // 채널 가져오기 시도
    let channel = null;
    try {
      channel = await discordBot.channels.fetch(channelId);
    } catch (channelError) {
      console.error(`채널 ID ${channelId} 가져오기 실패:`, channelError.message);
      console.error('전체 오류:', channelError);
      return;
    }
    
    if (!channel) {
      console.error(`채널을 찾을 수 없습니다: ${channelId}`);
      return;
    }

    console.log(`채널 찾음: ${channel.name} (${channel.id}), 메시지 전송 중...`);
    
    try {
      // EmbedBuilder 생성
      const embed = new EmbedBuilder()
        .setTitle(embedData.title || '알림')
        .setColor(embedData.color || 0x0099FF);
      
      // Fields 추가
      if (embedData.fields && Array.isArray(embedData.fields)) {
        embed.addFields(...embedData.fields);
      }
      
      // 타임스탬프 설정
      if (embedData.timestamp) {
        embed.setTimestamp(new Date(embedData.timestamp));
      } else {
        embed.setTimestamp();
      }
      
      // Footer 설정
      if (embedData.footer && embedData.footer.text) {
        embed.setFooter({ text: embedData.footer.text });
      }
      
      // 메시지 전송 시도
      const sentMessage = await channel.send({ embeds: [embed] });
      console.log(`Discord 메시지 전송 성공! 메시지 ID: ${sentMessage.id}`);
      return true;
    } catch (embedError) {
      console.error('Embed 생성 또는 전송 중 오류:', embedError.message);
      console.error('자세한 오류 정보:', embedError);
      return false;
    }
  } catch (error) {
    console.error('Discord 로그 전송 중 오류:', error.message);
    console.error('자세한 오류 정보:', error);
    return false;
  }
}

// 서버 상태 확인용 엔드포인트
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    cache: cacheUtils.status(),
    env: {
      SHEET_ID: SPREADSHEET_ID ? 'SET' : 'NOT SET',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'SET' : 'NOT SET',
      GOOGLE_PRIVATE_KEY: GOOGLE_PRIVATE_KEY ? 'SET' : 'NOT SET',
      PORT: process.env.PORT || 4000
    }
  });
});

// 캐시 상태 확인용 엔드포인트
app.get('/api/cache-status', (req, res) => {
  res.json({
    status: 'success',
    cache: cacheUtils.status(),
    timestamp: new Date().toISOString()
  });
});

// 캐시 강제 새로고침 엔드포인트
app.post('/api/cache-refresh', (req, res) => {
  const { sheet } = req.body;
  
  if (sheet) {
    // 특정 시트 캐시만 삭제
    cacheUtils.delete(`sheet_${sheet}`);
    res.json({
      status: 'success',
      message: `캐시 새로고침 완료: ${sheet}`,
      timestamp: new Date().toISOString()
    });
  } else {
    // 전체 캐시 정리
    cacheUtils.cleanup();
    res.json({
      status: 'success',
      message: '전체 캐시 새로고침 완료',
      timestamp: new Date().toISOString()
    });
  }
});

// 주소를 위도/경도로 변환하여 시트에 업데이트
app.post('/api/update-coordinates', async (req, res) => {
  try {
    console.log('Updating coordinates...');
    
    const storeValues = await getSheetValues(STORE_SHEET_NAME);
    if (!storeValues) {
      throw new Error('Failed to fetch data from store sheet');
    }

    // 헤더 제거
    const storeRows = storeValues.slice(1);
    const updates = [];

    for (let i = 0; i < storeRows.length; i++) {
      const row = storeRows[i];
      const address = row[3]; // X열: 주소
      const status = row[4];   // D열: 거래상태
      
      if (status === "사용") {
        if (!address || address.toString().trim() === '') {
          // 사용 상태이지만 주소가 없는 경우 좌표 삭제
          updates.push({
            range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
            values: [["", ""]]
          });
          console.log(`Cleared coordinates for store without address at row ${i + 2}`);
          continue;
        }
        
        // 주소가 있는 경우 geocoding 실행
        try {
          const result = await geocodeAddress(address);
          if (result) {
            const { latitude, longitude } = result;
            updates.push({
              range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
              values: [[latitude, longitude]]
            });
            console.log(`Updated coordinates for address: ${address}`);
            console.log(`Latitude: ${latitude}, Longitude: ${longitude}`);
          } else {
            console.log(`No results found for address: ${address}`);
            // geocoding 실패 시 기존 좌표 삭제
            updates.push({
              range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
              values: [["", ""]]
            });
            console.log(`Cleared coordinates for failed geocoding at row ${i + 2}`);
          }
        } catch (error) {
          console.error(`Error geocoding address: ${address}`, error);
          // geocoding 오류 시 기존 좌표 삭제
          updates.push({
            range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
            values: [["", ""]]
          });
          console.log(`Cleared coordinates for geocoding error at row ${i + 2}`);
        }
      } else {
        // 미사용 매장은 위도/경도 값을 빈 값으로 비움
        updates.push({
          range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
          values: [["", ""]]
        });
        console.log(`Cleared coordinates for unused store at row ${i + 2}`);
      }
      // API 할당량 제한을 피하기 위한 지연 (사용 매장만)
      if (status === "사용") await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 일괄 업데이트 실행
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });
      console.log(`Successfully updated ${updates.length} coordinates`);
    } else {
      console.log('No coordinates to update');
    }

    res.json({ 
      success: true, 
      message: `Updated coordinates for ${updates.length} addresses` 
    });
  } catch (error) {
    console.error('Error updating coordinates:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update coordinates', 
      message: error.message 
    });
  }
});

// 스토어 데이터 가져오기 (캐싱 적용)
app.get('/api/stores', async (req, res) => {
  const { includeShipped = 'true' } = req.query; // 쿼리 파라미터로 출고 제외 여부 제어
  const cacheKey = `processed_stores_data_${includeShipped}`;
  
  // 캐시에서 먼저 확인
  const cachedStores = cacheUtils.get(cacheKey);
  if (cachedStores) {
    console.log('캐시된 매장 데이터 반환');
    return res.json(cachedStores);
  }
  
  try {
    console.log('매장 데이터 처리 시작...');
    const startTime = Date.now();
    
    const [inventoryValues, storeValues] = await Promise.all([
      getSheetValues(INVENTORY_SHEET_NAME),
      getSheetValues(STORE_SHEET_NAME)
    ]);
    
    if (!inventoryValues || !storeValues) {
      throw new Error('Failed to fetch data from sheets');
    }

    // 헤더 제거 (첫 3행은 제외)
    const inventoryRows = inventoryValues.slice(3);
    const storeRows = storeValues.slice(1);

    // 출고 제외 로직 (includeShipped가 'false'일 때만 적용)
    let threeDaysAgo = null;
    if (includeShipped === 'false') {
      const today = new Date();
      threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(today.getDate() - 3);
    }

    // 매장별 재고 데이터 매핑
    const inventoryMap = {};
    
    inventoryRows.forEach((row, index) => {
      if (!row || row.length < 15) return; // 최소 O열까지 데이터가 있어야 함
      
      const storeName = (row[13] || '').toString().trim();  // N열: 매장명
      const model = (row[5] || '').toString().trim();      // F열: 모델
      const color = (row[6] || '').toString().trim();      // G열: 색상
      const status = (row[7] || '').toString().trim();     // H열: 상태 (정상, 이력, 불량)
      const type = (row[4] || '').toString().trim();       // E열: 종류 (단말기, 웨어러블, 스마트기기, 유심)
      const shippingDate = row[14] ? new Date(row[14]) : null;  // O열: 출고일
      
      if (!storeName || !model || !color) return;

      // 출고일이 있고, 최근 3일 이내인 경우 재고에서 제외 (includeShipped가 'false'일 때만)
      if (includeShipped === 'false' && shippingDate && threeDaysAgo && shippingDate >= threeDaysAgo) return;

      // 매장별 재고 데이터 구조 생성
      if (!inventoryMap[storeName]) {
        inventoryMap[storeName] = {
          phones: {},    // 단말기
          sims: {},      // 유심
          wearables: {}, // 웨어러블
          smartDevices: {} // 스마트기기
        };
      }
      
      // 종류에 따라 분류
      let category = 'phones'; // 기본값
      if (type === '유심') {
        category = 'sims';
      } else if (type === '웨어러블') {
        category = 'wearables';
      } else if (type === '스마트기기') {
        category = 'smartDevices';
      }
      
      if (!inventoryMap[storeName][category][model]) {
        inventoryMap[storeName][category][model] = {};
      }
      
      // 상태별로 수량 관리
      if (!inventoryMap[storeName][category][model][status]) {
        inventoryMap[storeName][category][model][status] = {};
      }
      
      // 같은 모델/색상/상태 조합의 수량을 증가
      if (!inventoryMap[storeName][category][model][status][color]) {
        inventoryMap[storeName][category][model][status][color] = 1;
      } else {
        inventoryMap[storeName][category][model][status][color]++;
      }
    });

    // 매장 정보와 재고 정보 결합
    const stores = storeRows
      .filter(row => {
        const name = (row[6] || '').toString().trim();  // F열: 업체명
        const status = row[4];                          // D열: 거래상태
        return name && status === "사용";
      })
      .map(row => {
        const latitude = parseFloat(row[0] || '0');    // A열: 위도
        const longitude = parseFloat(row[1] || '0');   // B열: 경도
        const status = row[4];                         // D열: 거래상태
        const name = row[6].toString().trim();         // F열: 업체명
        const storeId = row[7];                        // G열: 매장 ID
        const phone = row[9] || '';                    // I열: 연락처
        const manager = row[13] || '';                 // M열: 담당자
        const address = (row[3] || '').toString();    // X열: 주소
        
        // 빈 매장 ID 제외
        if (!storeId || storeId.toString().trim() === '') {
          return null;
        }

        const inventory = inventoryMap[name] || {};

        return {
          id: storeId.toString(),
          name,
          address,
          phone,
          manager,
          latitude,
          longitude,
          uniqueId: `${storeId}_${name}`,
          inventory: inventory
        };
      })
      .filter(store => store !== null); // null 값 제거

    const processingTime = Date.now() - startTime;
    console.log(`매장 데이터 처리 완료: ${stores.length}개 매장, ${processingTime}ms 소요`);
    
    // 캐시에 저장 (5분 TTL)
    cacheUtils.set(cacheKey, stores);
    
    res.json(stores);
  } catch (error) {
    console.error('Error fetching store data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch store data', 
      message: error.message 
    });
  }
});

// 모델과 색상 데이터 가져오기 (캐싱 적용)
app.get('/api/models', async (req, res) => {
  const cacheKey = 'processed_models_data';
  
  // 캐시에서 먼저 확인
  const cachedModels = cacheUtils.get(cacheKey);
  if (cachedModels) {
    console.log('캐시된 모델 데이터 반환');
    return res.json(cachedModels);
  }
  
  try {
    console.log('모델 데이터 처리 시작...');
    const startTime = Date.now();
    
    const inventoryValues = await getSheetValues(INVENTORY_SHEET_NAME);
    
    if (!inventoryValues) {
      throw new Error('Failed to fetch data from inventory sheet');
    }

    // 헤더 제거 (첫 3행은 제외)
    const inventoryRows = inventoryValues.slice(3);

    // 모델과 색상 데이터 추출
    const modelColorMap = {};
    
    inventoryRows.forEach(row => {
      if (row.length < 8) return;
      
      const model = (row[5] || '').toString().trim();    // F열: 모델
      const color = (row[6] || '').toString().trim();    // G열: 색상
      const status = (row[7] || '').toString().trim();   // H열: 상태
      const type = (row[4] || '').toString().trim();     // E열: 종류
      
      if (!model || !color) return;
      
      // 상태가 '정상'인 것만 포함 (필터링)
      if (status !== '정상') return;
      
      if (!modelColorMap[model]) {
        modelColorMap[model] = new Set();
      }
      modelColorMap[model].add(color);
    });

    // Set을 배열로 변환
    const result = Object.entries(modelColorMap).reduce((acc, [model, colors]) => {
      acc[model] = Array.from(colors).sort();
      return acc;
    }, {});

    const processingTime = Date.now() - startTime;
    console.log(`모델 데이터 처리 완료: ${Object.keys(result).length}개 모델, ${processingTime}ms 소요`);
    
    // 캐시에 저장 (5분 TTL)
    cacheUtils.set(cacheKey, result);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching model and color data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch model and color data', 
      message: error.message 
    });
  }
});

// 대리점 ID 정보 가져오기 (캐싱 적용)
app.get('/api/agents', async (req, res) => {
  const cacheKey = 'processed_agents_data';
  
  // 캐시에서 먼저 확인
  const cachedAgents = cacheUtils.get(cacheKey);
  if (cachedAgents) {
    console.log('캐시된 대리점 데이터 반환');
    return res.json(cachedAgents);
  }
  
  try {
    console.log('대리점 데이터 처리 시작...');
    const startTime = Date.now();
    
    const agentValues = await getSheetValues(AGENT_SHEET_NAME);
    
    if (!agentValues) {
      throw new Error('Failed to fetch data from agent sheet');
    }

    // 헤더 제거
    const agentRows = agentValues.slice(1);
    
    // 대리점 데이터 구성
    const agents = agentRows.map(row => {
      return {
        target: row[0] || '',       // A열: 대상
        qualification: row[1] || '', // B열: 자격
        contactId: row[2] || ''      // C열: 연락처(아이디)
      };
    }).filter(agent => agent.contactId); // 아이디가 있는 항목만 필터링
    
    const processingTime = Date.now() - startTime;
    console.log(`대리점 데이터 처리 완료: ${agents.length}개 대리점, ${processingTime}ms 소요`);
    
    // 캐시에 저장 (5분 TTL)
    cacheUtils.set(cacheKey, agents);
    
    res.json(agents);
  } catch (error) {
    console.error('Error fetching agent data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch agent data', 
      message: error.message 
    });
  }
});

// 사용자 활동 로깅 API (비동기 처리)
app.post('/api/log-activity', async (req, res) => {
  // 즉시 응답 반환
  res.json({ success: true });
  
  // 로깅 처리를 비동기로 실행
  setImmediate(async () => {
    try {
      const { 
        userId, 
        userType, 
        targetName, 
        ipAddress, 
        location, 
        deviceInfo, 
        activity, 
        model, 
        colorName,
        callButton 
      } = req.body;
      
      // 활동 유형에 따른 제목 설정
      let title = '사용자 활동';
      let embedColor = 3447003; // 파란색
      
      if (activity === 'login') {
        title = '사용자 로그인';
        embedColor = 5763719; // 초록색
      } else if (activity === 'search') {
        title = '모델 검색';
        embedColor = 16776960; // 노란색
      } else if (activity === 'call_button') {
        title = '전화 연결 버튼 클릭';
        embedColor = 15548997; // 빨간색
      } else if (activity === 'kakao_button') {
        title = '카톡문구 생성';
        embedColor = 16776960; // 노란색 (카카오톡 색상)
      }
      
      // Discord로 로그 전송 시도
      if (DISCORD_LOGGING_ENABLED) {
        try {
          // Embed 데이터 구성
          const embedData = {
            title: title,
            color: embedColor,
            timestamp: new Date().toISOString(),
            userType: userType || 'store',
            fields: [
              {
                name: '사용자 정보',
                value: `ID: ${userId}\n종류: ${userType === 'agent' ? '관리자' : '일반'}\n대상: ${targetName || '없음'}`
              },
              {
                name: '접속 정보',
                value: `IP: ${ipAddress}\n위치: ${location || '알 수 없음'}\n기기: ${deviceInfo || '알 수 없음'}`
              }
            ],
            footer: {
              text: userType === 'agent' ? 'VIP+ 관리자 활동 로그' : 'VIP+ 매장 활동 로그'
            }
          };
          
          // 검색 정보가 있는 경우 필드 추가
          if (model) {
            embedData.fields.push({
              name: '검색 정보',
              value: `모델: ${model}${colorName ? `\n색상: ${colorName}` : ''}`
            });
          }
          
          // 전화 연결 버튼 클릭 정보
          if (callButton) {
            embedData.fields.push({
              name: '전화 연결',
              value: `${callButton}`
            });
          }
          
          // 카톡문구 생성 버튼 클릭 정보
          if (req.body.kakaoButton) {
            embedData.fields.push({
              name: '카톡문구 생성',
              value: `카카오톡 메시지 템플릿이 클립보드에 복사되었습니다.`
            });
          }
          
          // Discord로 로그 전송
          await sendLogToDiscord(embedData);
        } catch (logError) {
          console.error('활동 로그 Discord 전송 오류:', logError.message);
        }
      }
    } catch (error) {
      console.error('활동 로그 처리 중 오류:', error);
    }
  });
});

// 로그인 검증 API 추가
app.post('/api/login', async (req, res) => {
  try {
    const { storeId, deviceInfo, ipAddress, location } = req.body;
    
    if (!storeId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Store ID is required' 
      });
    }
    
    console.log(`Login attempt with ID: ${storeId}`);
    console.log('Step 1: Starting login process...');
    
    // 재고모드 전용 ID 목록
    const INVENTORY_MODE_IDS = ["JEGO306891", "JEGO315835", "JEGO314942", "JEGO316558", "JEGO316254"];
    
    // 재고모드 ID인지 먼저 확인
    if (INVENTORY_MODE_IDS.includes(storeId)) {
      console.log(`Step 1.5: Inventory mode ID detected: ${storeId}`);
      
      // 디스코드로 로그인 로그 전송
      if (DISCORD_LOGGING_ENABLED) {
        try {
          const embedData = {
            title: '재고모드 로그인',
            color: 16776960, // 노란색
            timestamp: new Date().toISOString(),
            userType: 'inventory', // 재고모드 타입 지정
            fields: [
              {
                name: '재고모드 정보',
                value: `ID: ${storeId}\n모드: 재고관리 전용`
              },
              {
                name: '접속 정보',
                value: `IP: ${ipAddress || '알 수 없음'}\n위치: ${location || '알 수 없음'}\n기기: ${deviceInfo || '알 수 없음'}`
              }
            ],
            footer: {
              text: 'VIP+ 재고모드 로그인'
            }
          };
          
          await sendLogToDiscord(embedData);
        } catch (logError) {
          console.error('재고모드 로그인 로그 전송 실패:', logError.message);
        }
      }
      
      console.log('Step 1.6: Inventory mode login successful, sending response...');
      return res.json({
        success: true,
        isAgent: false,
        isInventory: true,
        storeInfo: {
          id: storeId,
          name: '재고관리 모드',
          manager: '재고관리자',
          address: '',
          latitude: 37.5665,
          longitude: 126.9780,
          phone: ''
        }
      });
    }
    
    // 1. 먼저 대리점 관리자 ID인지 확인
    console.log('Step 2: Checking if ID is agent...');
    const agentValues = await getSheetValues(AGENT_SHEET_NAME);
    console.log('Step 3: Agent sheet data fetched, rows:', agentValues ? agentValues.length : 0);
    
    if (agentValues) {
      const agentRows = agentValues.slice(1);
      console.log('Step 4: Agent rows (excluding header):', agentRows.length);
      
      const agent = agentRows.find(row => row[2] === storeId); // C열: 연락처(아이디)
      console.log('Step 5: Agent search result:', agent ? 'Found' : 'Not found');
      
      if (agent) {
        console.log(`Found agent: ${agent[0]}, ${agent[1]}`);
        console.log('Step 6: Processing agent login...');
        
        // 디스코드로 로그인 로그 전송
        if (DISCORD_LOGGING_ENABLED) {
          try {
            const embedData = {
              title: '관리자 로그인',
              color: 15844367, // 보라색
              timestamp: new Date().toISOString(),
              userType: 'agent', // 관리자 타입 지정
              fields: [
                {
                  name: '관리자 정보',
                  value: `ID: ${agent[2]}\n대상: ${agent[0]}\n자격: ${agent[1]}`
                },
                {
                  name: '접속 정보',
                  value: `IP: ${ipAddress || '알 수 없음'}\n위치: ${location || '알 수 없음'}\n기기: ${deviceInfo || '알 수 없음'}`
                }
              ],
              footer: {
                text: 'VIP+ 관리자 로그인'
              }
            };
            
            await sendLogToDiscord(embedData);
          } catch (logError) {
            console.error('로그인 로그 전송 실패:', logError.message);
            // 로그 전송 실패해도 로그인은 허용
          }
        }
        
        console.log('Step 7: Agent login successful, sending response...');
        return res.json({
          success: true,
          isAgent: true,
          agentInfo: {
            target: agent[0] || '',       // A열: 대상
            qualification: agent[1] || '', // B열: 자격
            contactId: agent[2] || ''      // C열: 연락처(아이디)
          }
        });
      }
    }
    
    // 2. 대리점 관리자가 아닌 경우 일반 매장으로 검색
    console.log('Step 8: Not an agent, checking if ID is store...');
    const storeValues = await getSheetValues(STORE_SHEET_NAME);
    console.log('Step 9: Store sheet data fetched, rows:', storeValues ? storeValues.length : 0);
    
    if (!storeValues) {
      console.log('Step 9.5: Store sheet data is null or empty');
      throw new Error('Failed to fetch data from store sheet');
    }
    
    const storeRows = storeValues.slice(1);
    console.log('Step 10: Store rows (excluding header):', storeRows.length);
    
    // 매장 ID 검색을 위한 디버깅 로그 추가
    console.log('Step 10.5: Searching for store ID:', storeId);
    console.log('Step 10.6: First few store IDs for comparison:');
    storeRows.slice(0, 5).forEach((row, index) => {
      console.log(`  Row ${index + 1}: "${row[7]}" (type: ${typeof row[7]})`);
    });
    
    const foundStoreRow = storeRows.find(row => {
      const rowId = row[7];
      const match = rowId === storeId;
      if (match) {
        console.log(`Step 10.7: Found matching store ID: "${rowId}"`);
      }
      return match;
    }); // G열: 매장 ID로 수정
    console.log('Step 11: Store search result:', foundStoreRow ? 'Found' : 'Not found');
    
    if (foundStoreRow) {
      const store = {
        id: foundStoreRow[7],                      // G열: 매장 ID
        name: foundStoreRow[6],                    // F열: 업체명
        manager: foundStoreRow[13] || '',          // M열: 담당자
        address: foundStoreRow[3] || '',          // X열: 주소
        latitude: parseFloat(foundStoreRow[0] || '0'),  // A열: 위도
        longitude: parseFloat(foundStoreRow[1] || '0'),  // B열: 경도
        phone: foundStoreRow[11] || ''              // I열: 연락처 추가
      };
      
      console.log(`Found store: ${store.name}`);
      console.log('Step 12: Processing store login...');
      
      // 디스코드로 로그인 로그 전송
      if (DISCORD_LOGGING_ENABLED) {
        try {
          const embedData = {
            title: '매장 로그인',
            color: 5763719, // 초록색
            timestamp: new Date().toISOString(),
            userType: 'store', // 일반 매장 타입 지정
            fields: [
              {
                name: '매장 정보',
                value: `ID: ${store.id}\n매장명: ${store.name}\n담당자: ${store.manager || '없음'}`
              },
              {
                name: '접속 정보',
                value: `IP: ${ipAddress || '알 수 없음'}\n위치: ${location || '알 수 없음'}\n기기: ${deviceInfo || '알 수 없음'}`
              }
            ],
            footer: {
              text: 'VIP+ 매장 로그인'
            }
          };
          
          await sendLogToDiscord(embedData);
        } catch (logError) {
          console.error('로그인 로그 전송 실패:', logError.message);
          // 로그 전송 실패해도 로그인은 허용
        }
      }
      
      console.log('Step 13: Store login successful, sending response...');
      return res.json({
        success: true,
        isAgent: false,
        storeInfo: store
      });
    }
    
    // 3. 매장 ID도 아닌 경우
    console.log('Step 14: ID not found in either agent or store sheets');
    return res.status(404).json({
      success: false,
      error: 'Store not found'
    });
    
  } catch (error) {
    console.error('Error in login:', error);
    console.error('Login error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Login failed', 
      message: error.message 
    });
  }
});

// 주기적으로 주소 업데이트를 확인하고 실행하는 함수
async function checkAndUpdateAddresses() {
  try {
    console.log('Checking for addresses that need updating...');
    
    const storeValues = await getSheetValues(STORE_SHEET_NAME);
    if (!storeValues) {
      throw new Error('Failed to fetch data from store sheet');
    }

    // 헤더 제거
    const storeRows = storeValues.slice(1);
    const updates = [];
    
    // 모든 주소에 대해 좌표 업데이트 (행 위치가 변경되어도 항상 처리)
    for (let i = 0; i < storeRows.length; i++) {
      const row = storeRows[i];
      const address = row[3];  // X열: 주소
      const status = row[4];    // D열: 거래상태
      
      if (status === "사용") {
        if (!address || address.toString().trim() === '') {
          // 사용 상태이지만 주소가 없는 경우 좌표 삭제
          updates.push({
            range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
            values: [["", ""]]
          });
          console.log(`Cleared coordinates for store without address at row ${i + 2}`);
          continue;
        }
        
        // 주소가 있는 경우 geocoding 실행
        try {
          const result = await geocodeAddress(address);
          if (result) {
            const { latitude, longitude } = result;
            updates.push({
              range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
              values: [[latitude, longitude]]
            });
            console.log(`Updated coordinates for address: ${address}`);
            console.log(`Latitude: ${latitude}, Longitude: ${longitude}`);
          } else {
            console.log(`No results found for address: ${address}`);
            // geocoding 실패 시 기존 좌표 삭제
            updates.push({
              range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
              values: [["", ""]]
            });
            console.log(`Cleared coordinates for failed geocoding at row ${i + 2}`);
          }
        } catch (error) {
          console.error(`Error geocoding address: ${address}`, error);
          // geocoding 오류 시 기존 좌표 삭제
          updates.push({
            range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
            values: [["", ""]]
          });
          console.log(`Cleared coordinates for geocoding error at row ${i + 2}`);
        }
      } else {
        // 미사용 매장은 위도/경도 값을 빈 값으로 비움
        updates.push({
          range: `${STORE_SHEET_NAME}!A${i + 2}:B${i + 2}`,
          values: [["", ""]]
        });
        console.log(`Cleared coordinates for unused store at row ${i + 2}`);
      }
      // API 할당량 제한을 피하기 위한 지연 (사용 매장만)
      if (status === "사용") await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 일괄 업데이트 실행
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });
      console.log(`Successfully updated ${updates.length} coordinates`);
    } else {
      console.log('No coordinates to update');
    }
  } catch (error) {
    console.error('Error in checkAndUpdateAddresses:', error);
  }
}

// 서버 시작
const server = app.listen(port, '0.0.0.0', async () => {
  try {
    console.log(`서버가 포트 ${port}에서 실행 중입니다`);
    
    // 환경변수 디버깅 (민감한 정보는 로깅하지 않음)
    console.log('Discord 봇 환경변수 상태:');
    console.log('- DISCORD_BOT_TOKEN 설정됨:', !!process.env.DISCORD_BOT_TOKEN);
    console.log('- DISCORD_CHANNEL_ID 설정됨:', !!process.env.DISCORD_CHANNEL_ID);
    console.log('- DISCORD_AGENT_CHANNEL_ID 설정됨:', !!process.env.DISCORD_AGENT_CHANNEL_ID);
    console.log('- DISCORD_STORE_CHANNEL_ID 설정됨:', !!process.env.DISCORD_STORE_CHANNEL_ID);
    console.log('- DISCORD_LOGGING_ENABLED 설정됨:', process.env.DISCORD_LOGGING_ENABLED);
    
    // 무료 Geocoding 서비스 상태
    console.log('무료 Geocoding 서비스 상태:');
    console.log('- Photon API (Komoot): 사용 가능 (무료)');
    console.log('- Nominatim API (OpenStreetMap): 사용 가능 (무료)');
    console.log('- Pelias API (Mapzen): 사용 가능 (무료)');
    console.log('- 총 3개 무료 서비스로 정확도 향상');
    
    // 봇 로그인 (서버 시작 후)
    if (DISCORD_LOGGING_ENABLED && DISCORD_BOT_TOKEN && discordBot) {
      console.log('서버 시작 후 Discord 봇 로그인 시도...');
      try {
        await discordBot.login(DISCORD_BOT_TOKEN);
        console.log('Discord 봇 연결 성공!');
        
        // 관리자 채널 연결 테스트
        if (DISCORD_AGENT_CHANNEL_ID) {
          try {
            const agentChannel = await discordBot.channels.fetch(DISCORD_AGENT_CHANNEL_ID);
            if (agentChannel) {
              console.log(`관리자 채널 '${agentChannel.name}' 연결 성공!`);
            }
          } catch (agentChannelError) {
            console.error('관리자 채널 연결 실패:', agentChannelError.message);
          }
        }
        
        // 일반 매장 채널 연결 테스트
        if (DISCORD_STORE_CHANNEL_ID) {
          try {
            const storeChannel = await discordBot.channels.fetch(DISCORD_STORE_CHANNEL_ID);
            if (storeChannel) {
              console.log(`일반 매장 채널 '${storeChannel.name}' 연결 성공!`);
            }
          } catch (storeChannelError) {
            console.error('일반 매장 채널 연결 실패:', storeChannelError.message);
          }
        }
        
        // 테스트 메시지 전송 (기본 채널)
        if (DISCORD_CHANNEL_ID) {
          const channel = await discordBot.channels.fetch(DISCORD_CHANNEL_ID);
          if (channel) {
            console.log(`채널 '${channel.name}' 연결 성공!`);
            
            // 테스트 메시지 전송
            const testEmbed = new EmbedBuilder()
              .setTitle('서버 시작 알림')
              .setColor(5763719)
              .setDescription('서버가 성공적으로 시작되었습니다.')
              .setTimestamp()
              .setFooter({ text: 'VIP+ 서버' });
              
            await channel.send({ embeds: [testEmbed] });
            console.log('서버 시작 알림 메시지 전송됨');
          }
        }
      } catch (error) {
        console.error('서버 시작 시 Discord 봇 초기화 오류:', error.message);
        console.error('Discord 봇은 비활성화 상태로 서버가 계속 실행됩니다.');
      }
    } else {
      console.log('Discord 봇 기능이 비활성화되었거나 설정이 완료되지 않았습니다.');
    }
    
    // 주소 업데이트 함수 호출
    console.log('모든 사용 중인 주소에 대해 위도/경도 값을 업데이트합니다...');
    await checkAndUpdateAddresses();
    
    // 매 시간마다 업데이트 체크 실행 (3600000ms = 1시간)
    setInterval(checkAndUpdateAddresses, 3600000);
  } catch (error) {
    console.error('서버 시작 중 오류:', error);
  }
}).on('error', (error) => {
  console.error('서버 시작 실패:', error);
  process.exit(1);
});

// 정상적인 종료 처리
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal. Shutting down gracefully...');
  
  // Discord에 서버 종료 알림 전송
  if (DISCORD_LOGGING_ENABLED && discordBot) {
    try {
      // 봇 준비 상태 확인
      if (!discordBot.isReady()) {
        console.log('Discord 봇이 아직 준비되지 않았습니다. 5초 대기 후 재시도...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
      }
      
      if (discordBot.isReady()) {
        // 기본 채널에 알림 전송
        if (DISCORD_CHANNEL_ID) {
          try {
            const channel = await discordBot.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) {
              const shutdownEmbed = new EmbedBuilder()
                .setTitle('⚠️ 서버 종료 알림')
                .setColor(15548997) // 빨간색
                .setDescription('@everyone\n서버가 종료되었습니다. 서비스 이용이 불가능할 수 있습니다.')
                .setTimestamp()
                .setFooter({ text: 'VIP+ 서버 알림' });
                
              console.log('종료 알림 전송 시도 중...');
              const sentMessage = await channel.send({ content: '@everyone', embeds: [shutdownEmbed] });
              console.log(`서버 종료 알림 메시지가 Discord로 전송되었습니다. 메시지 ID: ${sentMessage.id}`);
            }
          } catch (error) {
            console.error('Discord 채널 접근 또는 메시지 전송 실패:', error);
          }
        }
      } else {
        console.log('Discord 봇이 준비되지 않아 종료 알림을 보낼 수 없습니다.');
      }
    } catch (error) {
      console.error('Discord 종료 알림 전송 실패:', error);
    }
    
    // Discord 봇 연결 종료를 기다림 (메시지 전송에 충분한 시간)
    console.log('Discord 메시지 전송 대기 중... (3초)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('대기 완료, 서버 종료 진행');
  }
  
  server.close(() => {
    console.log('Server closed');
    // 일정 시간 후 강제 종료 (메시지가 전송되지 않더라도)
    setTimeout(() => {
      console.log('강제 종료');
      process.exit(0);
    }, 1000);
  });
});

// SIGINT 처리 (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('Received SIGINT signal (Ctrl+C). Shutting down gracefully...');
  
  // Discord에 서버 종료 알림 전송
  if (DISCORD_LOGGING_ENABLED && discordBot) {
    try {
      // 봇 준비 상태 확인
      if (!discordBot.isReady()) {
        console.log('Discord 봇이 아직 준비되지 않았습니다. 5초 대기 후 재시도...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
      }
      
      if (discordBot.isReady()) {
        // 기본 채널에 알림 전송
        if (DISCORD_CHANNEL_ID) {
          try {
            const channel = await discordBot.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) {
              const shutdownEmbed = new EmbedBuilder()
                .setTitle('⚠️ 서버 종료 알림')
                .setColor(15548997) // 빨간색
                .setDescription('@everyone\n서버가 종료되었습니다. 서비스 이용이 불가능할 수 있습니다.')
                .setTimestamp()
                .setFooter({ text: 'VIP+ 서버 알림' });
                
              console.log('종료 알림 전송 시도 중...');
              const sentMessage = await channel.send({ content: '@everyone', embeds: [shutdownEmbed] });
              console.log(`서버 종료 알림 메시지가 Discord로 전송되었습니다. 메시지 ID: ${sentMessage.id}`);
            }
          } catch (error) {
            console.error('Discord 채널 접근 또는 메시지 전송 실패:', error);
          }
        }
      } else {
        console.log('Discord 봇이 준비되지 않아 종료 알림을 보낼 수 없습니다.');
      }
    } catch (error) {
      console.error('Discord 종료 알림 전송 실패:', error);
    }
    
    // Discord 봇 연결 종료를 기다림 (메시지 전송에 충분한 시간)
    console.log('Discord 메시지 전송 대기 중... (3초)');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('대기 완료, 서버 종료 진행');
  }
  
  server.close(() => {
    console.log('Server closed');
    // 일정 시간 후 강제 종료 (메시지가 전송되지 않더라도)
    setTimeout(() => {
      console.log('강제 종료');
      process.exit(0);
    }, 1000);
  });
}); 